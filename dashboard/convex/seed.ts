import { mutation } from "./_generated/server";

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const inserted = { jobs: 0, leads: 0, agents: 0 };

    const jobs = [
      {
        title: "Senior Full Stack Engineer",
        company: "Hostaway",
        url: "https://example.com/jobs/hostaway-senior-fullstack",
        matchScore: 95,
        status: "Saved" as const,
      },
      {
        title: "AI Engineer (Remote)",
        company: "Example AI Co",
        url: "https://example.com/jobs/example-ai-engineer",
        matchScore: 82,
        status: "Applied" as const,
      },
    ];

    for (const job of jobs) {
      const exists = await ctx.db
        .query("jobs")
        .withIndex("by_url", (q) => q.eq("url", job.url))
        .first();
      if (!exists) {
        await ctx.db.insert("jobs", job);
        inserted.jobs++;
      }
    }

    const leads = [
      {
        company: "Healthcare Clinic Network",
        industry: "Healthcare",
        problem: "Manual appointment handling",
        solution: "AI WhatsApp booking assistant",
        priority: "High" as const,
      },
      {
        company: "Lahore Property Group",
        industry: "Real estate",
        problem: "Leads from portals tracked in spreadsheets",
        solution: "Lead intake + follow-up automation",
        priority: "Medium" as const,
      },
    ];

    for (const lead of leads) {
      const exists = await ctx.db
        .query("leads")
        .withIndex("by_company", (q) => q.eq("company", lead.company))
        .first();
      if (!exists) {
        await ctx.db.insert("leads", lead);
        inserted.leads++;
      }
    }

    const agents = [
      { name: "Career Agent", status: "idle" as const },
      { name: "Lead Agent", status: "idle" as const },
      { name: "Content Agent", status: "disabled" as const },
    ];

    for (const agent of agents) {
      const exists = await ctx.db
        .query("agents")
        .withIndex("by_name", (q) => q.eq("name", agent.name))
        .first();
      if (!exists) {
        await ctx.db.insert("agents", agent);
        inserted.agents++;
      }
    }

    return { ...inserted, seededAt: now };
  },
});
