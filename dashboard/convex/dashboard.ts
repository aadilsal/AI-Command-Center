import { query } from "./_generated/server";

const LEAD_STATUSES = ["New", "Contacted", "Replied", "Won", "Lost"] as const;

export const summary = query({
  args: {},
  handler: async (ctx) => {
    // Only real agent-found data (seed rows have no source), never archived
    const allJobs = (await ctx.db.query("jobs").collect()).filter((j) => j.source);
    const jobs = allJobs.filter((j) => j.status !== "Archived");
    const allLeads = (await ctx.db.query("leads").collect()).filter((l) => l.source);
    const leads = allLeads.filter(
      (l) => l.status !== "Not a fit" && l.status !== "Archived"
    );
    const agents = await ctx.db.query("agents").collect();

    // Jobs you haven't acted on, best first (the page paginates these)
    const matchJobs = jobs
      .filter((j) => j.status === "Saved" && j.recommendation !== "Skip")
      .sort((a, b) => b.matchScore - a.matchScore);

    const statusCounts: Record<string, number> = Object.fromEntries(
      LEAD_STATUSES.map((s) => [s, 0])
    );
    for (const l of leads) statusCounts[l.status ?? "New"]++;

    const sortedLeads = [...leads].sort(
      (a, b) =>
        (b.fitScore ?? 0) - (a.fitScore ?? 0) || (b.foundAt ?? 0) - (a.foundAt ?? 0)
    );

    return {
      jobCount: jobs.length,
      appliedCount: jobs.filter((j) => j.status !== "Saved").length,
      archivedJobs: allJobs.length - jobs.length,
      leadCount: leads.length,
      archivedLeads: allLeads.filter((l) => l.status === "Archived").length,
      newLeads: statusCounts.New,
      highPriorityLeads: leads.filter(
        (l) => l.priority === "High" && (l.status ?? "New") === "New"
      ).length,
      statusCounts,
      matchJobs,
      leads: sortedLeads,
      agents,
    };
  },
});
