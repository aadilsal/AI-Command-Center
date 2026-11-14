import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";

// =============================================================================
// AUTOPILOT — the part of the Command Center that does the work for you.
//
// Every automatic step is an "action". Before anything runs it goes through ONE gate:
//   mode "off"   → never happens
//   mode "draft" → lands in your approval queue ("Waiting for you")
//   mode "auto"  → runs by itself, up to a daily cap
// A global Pause switch stops everything. Every action is logged with its result.
//
// Today's actions only write things inside your system (kits, solution docs, follow-up
// drafts). Actions that leave your system (sending emails, applying) are listed but
// stay locked until Gmail is connected.
// =============================================================================

export type Mode = "off" | "draft" | "auto";

export const POLICIES = {
  autoKit: {
    label: "Write application kits for strong job matches",
    agent: "Career",
    defaultMode: "auto" as Mode,
    dailyCap: 6,
    minScore: 80,
    available: true,
  },
  autoDesign: {
    label: "Design solutions for problems with enough evidence",
    agent: "Radar",
    defaultMode: "auto" as Mode,
    dailyCap: 3,
    minScore: 55,
    available: true,
  },
  autoFollowUpDraft: {
    label: "Write follow-up emails when they're due",
    agent: "Prospects",
    defaultMode: "auto" as Mode,
    dailyCap: 10,
    minScore: 0,
    available: true,
  },
  // --- Unlocked once Gmail is connected (next step) ---
  sendIntro: { label: "Send first emails to ready prospects", agent: "Prospects", defaultMode: "draft" as Mode, dailyCap: 15, minScore: 60, available: false },
  sendFollowUp: { label: "Send due follow-ups", agent: "Prospects", defaultMode: "draft" as Mode, dailyCap: 20, minScore: 0, available: false },
  replyTriage: { label: "Read replies and answer simple ones", agent: "Replies", defaultMode: "draft" as Mode, dailyCap: 30, minScore: 0, available: false },
  applyByEmail: { label: "Apply to jobs that accept email applications", agent: "Career", defaultMode: "draft" as Mode, dailyCap: 5, minScore: 85, available: false },
} as const;

export type PolicyKey = keyof typeof POLICIES;
const POLICY_KEYS = Object.keys(POLICIES) as PolicyKey[];
const AGENT_NAME = "Autopilot";
const DAY = 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 8;
const RUN_BUDGET_MS = 7 * 60 * 1000; // stay well under Convex's 10-minute action limit

// ---------------------------------------------------------------- helpers

async function getSettings(ctx: { db: any }) {
  const rows: Doc<"autopilotSettings">[] = await ctx.db.query("autopilotSettings").collect();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const paused = byKey.get("_global")?.paused ?? false;
  const policies = POLICY_KEYS.map((key) => {
    const p = POLICIES[key];
    const row = byKey.get(key);
    return {
      key,
      label: p.label,
      agent: p.agent,
      available: p.available,
      mode: (p.available ? (row?.mode ?? p.defaultMode) : "off") as Mode,
      dailyCap: row?.dailyCap ?? p.dailyCap,
      minScore: row?.minScore ?? p.minScore,
    };
  });
  return { paused, policies };
}

function startOfTodayPKT(now: number) {
  const offset = 5 * 60 * 60 * 1000;
  return Math.floor((now + offset) / DAY) * DAY - offset;
}

// ---------------------------------------------------------------- dashboard queries

export const state = query({
  args: {},
  handler: async (ctx) => {
    const { paused, policies } = await getSettings(ctx);
    const today = startOfTodayPKT(Date.now());
    const todays = await ctx.db
      .query("autopilotActions")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", today))
      .take(1000);
    const pending = await ctx.db
      .query("autopilotActions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(500);
    const queued = await ctx.db
      .query("autopilotActions")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .take(500);
    return {
      paused,
      pendingCount: pending.length,
      queuedCount: queued.length,
      doneToday: todays.filter((a) => a.status === "done").length,
      failedToday: todays.filter((a) => a.status === "failed").length,
      policies: policies.map((p) => ({
        ...p,
        usedToday: todays.filter((a) => a.kind === p.key && ["queued", "running", "done"].includes(a.status)).length,
      })),
    };
  },
});

export const actionsPage = query({
  args: { status: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { status, paginationOpts }) => {
    if (status) {
      return await ctx.db
        .query("autopilotActions")
        .withIndex("by_status", (q) => q.eq("status", status as Doc<"autopilotActions">["status"]))
        .order("desc")
        .paginate(paginationOpts);
    }
    return await ctx.db.query("autopilotActions").withIndex("by_createdAt").order("desc").paginate(paginationOpts);
  },
});

// ---------------------------------------------------------------- your controls

export const setPaused = mutation({
  args: { paused: v.boolean() },
  handler: async (ctx, { paused }) => {
    const row = await ctx.db
      .query("autopilotSettings")
      .withIndex("by_key", (q) => q.eq("key", "_global"))
      .first();
    if (row) await ctx.db.patch(row._id, { paused });
    else await ctx.db.insert("autopilotSettings", { key: "_global", paused });
    if (!paused) await ctx.scheduler.runAfter(0, internal.autopilot.processQueue, {});
  },
});

export const setPolicy = mutation({
  args: {
    key: v.string(),
    mode: v.optional(v.union(v.literal("off"), v.literal("draft"), v.literal("auto"))),
    dailyCap: v.optional(v.number()),
    minScore: v.optional(v.number()),
  },
  handler: async (ctx, { key, mode, dailyCap, minScore }) => {
    if (!(key in POLICIES)) throw new Error(`Unknown autopilot action: ${key}`);
    if (!POLICIES[key as PolicyKey].available) throw new Error("This one unlocks after Gmail is connected");
    const row = await ctx.db
      .query("autopilotSettings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    const patch = {
      ...(mode !== undefined && { mode }),
      ...(dailyCap !== undefined && { dailyCap: Math.max(0, Math.min(100, Math.round(dailyCap))) }),
      ...(minScore !== undefined && { minScore: Math.max(0, Math.min(100, Math.round(minScore))) }),
    };
    if (row) await ctx.db.patch(row._id, patch);
    else await ctx.db.insert("autopilotSettings", { key, ...patch });
  },
});

export const approve = mutation({
  args: { id: v.id("autopilotActions") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a || a.status !== "pending") return;
    await ctx.db.patch(id, { status: "queued", decidedAt: Date.now(), decidedBy: "you" });
    await ctx.scheduler.runAfter(0, internal.autopilot.processQueue, {});
  },
});

export const reject = mutation({
  args: { id: v.id("autopilotActions") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a || a.status !== "pending") return;
    await ctx.db.patch(id, { status: "rejected", decidedAt: Date.now(), decidedBy: "you" });
  },
});

export const approveAll = mutation({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("autopilotActions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(100);
    for (const a of pending) await ctx.db.patch(a._id, { status: "queued", decidedAt: Date.now(), decidedBy: "you" });
    if (pending.length) await ctx.scheduler.runAfter(0, internal.autopilot.processQueue, {});
    return { approved: pending.length };
  },
});

// "Run autopilot now" button
export const runNow = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.autopilot.sweep, {});
  },
});

// ---------------------------------------------------------------- the gate

export const propose = internalMutation({
  args: {
    kind: v.string(),
    targetId: v.string(),
    title: v.string(),
    detail: v.optional(v.string()),
    href: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<"queued" | "pending" | "skipped"> => {
    const { paused, policies } = await getSettings(ctx);
    const policy = policies.find((p) => p.key === a.kind);
    if (paused || !policy || policy.mode === "off") return "skipped";

    // Never repeat work: skip if this exact thing was already proposed
    // (a failed attempt may retry after a day; a rejected one never comes back)
    const existing = await ctx.db
      .query("autopilotActions")
      .withIndex("by_target", (q) => q.eq("targetId", a.targetId).eq("kind", a.kind))
      .order("desc")
      .first();
    if (existing && !(existing.status === "failed" && Date.now() - existing.createdAt > DAY)) return "skipped";

    // Daily cap (counts what was queued/done today, plus what's waiting for you)
    const today = startOfTodayPKT(Date.now());
    const todays = await ctx.db
      .query("autopilotActions")
      .withIndex("by_kind", (q) => q.eq("kind", a.kind).gte("createdAt", today))
      .take(200);
    const used = todays.filter((x) => ["queued", "running", "done", "pending"].includes(x.status)).length;
    if (used >= policy.dailyCap) return "skipped";

    const status = policy.mode === "auto" ? "queued" : "pending";
    await ctx.db.insert("autopilotActions", {
      kind: a.kind,
      agent: policy.agent,
      targetId: a.targetId,
      title: a.title,
      detail: a.detail,
      href: a.href,
      status,
      createdAt: Date.now(),
      ...(status === "queued" && { decidedBy: "autopilot", decidedAt: Date.now() }),
    });
    return status;
  },
});

// ---------------------------------------------------------------- finding work (every hour)

export const sweep = internalAction({
  args: {},
  handler: async (ctx): Promise<{ proposed: Record<string, number> } | { paused: true }> => {
    const settings: { paused: boolean; policies: { key: string; mode: Mode; minScore: number }[] } =
      await ctx.runQuery(internal.autopilot.settingsInternal, {});
    if (settings.paused) return { paused: true };
    const mode = (k: string) => settings.policies.find((p) => p.key === k);
    const proposed: Record<string, number> = {};
    const add = async (kind: string, targetId: string, title: string, detail?: string, href?: string) => {
      const r: string = await ctx.runMutation(internal.autopilot.propose, { kind, targetId, title, detail, href });
      if (r !== "skipped") proposed[kind] = (proposed[kind] ?? 0) + 1;
    };

    // Career: strong matches without a kit
    const kit = mode("autoKit");
    if (kit && kit.mode !== "off") {
      let cursor: string | null = null;
      const found: { _id: string; title: string; company: string; matchScore: number }[] = [];
      do {
        const res: { items: typeof found; cursor: string; isDone: boolean } = await ctx.runQuery(
          internal.autopilot.kitCandidates,
          { cursor, minScore: kit.minScore }
        );
        found.push(...res.items);
        cursor = res.isDone ? null : res.cursor;
      } while (cursor);
      found.sort((x, y) => y.matchScore - x.matchScore);
      for (const j of found.slice(0, 20)) {
        await add("autoKit", j._id, `Write kit: ${j.title} @ ${j.company}`, `Match ${j.matchScore}%`, "/career");
      }
    }

    // Radar: problems with enough evidence and no solution yet
    const design = mode("autoDesign");
    if (design && design.mode !== "off") {
      const problems: { _id: string; title: string; score: number; signalCount: number }[] = await ctx.runQuery(
        internal.autopilot.designCandidates,
        { minScore: design.minScore }
      );
      for (const p of problems.slice(0, 10)) {
        await add("autoDesign", p._id, `Design solution: ${p.title}`, `Score ${p.score} · ${p.signalCount} evidence`, "/radar");
      }
    }

    // Prospects: follow-ups due with no draft written
    const fu = mode("autoFollowUpDraft");
    if (fu && fu.mode !== "off") {
      const due: { _id: string; name: string; n: number }[] = await ctx.runQuery(internal.autopilot.followUpCandidates, {});
      for (const p of due) {
        // targetId includes the follow-up number, so follow-up 2 isn't blocked by follow-up 1
        await add("autoFollowUpDraft", `${p._id}#${p.n + 1}`, `Write follow-up ${p.n + 1}: ${p.name}`, undefined, "/prospects");
      }
    }

    // Do the work in a separate run, so finding + doing never hit the 10-minute limit together
    await ctx.scheduler.runAfter(0, internal.autopilot.processQueue, {});
    return { proposed };
  },
});

export const settingsInternal = internalQuery({
  args: {},
  handler: async (ctx) => await getSettings(ctx),
});

export const kitCandidates = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), minScore: v.number() },
  handler: async (ctx, { cursor, minScore }) => {
    const res = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "Saved"))
      .paginate({ cursor, numItems: 100 });
    return {
      items: res.page
        .filter((j) => j.source && !j.kit && j.recommendation !== "Skip" && j.matchScore >= minScore)
        .map((j) => ({ _id: j._id as string, title: j.title, company: j.company, matchScore: j.matchScore })),
      cursor: res.continueCursor,
      isDone: res.isDone,
    };
  },
});

export const designCandidates = internalQuery({
  args: { minScore: v.number() },
  handler: async (ctx, { minScore }) => {
    const out = [];
    for (const status of ["New", "Exploring"] as const) {
      const rows = await ctx.db
        .query("problems")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(300);
      for (const p of rows) {
        if (!p.solution && p.signalCount >= 2 && p.score >= minScore) {
          out.push({ _id: p._id as string, title: p.title, score: p.score, signalCount: p.signalCount });
        }
      }
    }
    return out.sort((a, b) => b.score - a.score);
  },
});

export const followUpCandidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("prospects")
      .withIndex("by_status", (q) => q.eq("status", "Contacted"))
      .take(500);
    return rows
      .filter((p) => {
        if (p.draft || !p.lastContactAt) return false;
        const n = p.followUpsSent ?? 0;
        if (n === 0) return now - p.lastContactAt > 4 * DAY;
        if (n === 1) return now - p.lastContactAt > 5 * DAY;
        return false;
      })
      .map((p) => ({ _id: p._id as string, name: p.name, n: p.followUpsSent ?? 0 }));
  },
});

// ---------------------------------------------------------------- doing the work

export const processQueue = internalAction({
  args: {},
  handler: async (ctx): Promise<{ done: number; failed: number } | { skipped: string }> => {
    const settings: { paused: boolean } = await ctx.runQuery(internal.autopilot.settingsInternal, {});
    if (settings.paused) return { skipped: "paused" };
    const started: boolean = await ctx.runMutation(internal.agentStatus.tryStart, { name: AGENT_NAME });
    if (!started) return { skipped: "already running" };

    const t0 = Date.now();
    let done = 0;
    let failed = 0;
    let stopNote: string | null = null;

    try {
      for (let i = 0; i < MAX_PER_RUN && Date.now() - t0 < RUN_BUDGET_MS; i++) {
        const next: Doc<"autopilotActions"> | null = await ctx.runMutation(internal.autopilot.claimNext, {});
        if (!next) break;
        try {
          const result = await execute(ctx, next);
          await ctx.runMutation(internal.autopilot.finish, { id: next._id, status: "done", result });
          done++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/limit reached/i.test(msg)) {
            // Groq daily quota: put it back and stop for now
            await ctx.runMutation(internal.autopilot.finish, { id: next._id, status: "queued", result: msg });
            stopNote = msg;
            break;
          }
          await ctx.runMutation(internal.autopilot.finish, { id: next._id, status: "failed", result: msg.slice(0, 400) });
          failed++;
        }
      }
    } finally {
      await ctx.runMutation(internal.agentStatus.set, {
        name: AGENT_NAME,
        status: "idle",
        lastRun: Date.now(),
        lastError: stopNote ?? (failed > 0 && done === 0 ? `${failed} action(s) failed — see Autopilot log` : null),
      });
    }

    // More waiting? Continue in a minute (fresh 10-minute budget)
    if (!stopNote) {
      const more: boolean = await ctx.runQuery(internal.autopilot.hasQueued, {});
      if (more) await ctx.scheduler.runAfter(60 * 1000, internal.autopilot.processQueue, {});
    }
    return { done, failed };
  },
});

async function execute(ctx: any, a: Doc<"autopilotActions">): Promise<string> {
  switch (a.kind) {
    case "autoKit": {
      await ctx.runAction(api.applicationKit.generateKit, { id: a.targetId as Id<"jobs"> });
      return "Kit written — open Career to review and apply";
    }
    case "autoDesign": {
      const r: any = await ctx.runAction(api.solutionDesigner.designSolution, {
        id: a.targetId as Id<"problems">,
        force: false,
      });
      if (r?.viable === false) return `Parked by viability check: ${r.parkedReason ?? "not viable"}`;
      if (r?.needsMoreEvidence) return r.message ?? "Needs more evidence";
      return "Solution designed — open Radar to read it";
    }
    case "autoFollowUpDraft": {
      const id = a.targetId.split("#")[0] as Id<"prospects">;
      await ctx.runAction(api.prospectAgent.draftFollowUp, { id });
      return "Follow-up drafted — open Prospects to send it";
    }
    default:
      throw new Error(`No executor for "${a.kind}" yet`);
  }
}

export const claimNext = internalMutation({
  args: {},
  handler: async (ctx) => {
    const next = await ctx.db
      .query("autopilotActions")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .order("asc")
      .first();
    if (!next) return null;
    await ctx.db.patch(next._id, { status: "running", startedAt: Date.now() });
    return { ...next, status: "running" as const };
  },
});

export const finish = internalMutation({
  args: {
    id: v.id("autopilotActions"),
    status: v.union(v.literal("done"), v.literal("failed"), v.literal("queued")),
    result: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, result }) => {
    await ctx.db.patch(id, { status, result, ...(status !== "queued" && { finishedAt: Date.now() }) });
  },
});

export const hasQueued = internalQuery({
  args: {},
  handler: async (ctx) =>
    !!(await ctx.db
      .query("autopilotActions")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .first()),
});

// Watchdog: an action stuck in "running" (computer slept) goes back to the queue
export const unstick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const running = await ctx.db
      .query("autopilotActions")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .take(50);
    let n = 0;
    for (const a of running) {
      if (a.startedAt && Date.now() - a.startedAt > 15 * 60 * 1000) {
        await ctx.db.patch(a._id, { status: "queued" });
        n++;
      }
    }
    return { requeued: n };
  },
});
