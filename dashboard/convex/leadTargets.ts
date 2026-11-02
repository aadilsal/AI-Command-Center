import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { CATEGORIES } from "./osm";

const DEFAULT_CITIES = [
  "Lahore, Pakistan",
  "Islamabad, Pakistan",
  "Toronto, Canada",
  "Houston, Texas, USA",
];

// Run once: npx convex run leadTargets:seedTargets  (safe to re-run; skips existing rows)
export const seedTargets = mutation({
  args: {},
  handler: async (ctx) => {
    let added = 0;
    for (const city of DEFAULT_CITIES) {
      for (const category of Object.keys(CATEGORIES)) {
        const exists = await ctx.db
          .query("leadTargets")
          .withIndex("by_city_category", (q) => q.eq("city", city).eq("category", category))
          .first();
        if (!exists) {
          await ctx.db.insert("leadTargets", { city, category, enabled: true });
          added++;
        }
      }
    }
    return { added };
  },
});

// For the dashboard / quick checks
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("leadTargets").collect();
  },
});

// Agent: enabled targets, never-scanned first, then least recently scanned
export const nextToScan = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const targets = (await ctx.db.query("leadTargets").collect()).filter(
      (t) => t.enabled && CATEGORIES[t.category]
    );
    targets.sort((a, b) => (a.lastScannedAt ?? 0) - (b.lastScannedAt ?? 0));
    return targets.slice(0, limit);
  },
});

// Agent: cache a geocoded bounding box on every row for that city
export const cacheBbox = internalMutation({
  args: { city: v.string(), bbox: v.array(v.number()) },
  handler: async (ctx, { city, bbox }) => {
    const rows = (await ctx.db.query("leadTargets").collect()).filter((t) => t.city === city);
    for (const row of rows) await ctx.db.patch(row._id, { bbox });
  },
});

// Agent: record a finished scan
export const markScanned = internalMutation({
  args: { id: v.id("leadTargets"), found: v.number() },
  handler: async (ctx, { id, found }) => {
    await ctx.db.patch(id, { lastScannedAt: Date.now(), lastFound: found });
  },
});
