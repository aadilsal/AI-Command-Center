import { v } from "convex/values";
import { mutation } from "./_generated/server";

const status = v.union(
  v.literal("New"),
  v.literal("Ready"),
  v.literal("NoEmail"),
  v.literal("Contacted"),
  v.literal("Replied"),
  v.literal("Meeting"),
  v.literal("Won"),
  v.literal("Lost"),
  v.literal("NotAFit")
);

// "Open in Gmail" / "Mark sent": log the email, clear the draft, move the pipeline forward
export const markSent = mutation({
  args: { id: v.id("prospects") },
  handler: async (ctx, { id }) => {
    const p = await ctx.db.get(id);
    if (!p || !p.draft) return;
    const now = Date.now();
    const isFollowUp = p.draft.kind !== "intro";
    await ctx.db.patch(id, {
      sentEmails: [...(p.sentEmails ?? []), { kind: p.draft.kind, subject: p.draft.subject, sentAt: now }],
      draft: undefined,
      lastContactAt: now,
      followUpsSent: isFollowUp ? (p.followUpsSent ?? 0) + 1 : p.followUpsSent ?? 0,
      status: "Contacted",
      statusChangedAt: now,
    });
  },
});

export const setStatus = mutation({
  args: { id: v.id("prospects"), status },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status, statusChangedAt: Date.now() });
  },
});
