import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const STUCK_AFTER_MS = 12 * 60 * 1000; // Convex kills runs at 10 min, so 12+ means it died

// Messages that describe something temporary that fixes itself next run → shown as a grey note.
// Everything else → shown as a red error that needs attention.
const TRANSIENT =
  /timed out|timeout|limit reached|rate limit|will retry|retry next run|interrupted|source issues|HTTP 5\d\d|HTTP 429|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i;

// "All sources failed" / "All N analyses failed" is a real problem even if the cause is transient.
const isError = (msg: string) => /^All /.test(msg) || !TRANSIENT.test(msg);

function messageFields(lastError: string | null | undefined) {
  if (lastError === undefined) return {}; // leave as is
  if (lastError === null) {
    return { lastError: undefined, lastNote: undefined, lastNoteAt: undefined }; // clean run
  }
  return isError(lastError)
    ? { lastError, lastNote: undefined, lastNoteAt: undefined }
    : { lastError: undefined, lastNote: lastError, lastNoteAt: Date.now() };
}

// Shared status updater for every agent
export const set = internalMutation({
  args: {
    name: v.string(),
    status: v.union(v.literal("running"), v.literal("idle"), v.literal("disabled")),
    lastRun: v.optional(v.number()),
    lastError: v.optional(v.union(v.string(), v.null())), // null = clean run (clears messages)
  },
  handler: async (ctx, { name, status, lastRun, lastError }) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();

    const fields = {
      status,
      ...(status === "running" && { startedAt: Date.now() }),
      ...(lastRun !== undefined && { lastRun }),
      ...messageFields(lastError),
    };

    if (!agent) await ctx.db.insert("agents", { name, ...fields });
    else await ctx.db.patch(agent._id, fields);
  },
});

// Atomically claim a run. Returns false if another copy of this agent is already running.
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

    if (!agent) await ctx.db.insert("agents", { name, status: "running", startedAt: now });
    else await ctx.db.patch(agent._id, { status: "running", startedAt: now });
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
        ...messageFields("Run was interrupted (computer asleep or timed out) — will retry next run"),
      });
      reset++;
    }
    return { reset };
  },
});

// One-time: re-sort messages already stored under the old rules.
// Run: npx convex run agentStatus:reclassify
export const reclassify = internalMutation({
  args: {},
  handler: async (ctx) => {
    let moved = 0;
    for (const agent of await ctx.db.query("agents").collect()) {
      if (agent.lastError && !isError(agent.lastError)) {
        await ctx.db.patch(agent._id, messageFields(agent.lastError));
        moved++;
      }
    }
    return { movedToNotes: moved };
  },
});
