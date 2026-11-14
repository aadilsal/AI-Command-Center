import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { POSTAL_ADDRESS } from "./prompts";
import { reportGmailError, sendEmail } from "./gmail";

// =============================================================================
// Outbox: the only place that actually sends email. Every send goes through
// the same safety checks:
//   - the address is not on the do-not-contact list (opt-outs, bounces)
//   - a postal address is in the footer (required for commercial email)
//   - the draft still matches what Autopilot decided to send
// =============================================================================

export function postalAddress(): string {
  return (POSTAL_ADDRESS || process.env.POSTAL_ADDRESS || "").trim();
}

function withPostalAddress(body: string): string {
  const addr = postalAddress();
  if (!addr) {
    throw new Error(
      'Add your business postal address before sending (required for business email): npx convex env set POSTAL_ADDRESS "TechVersa, <street>, Lahore, Pakistan"'
    );
  }
  return body.includes(addr) ? body : `${body.trimEnd()}\n${addr}`;
}

// ---------------------------------------------------------------- do-not-contact list

export const isSuppressed = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const e = email.trim().toLowerCase();
    const domain = e.split("@")[1] ?? "";
    const byEmail = await ctx.db
      .query("suppressions")
      .withIndex("by_value", (q) => q.eq("value", e))
      .first();
    const byDomain = domain
      ? await ctx.db
          .query("suppressions")
          .withIndex("by_value", (q) => q.eq("value", `@${domain}`))
          .first()
      : null;
    return !!(byEmail || byDomain);
  },
});

export const suppress = internalMutation({
  args: { value: v.string(), reason: v.string() },
  handler: async (ctx, { value, reason }) => {
    const val = value.trim().toLowerCase();
    const existing = await ctx.db
      .query("suppressions")
      .withIndex("by_value", (q) => q.eq("value", val))
      .first();
    if (!existing) await ctx.db.insert("suppressions", { value: val, reason, createdAt: Date.now() });
  },
});

export const suppressionsList = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("suppressions").order("desc").take(200),
});

export const addSuppression = mutation({
  args: { value: v.string() },
  handler: async (ctx, { value }) => {
    const val = value.trim().toLowerCase();
    if (!val.includes("@")) throw new Error("Enter an email address, or @domain.com to block a whole company");
    const existing = await ctx.db
      .query("suppressions")
      .withIndex("by_value", (q) => q.eq("value", val))
      .first();
    if (!existing) await ctx.db.insert("suppressions", { value: val, reason: "added by you", createdAt: Date.now() });
  },
});

// ---------------------------------------------------------------- prospect emails (first email + follow-ups)

export const sendProspectEmail = internalAction({
  args: { id: v.id("prospects"), expect: v.union(v.literal("intro"), v.literal("followup")) },
  handler: async (ctx, { id, expect }): Promise<string> => {
    const p: Doc<"prospects"> | null = await ctx.runQuery(internal.prospectAgent.getProspect, { id });
    if (!p) throw new Error("Prospect not found");
    const d = p.draft;
    if (!d) throw new Error("No draft to send (it may have been sent or cleared already)");
    if (expect === "intro" && (d.kind !== "intro" || p.status !== "Ready")) throw new Error("Not ready for a first email any more");
    if (expect === "followup" && (d.kind === "intro" || p.status !== "Contacted")) throw new Error("Not waiting for a follow-up any more");
    if (!p.contactEmail) throw new Error("No email address — use their contact form instead");
    if (await ctx.runQuery(internal.outbox.isSuppressed, { email: p.contactEmail })) {
      await ctx.runMutation(internal.outbox.clearDraft, { id });
      throw new Error(`${p.contactEmail} is on the do-not-contact list`);
    }

    const body = withPostalAddress(d.body);
    const ids = p.gmailMessageIds ?? [];
    try {
      const sent = await sendEmail({
        to: p.contactEmail,
        subject: d.subject,
        body,
        threadId: expect === "followup" ? p.gmailThreadId : undefined,
        inReplyTo: expect === "followup" ? ids[ids.length - 1] : undefined,
        references: expect === "followup" ? ids : undefined,
      });
      await ctx.runMutation(internal.outbox.recordProspectSent, {
        id,
        threadId: sent.threadId,
        messageId: sent.messageId ?? undefined,
      });
      return `Sent "${d.subject}" to ${p.contactEmail}`;
    } catch (e) {
      await reportGmailError(ctx, e);
      throw e;
    }
  },
});

export const clearDraft = internalMutation({
  args: { id: v.id("prospects") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { draft: undefined });
  },
});

// Same bookkeeping as "Mark sent", plus the Gmail thread so replies and follow-ups line up
export const recordProspectSent = internalMutation({
  args: { id: v.id("prospects"), threadId: v.string(), messageId: v.optional(v.string()) },
  handler: async (ctx, { id, threadId, messageId }) => {
    const p = await ctx.db.get(id);
    if (!p || !p.draft) return;
    const now = Date.now();
    const isFollowUp = p.draft.kind !== "intro";
    await ctx.db.patch(id, {
      sentEmails: [...(p.sentEmails ?? []), { kind: p.draft.kind, subject: p.draft.subject, sentAt: now }],
      draft: undefined,
      lastContactAt: now,
      followUpsSent: isFollowUp ? (p.followUpsSent ?? 0) + 1 : (p.followUpsSent ?? 0),
      status: "Contacted",
      statusChangedAt: now,
      gmailThreadId: p.gmailThreadId ?? threadId,
      gmailMessageIds: messageId ? [...(p.gmailMessageIds ?? []), messageId] : p.gmailMessageIds,
    });
  },
});

// ---------------------------------------------------------------- replies to their replies

export const sendReply = internalAction({
  args: { inboundId: v.id("inboundEmails") },
  handler: async (ctx, { inboundId }): Promise<string> => {
    const m: Doc<"inboundEmails"> | null = await ctx.runQuery(internal.outbox.getInbound, { id: inboundId });
    if (!m) throw new Error("Reply not found");
    if (!m.replyDraft) throw new Error("No reply draft to send");
    if (m.status === "handled") throw new Error("Already answered");
    if (await ctx.runQuery(internal.outbox.isSuppressed, { email: m.fromEmail })) {
      throw new Error(`${m.fromEmail} asked not to be contacted`);
    }
    const addr = postalAddress();
    const body = `${m.replyDraft.body.trimEnd()}\n\nTechVersa\ntechversa.co${addr ? `\n${addr}` : ""}`;
    try {
      const sent = await sendEmail({
        to: m.fromEmail,
        subject: m.replyDraft.subject,
        body,
        threadId: m.threadId,
        inReplyTo: m.messageId ?? undefined,
        references: [...(m.references ? m.references.split(/\s+/) : []), ...(m.messageId ? [m.messageId] : [])],
      });
      await ctx.runMutation(internal.outbox.recordReplySent, {
        id: inboundId,
        messageId: sent.messageId ?? undefined,
      });
      return `Replied to ${m.fromEmail}: "${m.replyDraft.subject}"`;
    } catch (e) {
      await reportGmailError(ctx, e);
      throw e;
    }
  },
});

export const getInbound = internalQuery({
  args: { id: v.id("inboundEmails") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const recordReplySent = internalMutation({
  args: { id: v.id("inboundEmails"), messageId: v.optional(v.string()) },
  handler: async (ctx, { id, messageId }) => {
    const m = await ctx.db.get(id);
    if (!m) return;
    const now = Date.now();
    await ctx.db.patch(id, { status: "handled", handledAt: now, sentReplyAt: now });
    if (m.prospectId) {
      const p = await ctx.db.get(m.prospectId as Id<"prospects">);
      if (p) {
        await ctx.db.patch(p._id, {
          lastContactAt: now,
          gmailMessageIds: messageId ? [...(p.gmailMessageIds ?? []), messageId] : p.gmailMessageIds,
        });
      }
    }
  },
});
