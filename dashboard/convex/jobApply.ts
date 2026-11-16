import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { reportGmailError, sendEmail } from "./gmail";
import { CV_PROFILE } from "./cvProfile";
import type { BuildResult } from "./cvBuilder";

// =============================================================================
// APPLY BY EMAIL — for jobs whose post says "send your CV to someone@company.com".
// Autopilot: kit → tailored one-page CV PDF + cover letter PDF → sent from your Gmail
// → job marked Applied. Posts asking about salary/rate always wait for your approval.
// Job boards' own forms (Greenhouse/Lever/LinkedIn) are NOT handled here.
// =============================================================================

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const APPLY_CONTEXT = /(apply|application|cv|resume|résumé|send|email|e-mail|portfolio|reach out|contact|hiring|careers?|jobs?)/i;
const BAD_ADDRESS = /(no-?reply|donotreply|example\.|privacy|abuse|unsubscribe|support@(?!.*careers)|billing|sales@|press@|legal@|security@)/i;
const SALARY = /(salary expectation|expected salary|desired salary|salary requirement|compensation expectation|your (hourly |daily )?rate|rate expectation|current salary|ctc)/i;

// The address the post asks applications to be sent to, if any
export function findApplyEmail(text: string): string | null {
  if (!text) return null;
  const candidates: { email: string; score: number }[] = [];
  for (const m of text.matchAll(EMAIL)) {
    const email = m[0].replace(/[.,;:)]+$/, "").toLowerCase();
    if (BAD_ADDRESS.test(email)) continue;
    const around = text.slice(Math.max(0, (m.index ?? 0) - 140), (m.index ?? 0) + email.length + 60);
    if (!APPLY_CONTEXT.test(around)) continue;
    const score = (/(jobs|careers|hiring|recruit|talent|apply|hr)@/.test(email) ? 2 : 0) + (/(send|email).{0,40}(cv|resume)|apply.{0,30}(by|via) email/i.test(around) ? 2 : 0);
    candidates.push({ email, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.email ?? null;
}

export function asksForSalary(text: string) {
  return SALARY.test(text);
}

// ---------------------------------------------------------------- Autopilot: find jobs to apply to

export const candidates = internalQuery({
  args: { minScore: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { minScore, cursor }) => {
    const res = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "Saved"))
      .paginate({ cursor, numItems: 20 });
    const out = [];
    for (const j of res.page) {
      if (!j.source || j.appliedVia || j.recommendation === "Skip" || j.matchScore < minScore) continue;
      const detail = await ctx.db
        .query("jobDetails")
        .withIndex("by_job", (q) => q.eq("jobId", j._id))
        .first();
      const text = detail?.description ?? j.description ?? "";
      const email = findApplyEmail(text);
      if (!email) continue;
      out.push({
        _id: j._id as string,
        title: j.title,
        company: j.company,
        matchScore: j.matchScore,
        email,
        salaryQuestion: asksForSalary(text),
      });
    }
    return { items: out, cursor: res.continueCursor, isDone: res.isDone };
  },
});

// ---------------------------------------------------------------- the executor

export const applyByEmail = internalAction({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }): Promise<string> => {
    let job: (Doc<"jobs"> & { description?: string }) | null = await ctx.runQuery(internal.applicationKit.getJob, { id: jobId });
    if (!job) throw new Error("Job not found");
    if (job.status !== "Saved" || job.appliedVia) throw new Error(`Already ${job.appliedVia ? "applied" : job.status.toLowerCase()}`);
    const to = findApplyEmail(job.description ?? "");
    if (!to) throw new Error("The post doesn't list an application email any more");
    if (await ctx.runQuery(internal.outbox.isSuppressed, { email: to })) throw new Error(`${to} is on the do-not-contact list`);

    // 1) Kit (summary, cover letter, email) — written from your real CV with the usual guardrails
    if (!job.kit) {
      await ctx.runAction(api.applicationKit.generateKit, { id: jobId });
      job = await ctx.runQuery(internal.applicationKit.getJob, { id: jobId });
    }
    const kit = job?.kit;
    if (!job || !kit) throw new Error("Couldn't write the application kit");

    // 2) Tailored one-page CV + cover letter PDFs
    const built: BuildResult = await ctx.runAction(internal.cvBuilder.build, { jobId });
    const files: { filename: string; mimeType: string; data: Uint8Array }[] = [];
    const cvBlob = await ctx.storage.get(built.cvStorageId);
    if (!cvBlob) throw new Error("CV file missing");
    files.push({ filename: built.cvName, mimeType: "application/pdf", data: new Uint8Array(await cvBlob.arrayBuffer()) });
    if (built.letterStorageId && built.letterName) {
      const letter = await ctx.storage.get(built.letterStorageId);
      if (letter) files.push({ filename: built.letterName, mimeType: "application/pdf", data: new Uint8Array(await letter.arrayBuffer()) });
    }

    // 3) Send from your Gmail, as you
    try {
      await sendEmail({
        to,
        subject: kit.emailSubject,
        body: kit.emailBody,
        fromName: CV_PROFILE.name,
        attachments: files,
        unsubscribeHeader: false,
      });
    } catch (e) {
      await reportGmailError(ctx, e);
      throw e;
    }

    // 4) Mark Applied (so follow-up reminders and the briefing pick it up)
    await ctx.runMutation(internal.jobApply.recordApplied, {
      jobId,
      to,
      fileIds: [built.cvFileId, ...(built.letterFileId ? [built.letterFileId] : [])],
    });
    return `Applied to ${job.title} @ ${job.company} — sent CV${built.letterFileId ? " + cover letter" : ""} to ${to}`;
  },
});

export const recordApplied = internalMutation({
  args: { jobId: v.id("jobs"), to: v.string(), fileIds: v.array(v.id("cvFiles")) },
  handler: async (ctx, { jobId, to, fileIds }) => {
    const now = Date.now();
    await ctx.db.patch(jobId, { status: "Applied", statusChangedAt: now, appliedVia: "email", applyEmail: to });
    for (const id of fileIds) await ctx.db.patch(id as Id<"cvFiles">, { sentTo: to });
  },
});
