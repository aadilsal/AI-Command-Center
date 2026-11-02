import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const STUCK_AFTER_MS = 12 * 60 * 1000; // Convex kills runs at 10 min, so 12+ means it died

// Shared status updater for every agent
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

    const startedAt = status === "running" ? { startedAt: Date.now() } : {};

    if (!agent) {
      await ctx.db.insert("agents", {
        name,
        status,
        ...startedAt,
        ...(lastRun !== undefined && { lastRun }),
        ...(typeof lastError === "string" && { lastError }),
      });
      return;
    }

    await ctx.db.patch(agent._id, {
      status,
      ...startedAt,
      ...(lastRun !== undefined && { lastRun }),
      ...(lastError !== undefined && { lastError: lastError ?? undefined }),
    });
  },
});

// Atomically claim a run. Returns false if another copy of this agent is already running
// (prevents a scheduled run and a manual run from overlapping).
export const tryStart = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const now = Date.now();
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();

    if (agent?.status === "running" && agent.startedAt && now - agent.startedAt < STUCK_AFTER_MS) {
      return false;
    }

    if (!agent) {
      await ctx.db.insert("agents", { name, status: "running", startedAt: now });
    } else {
      await ctx.db.patch(agent._id, { status: "running", startedAt: now });
    }
    return true;
  },
});

// Watchdog (runs every 30 min): un-stick agents whose run died mid-way
export const resetStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let reset = 0;
    for (const agent of await ctx.db.query("agents").collect()) {
      if (agent.status !== "running") continue;
      if (agent.startedAt && now - agent.startedAt < STUCK_AFTER_MS) continue;
      await ctx.db.patch(agent._id, {
        status: "idle",
        lastError: "Run was interrupted (computer asleep or run timed out) — will run again on schedule",
      });
      reset++;
    }
    return { reset };
  },
});
