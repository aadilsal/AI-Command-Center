import { query } from "./_generated/server";

const PROBLEM_STATUSES = ["New", "Exploring", "Building", "Launched", "Parked"] as const;
const MIN_EVIDENCE_TO_DESIGN = 2;

export const summary = query({
  args: {},
  handler: async (ctx) => {
    // ---------- Jobs (only real agent-found data, never archived)
    const allJobs = (await ctx.db.query("jobs").collect()).filter((j) => j.source);
    const jobs = allJobs.filter((j) => j.status !== "Archived");
    const matchJobs = jobs
      .filter((j) => j.status === "Saved" && j.recommendation !== "Skip")
      .sort((a, b) => b.matchScore - a.matchScore);

    // ---------- Opportunity Radar
    const problems = (await ctx.db.query("problems").collect()).sort((a, b) => b.score - a.score);

    const problemCounts: Record<string, number> = Object.fromEntries(
      PROBLEM_STATUSES.map((s) => [s, 0])
    );
    for (const p of problems) problemCounts[p.status]++;

    const readyToDesign = problems.filter(
      (p) => p.status !== "Parked" && !p.solution && p.signalCount >= MIN_EVIDENCE_TO_DESIGN
    ).length;

    const pendingSignals = (
      await ctx.db
        .query("painSignals")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .collect()
    ).length;

    // ---------- Agents (hide retired ones)
    const agents = (await ctx.db.query("agents").collect()).filter((a) => a.status !== "disabled");

    return {
      // jobs
      jobCount: jobs.length,
      appliedCount: jobs.filter((j) => j.status !== "Saved").length,
      archivedJobs: allJobs.length - jobs.length,
      matchJobs,
      // radar
      problems,
      problemCounts,
      activeProblems: problems.length - problemCounts.Parked,
      readyToDesign,
      pendingSignals,
      minEvidenceToDesign: MIN_EVIDENCE_TO_DESIGN,
      // system
      agents,
    };
  },
});
