import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getCounter } from "./counters";

// Home screen (HUD) data.
//
// Counting every job / problem / prospect inside one query blew Convex's 1-second limit.
// So the heavy part is now built in the background by an ACTION that reads the tables in
// small pages and saves one small "snapshot" row. The page reads that row instantly.
// Only cheap, live things (agent status, last runs) are read fresh on every request.

const HOUR = 60 * 60 * 1000;
// Small pages: on a Chromebook, reading 100 jobs (with long descriptions) took over 1s
const JOB_PAGE = 20;
const PROBLEM_PAGE = 40;
const PROSPECT_PAGE = 60;
const MIN_EVIDENCE_TO_DESIGN = 2;
const STALE_MS = 60 * 60 * 1000; // a page visit refreshes the snapshot if it's older than this

const EMPTY = {
  career: { open: 0, applied: 0, interview: 0, topJobs: [] as TopJob[], foundPerDay: [0, 0, 0, 0, 0, 0, 0] },
  radar: { active: 0, withSolution: 0, readyToDesign: 0, pendingSignals: 0, top: null as TopProblem | null },
  designer: { designsThisWeek: 0, parked: 0, latest: null as { name: string; problem: string } | null },
  prospects: { total: 0, ready: 0, contacted: 0, replied: 0, sources: {} as Record<string, number> },
  coach: null as { createdAt: number; focus: string; headline: string } | null,
  trend: null as { createdAt: number; trends: string[]; idea: string | null } | null,
  briefing: null as {
    date: string;
    createdAt: number;
    headline: string;
    actions: { title: string; why: string; kind: string; url?: string }[];
  } | null,
};

type TopJob = {
  _id: string;
  title: string;
  company: string;
  location?: string;
  source?: string;
  url: string;
  matchScore: number;
  hasKit: boolean;
  foundAt: number;
};
type TopProblem = { _id: string; title: string; score: number; signalCount: number; hasSolution: boolean };
type Snapshot = typeof EMPTY;

// ---------------------------------------------------------------------------
// 1) What the page reads: snapshot (instant) + live worker status (small)

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const snap = await ctx.db.query("homeSnapshot").first();

    // Agent status (small table). The last-7-runs strips are a separate query: home.workers
    const workers = (await ctx.db.query("agents").collect())
      .filter((a) => a.status !== "disabled")
      .map((a) => ({ _id: a._id, name: a.name, status: a.status, lastRun: a.lastRun, lastError: a.lastError }));
    const runs24h = (
      await ctx.db
        .query("agentRuns")
        .withIndex("by_startedAt", (q) => q.gte("startedAt", now - 24 * HOUR))
        .take(500)
    ).length;

    // Autopilot (live, small index reads)
    const pending = await ctx.db
      .query("autopilotActions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(500);
    const queued = await ctx.db
      .query("autopilotActions")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .take(500);
    const dayStart = Math.floor((now + 5 * HOUR) / (24 * HOUR)) * 24 * HOUR - 5 * HOUR; // midnight PKT
    const todays = await ctx.db
      .query("autopilotActions")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", dayStart))
      .take(1000);
    const paused =
      (
        await ctx.db
          .query("autopilotSettings")
          .withIndex("by_key", (q) => q.eq("key", "_global"))
          .first()
      )?.paused ?? false;
    const repliesNew = (
      await ctx.db
        .query("inboundEmails")
        .withIndex("by_status", (q) => q.eq("status", "new"))
        .take(200)
    ).length;
    const lastReply = await ctx.db.query("inboundEmails").withIndex("by_receivedAt").order("desc").first();
    const cvProjectsCount = (await ctx.db.query("cvProjects").take(200)).filter((p) => p.include !== "never").length;
    const cvRecent = await ctx.db
      .query("cvFiles")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", now - 7 * 24 * HOUR))
      .take(200);
    const cvAgent = await ctx.db
      .query("agents")
      .withIndex("by_name", (q) => q.eq("name", "CV Builder"))
      .first();
    const gmailRow = await ctx.db
      .query("integrations")
      .withIndex("by_name", (q) => q.eq("name", "gmail"))
      .first();
    const lastDone = todays.filter((a) => a.status === "done").sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];

    return {
      ...((snap?.data as Snapshot | undefined) ?? EMPTY),
      snapshotAt: snap?.updatedAt ?? null,
      autopilot: {
        paused,
        pending: pending.length,
        queued: queued.length,
        doneToday: todays.filter((a) => a.status === "done").length,
        lastDone: lastDone ? lastDone.title : null,
      },
      replies: {
        new: repliesNew,
        last: lastReply ? { from: lastReply.fromName || lastReply.fromEmail, category: lastReply.category, at: lastReply.receivedAt } : null,
      },
      gmail: { status: gmailRow?.status ?? "missing", email: gmailRow?.email ?? null },
      cv: {
        projects: cvProjectsCount,
        builtThisWeek: cvRecent.filter((f) => f.kind === "cv").length,
        sentThisWeek: cvRecent.filter((f) => f.kind === "cv" && f.sentTo).length,
        lastSync: cvAgent?.lastRun ?? null,
      },
      workers,
      runs24h,
      agentErrors: workers.filter((w) => w.lastError).length,
    };
  },
});

// Worker telemetry for the home page: status + last 7 runs per agent (kept separate so
// neither query gets near the 1-second limit)
export const workers = query({
  args: {},
  handler: async (ctx) => {
    const agents = (await ctx.db.query("agents").collect()).filter((a) => a.status !== "disabled");
    const out = [];
    for (const a of agents) {
      const runs = await ctx.db
        .query("agentRuns")
        .withIndex("by_name", (q) => q.eq("name", a.name))
        .order("desc")
        .take(7);
      out.push({
        _id: a._id,
        name: a.name,
        status: a.status,
        lastRun: a.lastRun,
        lastError: a.lastError,
        lastRuns: runs.reverse().map((r) => r.outcome),
      });
    }
    return out;
  },
});

// Called by the home page when it opens: rebuild the snapshot if it's old.
export const requestRefresh = mutation({
  args: {},
  handler: async (ctx) => {
    const snap = await ctx.db.query("homeSnapshot").first();
    const now = Date.now();
    if (snap && now - snap.updatedAt < STALE_MS) return { scheduled: false };
    if (snap?.refreshingAt && now - snap.refreshingAt < 2 * 60 * 1000) return { scheduled: false };
    if (snap) await ctx.db.patch(snap._id, { refreshingAt: now });
    await ctx.scheduler.runAfter(0, internal.home.refresh, {});
    return { scheduled: true };
  },
});

// ---------------------------------------------------------------------------
// 2) Background builder (cron every 5 min + on page visit)

export const refresh = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * HOUR;

    // ----- Career: walk "Saved" jobs page by page, keep only small fields
    let open = 0;
    let top: TopJob[] = [];
    const foundPerDay = [0, 0, 0, 0, 0, 0, 0];
    let cursor: string | null = null;
    do {
      const res: { items: (TopJob & { openMatch: boolean })[]; cursor: string; isDone: boolean } =
        await ctx.runQuery(internal.home.jobsChunk, { status: "Saved", cursor });
      for (const j of res.items) {
        const dayIndex = 6 - Math.floor((now - j.foundAt) / (24 * HOUR));
        if (dayIndex >= 0 && dayIndex <= 6) foundPerDay[dayIndex]++;
        if (!j.openMatch) continue;
        open++;
        top.push(j);
      }
      top = top.sort((a, b) => b.matchScore - a.matchScore).slice(0, 5);
      cursor = res.isDone ? null : res.cursor;
    } while (cursor);

    const applied: number = await ctx.runAction(internal.home.countJobs, { status: "Applied" });
    const interview: number = await ctx.runAction(internal.home.countJobs, { status: "Interview" });

    // ----- Radar + Solution Designer
    let active = 0;
    let withSolution = 0;
    let readyToDesign = 0;
    let parked = 0;
    let designsThisWeek = 0;
    let topProblem: TopProblem | null = null;
    let latest: { name: string; problem: string; at: number } | null = null;
    cursor = null;
    do {
      const res: {
        items: {
          _id: string;
          title: string;
          score: number;
          signalCount: number;
          status?: string;
          solutionName: string | null;
          solutionAt: number | null;
        }[];
        cursor: string;
        isDone: boolean;
      } = await ctx.runQuery(internal.home.problemsChunk, { cursor });
      for (const p of res.items) {
        if (p.solutionAt && p.solutionAt >= weekAgo) designsThisWeek++;
        if (p.solutionName && p.solutionAt && (!latest || p.solutionAt > latest.at)) {
          latest = { name: p.solutionName, problem: p.title, at: p.solutionAt };
        }
        if (p.status === "Parked") {
          parked++;
          continue;
        }
        active++;
        if (p.solutionName) withSolution++;
        else if (p.signalCount >= MIN_EVIDENCE_TO_DESIGN) readyToDesign++;
        if (!topProblem || p.score > topProblem.score) {
          topProblem = { _id: p._id, title: p.title, score: p.score, signalCount: p.signalCount, hasSolution: !!p.solutionName };
        }
      }
      cursor = res.isDone ? null : res.cursor;
    } while (cursor);

    // ----- Prospects
    const prospects = { total: 0, ready: 0, contacted: 0, replied: 0, sources: {} as Record<string, number> };
    cursor = null;
    do {
      const res: { items: { status?: string; source: string }[]; cursor: string; isDone: boolean } =
        await ctx.runQuery(internal.home.prospectsChunk, { cursor });
      for (const p of res.items) {
        prospects.total++;
        if (p.status === "Ready") prospects.ready++;
        if (p.status === "Contacted") prospects.contacted++;
        if (p.status === "Replied" || p.status === "Meeting" || p.status === "Won") prospects.replied++;
        prospects.sources[p.source] = (prospects.sources[p.source] ?? 0) + 1;
      }
      cursor = res.isDone ? null : res.cursor;
    } while (cursor);

    // ----- Small things: latest reports, briefing, counter
    const small: Pick<Snapshot, "coach" | "trend" | "briefing"> & { pendingSignals: number } = await ctx.runQuery(
      internal.home.smallParts,
      {}
    );

    const data: Snapshot = {
      career: { open, applied, interview, topJobs: top, foundPerDay },
      radar: { active, withSolution, readyToDesign, pendingSignals: small.pendingSignals, top: topProblem },
      designer: { designsThisWeek, parked, latest: latest ? { name: latest.name, problem: latest.problem } : null },
      prospects,
      coach: small.coach,
      trend: small.trend,
      briefing: small.briefing,
    };
    await ctx.runMutation(internal.home.saveSnapshot, { data });
    return { open, active, prospects: prospects.total };
  },
});

// Counting Applied / Interview jobs, page by page
export const countJobs = internalAction({
  args: { status: v.string() },
  handler: async (ctx, { status }): Promise<number> => {
    let n = 0;
    let cursor: string | null = null;
    do {
      const res: { items: unknown[]; cursor: string; isDone: boolean } = await ctx.runQuery(internal.home.jobsChunk, {
        status,
        cursor,
      });
      n += res.items.length;
      cursor = res.isDone ? null : res.cursor;
    } while (cursor);
    return n;
  },
});

// ---------------------------------------------------------------------------
// 3) Small page readers (each one stays far below the 1s limit)

const jobStatus = v.union(
  v.literal("Saved"),
  v.literal("Applied"),
  v.literal("Interview"),
  v.literal("Rejected"),
  v.literal("Offer"),
  v.literal("Archived")
);

export const jobsChunk = internalQuery({
  args: { status: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { status, cursor }) => {
    const s = status as typeof jobStatus.type;
    const res = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", s))
      .paginate({ cursor, numItems: JOB_PAGE });
    return {
      items: res.page.map((j) => ({
        _id: j._id as string,
        title: j.title,
        company: j.company,
        location: j.location,
        source: j.source,
        url: j.url,
        matchScore: j.matchScore,
        hasKit: !!j.kit,
        foundAt: j.foundAt ?? j._creationTime,
        openMatch: !!j.source && j.recommendation !== "Skip",
      })),
      cursor: res.continueCursor,
      isDone: res.isDone,
    };
  },
});

export const problemsChunk = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const res = await ctx.db.query("problems").paginate({ cursor, numItems: PROBLEM_PAGE });
    return {
      items: res.page.map((p) => ({
        _id: p._id as string,
        title: p.title,
        score: p.score,
        signalCount: p.signalCount,
        status: p.status as string | undefined,
        solutionName: p.solution?.name ?? null,
        solutionAt: p.solution?.generatedAt ?? null,
      })),
      cursor: res.continueCursor,
      isDone: res.isDone,
    };
  },
});

export const prospectsChunk = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const res = await ctx.db.query("prospects").paginate({ cursor, numItems: PROSPECT_PAGE });
    return {
      items: res.page.map((p) => ({ status: p.status as string | undefined, source: p.source })),
      cursor: res.continueCursor,
      isDone: res.isDone,
    };
  },
});

export const smallParts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const coach = await ctx.db.query("coachReports").withIndex("by_createdAt").order("desc").first();
    const trend = await ctx.db.query("trendReports").withIndex("by_createdAt").order("desc").first();
    const briefing = await ctx.db.query("briefings").withIndex("by_date").order("desc").first();
    return {
      pendingSignals: await getCounter(ctx, "pendingSignals"),
      coach: coach ? { createdAt: coach.createdAt, focus: coach.focusThisWeek, headline: coach.headline } : null,
      trend: trend
        ? {
            createdAt: trend.createdAt,
            trends: trend.trends.slice(0, 3).map((t) => t.name),
            idea: trend.ideas[0]?.title ?? null,
          }
        : null,
      briefing: briefing
        ? {
            date: briefing.date,
            createdAt: briefing.createdAt,
            headline: briefing.headline,
            actions: briefing.actions.slice(0, 6).map((a) => ({ title: a.title, why: a.why, kind: a.kind, url: a.url })),
          }
        : null,
    };
  },
});

export const saveSnapshot = internalMutation({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    const existing = await ctx.db.query("homeSnapshot").first();
    if (existing) {
      await ctx.db.patch(existing._id, { data, updatedAt: Date.now(), refreshingAt: undefined });
    } else {
      await ctx.db.insert("homeSnapshot", { data, updatedAt: Date.now() });
    }
  },
});
