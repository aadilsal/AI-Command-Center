import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";

// =============================================================================
// RETENTION — keeps the database small so every read stays cheap (Convex free
// tier: 1 GB of reads/writes per month, 0.5 GB storage). Runs every night.
//
// The trick that makes deleting safe: before a job / post is deleted, its URL
// (and the job's title+company key) goes into "tombstones". The agents check
// tombstones, so deleted things are never found and re-added again.
//
// Never deleted: anything you acted on (Applied, Interview, Offer, Contacted,
// Replied, Meeting, Won), problems with a designed solution, reply conversations.
// =============================================================================

const DAY = 24 * 60 * 60 * 1000;

export const RULES = {
  skipJobsArchiveAfter: 3 * DAY, // "Skip" verdicts leave the To-apply list fast
  archivedJobsDeleteAfter: 30 * DAY, // archived (stale/rejected) jobs → deleted, url remembered
  signalTextTrimAfter: 7 * DAY, // analyzed/noise posts: keep the extracted pain, drop the raw text
  noiseSignalsDeleteAfter: 14 * DAY,
  parkedProblemsDeleteAfter: 45 * DAY, // parked + never designed
  closedProspectsTrimAfter: 30 * DAY, // NotAFit / Lost: keep name+domain (for dedupe), drop research
  agentRunsDeleteAfter: 60 * DAY,
  autopilotActionsDeleteAfter: 45 * DAY, // finished ones only
  seenMailDeleteAfter: 30 * DAY, // Reply Agent only looks back 7 days
  briefingsDeleteAfter: 45 * DAY,
  reportsDeleteAfter: 120 * DAY, // coach + trend reports
};

const BATCH = 40; // rows per mutation — stays far below the 1-second limit

// ---------------------------------------------------------------- tombstones (used by the agents)

export type TombKind = "jobUrl" | "jobKey" | "signalUrl";

export async function isTombstoned(ctx: QueryCtx | MutationCtx, kind: TombKind, value: string) {
  return !!(await ctx.db
    .query("tombstones")
    .withIndex("by_kind_value", (q) => q.eq("kind", kind).eq("value", value))
    .first());
}

async function addTombstone(ctx: MutationCtx, kind: TombKind, value: string) {
  if (!value || (await isTombstoned(ctx, kind, value))) return;
  await ctx.db.insert("tombstones", { kind, value, at: Date.now() });
}

// ---------------------------------------------------------------- the nightly run

type StepResult = { done: number; more: boolean };

export const nightly = internalAction({
  args: {},
  handler: async (ctx): Promise<Record<string, number>> => {
    const steps = [
      ["skipJobsArchived", internal.retention.archiveSkipJobs],
      ["jobsDeleted", internal.retention.deleteArchivedJobs],
      ["jobDetailsDropped", internal.retention.dropArchivedJobDetails],
      ["signalTextTrimmed", internal.retention.trimSignalText],
      ["noiseDeleted", internal.retention.deleteNoiseSignals],
      ["problemsDeleted", internal.retention.deleteParkedProblems],
      ["prospectsTrimmed", internal.retention.trimClosedProspects],
      ["runsDeleted", internal.retention.deleteOldRuns],
      ["actionsDeleted", internal.retention.deleteOldActions],
      ["seenMailDeleted", internal.retention.deleteOldSeenMail],
      ["reportsDeleted", internal.retention.deleteOldReports],
    ] as const;

    const totals: Record<string, number> = {};
    for (const [name, fn] of steps) {
      let total = 0;
      for (let i = 0; i < 50; i++) {
        const r: StepResult = await ctx.runMutation(fn as any, {});
        total += r.done;
        if (!r.more) break;
      }
      totals[name] = total;
    }
    return totals;
  },
});

// ---------------------------------------------------------------- jobs

export const archiveSkipJobs = internalMutation({
  args: {},
  handler: async (ctx): Promise<StepResult> => {
    const cutoff = Date.now() - RULES.skipJobsArchiveAfter;
    const rows = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "Saved"))
      .take(400);
    let done = 0;
    for (const j of rows) {
      if (done >= BATCH) return { done, more: true };
      if (j.recommendation === "Skip" && (j.foundAt ?? j._creationTime) < cutoff) {
        await ctx.db.patch(j._id, { status: "Archived", statusChangedAt: Date.now() });
        done++;
      }
    }
    return { done, more: false };
  },
});

export const deleteArchivedJobs = internalMutation({
  args: {},
  handler: async (ctx): Promise<StepResult> => {
    const cutoff = Date.now() - RULES.archivedJobsDeleteAfter;
    const rows = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "Archived"))
      .take(200);
    let done = 0;
    for (const j of rows) {
      if (done >= BATCH) return { done, more: true };
      if ((j.statusChangedAt ?? j.foundAt ?? j._creationTime) > cutoff) continue;
      await addTombstone(ctx, "jobUrl", j.url);
      if (j.dedupeKey) await addTombstone(ctx, "jobKey", j.dedupeKey);
      const detail = await ctx.db
        .query("jobDetails")
        .withIndex("by_job", (q) => q.eq("jobId", j._id))
        .first();
      if (detail) await ctx.db.delete(detail._id);
      const files = await ctx.db
        .query("cvFiles")
        .withIndex("by_job", (q) => q.eq("jobId", j._id))
        .take(20);
      for (const f of files) {
        await ctx.storage.delete(f.storageId);
        await ctx.db.delete(f._id);
      }
      await ctx.db.delete(j._id);
      done++;
    }
    return { done, more: false };
  },
});

// Archived/rejected jobs don't need their long description any more
export const dropArchivedJobDetails = internalMutation({
  args: {},
  handler: async (ctx): Promise<StepResult> => {
    let done = 0;
    for (const status of ["Archived", "Rejected"] as const) {
      const rows = await ctx.db
        .query("jobs")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(200);
      for (const j of rows) {
        if (done >= BATCH) return { done, more: true };
        const detail = await ctx.db
          .query("jobDetails")
          .withIndex("by_job", (q) => q.eq("jobId", j._id))
          .first();
        if (detail) {
          await ctx.db.delete(detail._id);
          done++;
        }
      }
    }
    return { done, more: false };
  },
});

// ---------------------------------------------------------------- Opportunity Radar

export const trimSignalText = internalMutation({
  args: {},
  handler: async (ctx): Promise<StepResult> => {
    const cutoff = Date.now() - RULES.signalTextTrimAfter;
    let done = 0;
    for (const status of ["analyzed", "noise"] as const) {
      const rows = await ctx.db
        .query("painSignals")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(300);
      for (const s of rows) {
        if (done >= BATCH) return { done, more: true };
        if (s.text.length > 0 && s.fetchedAt < cutoff) {
          await ctx.db.patch(s._id, { text: "" });
          done++;
        }
      }
    }
    return { done, more: false };
  },
});

export const deleteNoiseSignals = internalMutation({
  args: {},
  handler: async (ctx): Promise<StepResult> => {
    const cutoff = Date.now() - RULES.noiseSignalsDeleteAfter;
    const rows = await ctx.db
      .query("painSignals")
      .withIndex("by_status", (q) => q.eq("status", "noise"))
      .take(300);
    let done = 0;
    for (const s of rows) {
      if (done >= BATCH) return { done, more: true };
      if (s.fetchedAt > cutoff) continue;
      await addTombstone(ctx, "signalUrl", s.url);
      await ctx.db.delete(s._id);
      done++;
    }
    return { done, more: false };
  },
});

export const deleteParkedProblems = internalMutation({
  args: {},
  handler: async (ctx): Promise<StepResult> => {
    const cutoff = Date.now() - RULES.parkedProblemsDeleteAfter;
    const rows = await ctx.db
      .query("problems")
      .withIndex("by_status", (q) => q.eq("status", "Parked"))
      .take(100);
    let done = 0;
    for (const p of rows) {
      if (done >= 10) return { done, more: true }; // each one also deletes its signals
      if (p.solution) continue;
      if ((p.statusChangedAt ?? p.lastSeenAt) > cutoff) continue;
      const signals = await ctx.db
        .query("painSignals")
        .withIndex("by_problem", (q) => q.eq("problemId", p._id))
        .take(200);
      for (const s of signals) {
        await addTombstone(ctx, "signalUrl", s.url);
        await ctx.db.delete(s._id);
      }
      await ctx.db.delete(p._id);
      done++;
    }
    return { done, more: false };
  },
});

// ---------------------------------------------------------------- prospects

export const trimClosedProspects = internalMutation({
  args: {},
  handler: async (ctx): Promise<StepResult> => {
    const cutoff = Date.now() - RULES.closedProspectsTrimAfter;
    let done = 0;
    for (const status of ["NotAFit", "Lost"] as const) {
      const rows = await ctx.db
        .query("prospects")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(300);
      for (const p of rows) {
        if (done >= BATCH) return { done, more: true };
        const age = p.statusChangedAt ?? p.researchedAt ?? p.foundAt;
        const bulky = p.description || p.services || p.fitReasons || p.emailsFound || p.sourceContext || p.draft;
        if (age < cutoff && bulky) {
          await ctx.db.patch(p._id, {
            description: undefined,
            services: undefined,
            fitReasons: undefined,
            emailsFound: undefined,
            sourceContext: undefined,
            hook: undefined,
            draft: undefined,
          });
          done++;
        }
      }
    }
    return { done, more: false };
  },
});

// ---------------------------------------------------------------- logs

export const deleteOldRuns = internalMutation({
  args: {},
  handler: async (ctx): Promise<StepResult> => {
    const old = await ctx.db
      .query("agentRuns")
      .withIndex("by_startedAt", (q) => q.lt("startedAt", Date.now() - RULES.agentRunsDeleteAfter))
      .take(BATCH + 1);
    for (const r of old.slice(0, BATCH)) await ctx.db.delete(r._id);
    return { done: Math.min(old.length, BATCH), more: old.length > BATCH };
  },
});

export const deleteOldActions = internalMutation({
  args: {},
  handler: async (ctx): Promise<StepResult> => {
    const old = await ctx.db
      .query("autopilotActions")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", Date.now() - RULES.autopilotActionsDeleteAfter))
      .take(200);
    let done = 0;
    for (const a of old) {
      if (done >= BATCH) return { done, more: true };
      if (a.status === "pending" || a.status === "queued" || a.status === "running") continue;
      await ctx.db.delete(a._id);
      done++;
    }
    return { done, more: false };
  },
});

export const deleteOldSeenMail = internalMutation({
  args: {},
  handler: async (ctx): Promise<StepResult> => {
    const cutoff = Date.now() - RULES.seenMailDeleteAfter;
    const rows = await ctx.db.query("seenMail").order("asc").take(BATCH + 1);
    let done = 0;
    for (const m of rows.slice(0, BATCH)) {
      if (m.at > cutoff) return { done, more: false };
      await ctx.db.delete(m._id);
      done++;
    }
    return { done, more: rows.length > BATCH && done === BATCH };
  },
});

export const deleteOldReports = internalMutation({
  args: {},
  handler: async (ctx): Promise<StepResult> => {
    let done = 0;
    const b = await ctx.db
      .query("briefings")
      .withIndex("by_date")
      .order("asc")
      .take(20);
    for (const r of b) {
      if (r.createdAt < Date.now() - RULES.briefingsDeleteAfter) {
        await ctx.db.delete(r._id);
        done++;
      }
    }
    for (const table of ["coachReports", "trendReports"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_createdAt", (q) => q.lt("createdAt", Date.now() - RULES.reportsDeleteAfter))
        .take(10);
      for (const r of rows) {
        await ctx.db.delete(r._id);
        done++;
      }
    }
    return { done, more: false };
  },
});

// =============================================================================
// ONE-TIME COMMANDS
// =============================================================================

// 1) Move job descriptions out of the jobs table (lists then read ~5x less data).
//    npx convex run retention:moveDescriptions
export const moveDescriptions = internalAction({
  args: {},
  handler: async (ctx): Promise<{ moved: number; scanned: number }> => {
    let moved = 0;
    let scanned = 0;
    let cursor: string | null = null;
    do {
      const r: { moved: number; scanned: number; cursor: string; isDone: boolean } = await ctx.runMutation(
        internal.retention.moveDescriptionsPage,
        { cursor }
      );
      moved += r.moved;
      scanned += r.scanned;
      cursor = r.isDone ? null : r.cursor;
    } while (cursor);
    return { moved, scanned };
  },
});

export const moveDescriptionsPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const res = await ctx.db.query("jobs").paginate({ cursor, numItems: 15 });
    let moved = 0;
    for (const j of res.page) {
      if (!j.description) continue;
      const existing = await ctx.db
        .query("jobDetails")
        .withIndex("by_job", (q) => q.eq("jobId", j._id))
        .first();
      if (!existing && j.status !== "Archived" && j.status !== "Rejected") {
        await ctx.db.insert("jobDetails", { jobId: j._id, description: j.description });
      }
      await ctx.db.patch(j._id, { description: undefined });
      moved++;
    }
    return { moved, scanned: res.page.length, cursor: res.continueCursor, isDone: res.isDone };
  },
});

// 2) Optional: delete the retired Lead Agent's data (leads + leadTargets, ~100 KB).
//    npx convex run retention:dropLegacyLeads   (repeat until done: true)
export const dropLegacyLeads = internalMutation({
  args: {},
  handler: async (ctx) => {
    let deleted = 0;
    for (const table of ["leads", "leadTargets"] as const) {
      const rows = await ctx.db.query(table).take(50 - deleted);
      for (const r of rows) {
        await ctx.db.delete(r._id);
        deleted++;
      }
      if (deleted >= 50) return { deleted, done: false };
    }
    return { deleted, done: true };
  },
});

// Handy for checking what the nightly run would touch, without changing anything
export const preview = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const archived = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "Archived"))
      .take(500);
    const noise = await ctx.db
      .query("painSignals")
      .withIndex("by_status", (q) => q.eq("status", "noise"))
      .take(500);
    return {
      archivedJobsToDelete: archived.filter(
        (j) => (j.statusChangedAt ?? j.foundAt ?? j._creationTime) < now - RULES.archivedJobsDeleteAfter
      ).length,
      noiseSignalsToDelete: noise.filter((s) => s.fetchedAt < now - RULES.noiseSignalsDeleteAfter).length,
      tombstones: (await ctx.db.query("tombstones").take(5000)).length,
    };
  },
});
