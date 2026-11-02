import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const set = internalMutation({
  args: {
    name: v.string(),
    status: v.union(v.literal("running"), v.literal("idle"), v.literal("disabled")),
    lastRun: v.optional(v.number()),
    lastError: v.optional(v.union(v.string(), v.null())), // null = clear
  },
  handler: async (ctx, { name, status, lastRun, lastError }) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();

    if (!agent) {
      await ctx.db.insert("agents", {
        name,
        status,
        ...(lastRun !== undefined && { lastRun }),
        ...(typeof lastError === "string" && { lastError }),
      });
      return;
    }

    await ctx.db.patch(agent._id, {
      status,
      ...(lastRun !== undefined && { lastRun }),
      ...(lastError !== undefined && { lastError: lastError ?? undefined }),
    });
  },
});
