import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";

// Cheap running totals, so the dashboard never has to scan big tables to count rows.

export async function getCounter(ctx: QueryCtx, key: string): Promise<number> {
  const row = await ctx.db
    .query("counters")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  return row?.value ?? 0;
}

export async function addToCounter(ctx: MutationCtx, key: string, delta: number) {
  if (delta === 0) return;
  const row = await ctx.db
    .query("counters")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  if (row) {
    await ctx.db.patch(row._id, { value: Math.max(0, row.value + delta) });
  } else {
    await ctx.db.insert("counters", { key, value: Math.max(0, delta) });
  }
}

export const setCounter = internalMutation({
  args: { key: v.string(), value: v.number() },
  handler: async (ctx, { key, value }) => {
    const row = await ctx.db
      .query("counters")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert("counters", { key, value });
  },
});

// Counts pending signals one page at a time (each page stays well under the 1s limit)
export const countPendingPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("painSignals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .paginate({ cursor, numItems: 100 });
    return { count: page.page.length, cursor: page.continueCursor, done: page.isDone };
  },
});

// Exact recount, if the running total ever drifts. Run: npx convex run counters:recountPending
export const recountPending = internalAction({
  args: {},
  handler: async (ctx) => {
    let total = 0;
    let cursor: string | null = null;
    for (;;) {
      const res: { count: number; cursor: string; done: boolean } = await ctx.runQuery(
        internal.counters.countPendingPage,
        { cursor }
      );
      total += res.count;
      if (res.done) break;
      cursor = res.cursor;
    }
    await ctx.runMutation(internal.counters.setCounter, { key: "pendingSignals", value: total });
    return { pendingSignals: total };
  },
});
