import { v } from "convex/values";
import { mutation } from "./_generated/server";

// "What's new since my last visit" for the detail pages.
//
// Each page keeps two timestamps:
//   seenAt   – when the current visit (session) started
//   previous – when the visit before that started  → everything newer is "NEW"
// Re-opening a page within 30 minutes counts as the same visit, so NEW badges
// don't vanish when you hop between pages or refresh.

const SESSION_MS = 30 * 60 * 1000;
const FIRST_VISIT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export const visit = mutation({
  args: { page: v.string() },
  handler: async (ctx, { page }) => {
    const now = Date.now();
    const row = await ctx.db
      .query("pageVisits")
      .withIndex("by_page", (q) => q.eq("page", page))
      .first();

    if (!row) {
      const previous = now - FIRST_VISIT_LOOKBACK_MS;
      await ctx.db.insert("pageVisits", { page, seenAt: now, previous });
      return previous;
    }
    if (now - row.seenAt < SESSION_MS) {
      await ctx.db.patch(row._id, { seenAt: now }); // keep the session alive
      return row.previous;
    }
    await ctx.db.patch(row._id, { previous: row.seenAt, seenAt: now });
    return row.seenAt;
  },
});

// "Mark all as seen": nothing on this page counts as new any more
export const markAllSeen = mutation({
  args: { page: v.string() },
  handler: async (ctx, { page }) => {
    const now = Date.now();
    const row = await ctx.db
      .query("pageVisits")
      .withIndex("by_page", (q) => q.eq("page", page))
      .first();
    if (row) await ctx.db.patch(row._id, { previous: now, seenAt: now });
    else await ctx.db.insert("pageVisits", { page, seenAt: now, previous: now });
    return now;
  },
});
