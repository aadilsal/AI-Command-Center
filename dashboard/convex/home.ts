import { query } from "./_generated/server";
import { getCounter } from "./counters";

// One small query that feeds the whole home screen (HUD).
// It only sends short summaries to the browser: full lists live on the detail pages.

const HOUR = 60 * 60 * 1000;
const MIN_EVIDENCE_TO_DESIGN = 2;

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // ---------- Career (index reads, never the archived pile)
    const saved = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "Saved"))
      .collect();
    const open = saved.filter((j) => j.source && j.recommendation !== "Skip");
    const topJobs = [...open]
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 5)
      .map((j) => ({
        _id: j._id,
        title: j.title,
        company: j.company,
        location: j.location,
        source: j.source,
        url: j.url,
        matchScore: j.matchScore,
        hasKit: !!j.kit,
        foundAt: j.foundAt ?? j._creationTime,
      }));
    const applied = (await ctx.db.query("jobs").withIndex("by_status", (q) => q.eq("status", "Applied")).collect()).length;
    const interview = (await ctx.db.query("jobs").withIndex("by_status", (q) => q.eq("status", "Interview")).collect()).length;
    // Jobs found per day, last 7 days (for the little bar chart)
    const foundPerDay = Array.from({ length: 7 }, (_, i) => {
      const start = now - (7 - i) * 24 * HOUR;
      const end = start + 24 * HOUR;
      return saved.filter((j) => {
        const t = j.foundAt ?? j._creationTime;
        return t >= start && t < end;
      }).length;
    });

    // ---------- Opportunity Radar + Solution Designer
    const problems = await ctx.db.query("problems").collect();
    const active = problems.filter((p) => p.status !== "Parked");
    const topProblem = [...active].sort((a, b) => b.score - a.score)[0];
    const weekAgo = now - 7 * 24 * HOUR;

    // ---------- Prospects
    const prospects = await ctx.db.query("prospects").collect();
    const pCount = (s: string) => prospects.filter((p) => p.status === s).length;
    const sources: Record<string, number> = {};
    for (const p of prospects) sources[p.source] = (sources[p.source] ?? 0) + 1;

    // ---------- Coach + Trend Scout (latest report only)
    const coach = await ctx.db.query("coachReports").withIndex("by_createdAt").order("desc").first();
    const trend = await ctx.db.query("trendReports").withIndex("by_createdAt").order("desc").first();

    // ---------- Briefing
    const briefing = await ctx.db.query("briefings").withIndex("by_date").order("desc").first();

    // ---------- Workers: status + last 7 runs each
    const agents = (await ctx.db.query("agents").collect()).filter((a) => a.status !== "disabled");
    const workers = [];
    for (const a of agents) {
      const runs = await ctx.db
        .query("agentRuns")
        .withIndex("by_name", (q) => q.eq("name", a.name))
        .order("desc")
        .take(7);
      workers.push({
        _id: a._id,
        name: a.name,
        status: a.status,
        lastRun: a.lastRun,
        lastError: a.lastError,
        lastRuns: runs.reverse().map((r) => r.outcome),
      });
    }
    const runs24h = (
      await ctx.db
        .query("agentRuns")
        .withIndex("by_startedAt", (q) => q.gte("startedAt", now - 24 * HOUR))
        .collect()
    ).length;

    return {
      career: { open: open.length, applied, interview, topJobs, foundPerDay },
      radar: {
        active: active.length,
        withSolution: active.filter((p) => p.solution).length,
        readyToDesign: active.filter((p) => !p.solution && p.signalCount >= MIN_EVIDENCE_TO_DESIGN).length,
        pendingSignals: await getCounter(ctx, "pendingSignals"),
        top: topProblem
          ? { _id: topProblem._id, title: topProblem.title, score: topProblem.score, signalCount: topProblem.signalCount, hasSolution: !!topProblem.solution }
          : null,
      },
      designer: {
        designsThisWeek: problems.filter((p) => p.solution && p.solution.generatedAt >= weekAgo).length,
        parked: problems.filter((p) => p.status === "Parked").length,
        latest: problems
          .filter((p) => p.solution)
          .sort((a, b) => b.solution!.generatedAt - a.solution!.generatedAt)
          .slice(0, 1)
          .map((p) => ({ name: p.solution!.name, problem: p.title }))[0] ?? null,
      },
      prospects: {
        total: prospects.length,
        ready: pCount("Ready"),
        contacted: pCount("Contacted"),
        replied: pCount("Replied") + pCount("Meeting") + pCount("Won"),
        sources,
      },
      coach: coach ? { createdAt: coach.createdAt, focus: coach.focusThisWeek, headline: coach.headline } : null,
      trend: trend
        ? {
            createdAt: trend.createdAt,
            trends: trend.trends.slice(0, 3).map((t) => t.name),
            idea: trend.ideas[0]?.title ?? null,
          }
        : null,
      briefing: briefing
        ? { date: briefing.date, createdAt: briefing.createdAt, headline: briefing.headline, actions: briefing.actions.slice(0, 6) }
        : null,
      workers,
      runs24h,
      agentErrors: workers.filter((w) => w.lastError).length,
    };
  },
});
