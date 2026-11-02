import { internalMutation } from "./_generated/server";
import { CATEGORIES, isGenericName } from "./osm";

// Run after changing pitches in osm.ts: npx convex run leadMaintenance:refreshPitches
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
        draft: undefined, // old draft used the old pitch
      });
      updated++;
    }

    return { updated, genericRemoved };
  },
});
