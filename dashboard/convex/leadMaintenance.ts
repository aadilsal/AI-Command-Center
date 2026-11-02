import { internalMutation } from "./_generated/server";
import { CATEGORIES, isGenericName } from "./osm";

// Retire the Lead Agent: archive its leads (kept, never deleted) and show it as disabled.
// Run once: npx convex run leadMaintenance:retireLeadAgent
export const retireLeadAgent = internalMutation({
  args: {},
  handler: async (ctx) => {
    let archived = 0;
    for (const lead of await ctx.db.query("leads").collect()) {
      if (lead.status === "Archived") continue;
      await ctx.db.patch(lead._id, { status: "Archived", statusChangedAt: Date.now() });
      archived++;
    }

    const agent = await ctx.db
      .query("agents")
      .withIndex("by_name", (q) => q.eq("name", "Lead Agent"))
      .first();
    if (agent) {
      await ctx.db.patch(agent._id, {
        status: "disabled",
        lastError: undefined,
      });
    }

    return { leadsArchived: archived, leadAgent: "disabled" };
  },
});

// Kept for reference: refresh lead pitches from osm.ts categories
export const refreshPitches = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;
    let genericRemoved = 0;

    for (const lead of await ctx.db.query("leads").collect()) {
      if (lead.source !== "OpenStreetMap" || !lead.category) continue;
      const cat = CATEGORIES[lead.category];
      if (!cat) continue;

      if (isGenericName(lead.company, lead.category) && (lead.status ?? "New") === "New") {
        await ctx.db.patch(lead._id, { status: "Not a fit", statusChangedAt: Date.now() });
        genericRemoved++;
        continue;
      }

      await ctx.db.patch(lead._id, {
        problem: cat.problem,
        solution: cat.solution,
        draft: undefined,
      });
      updated++;
    }

    return { updated, genericRemoved };
  },
});
