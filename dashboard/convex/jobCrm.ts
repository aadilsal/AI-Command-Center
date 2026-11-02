import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { jobKey } from "./keys";
import { stripApplyTraps } from "./jobSources";

const jobStatus = v.union(
  v.literal("Saved"),
  v.literal("Applied"),
  v.literal("Interview"),
  v.literal("Rejected"),
  v.literal("Offer")
);

// Dropdown: set any status
export const setStatus = mutation({
  args: { id: v.id("jobs"), status: jobStatus },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status, statusChangedAt: Date.now() });
  },
});

// "Apply ↗" button: mark Applied, but never downgrade Interview/Offer/etc.
export const markApplied = mutation({
  args: { id: v.id("jobs") },
  handler: async (ctx, { id }) => {
    const job = await ctx.db.get(id);
    if (!job || job.status !== "Saved") return;
    await ctx.db.patch(id, { status: "Applied", statusChangedAt: Date.now() });
  },
});

// One-time: add dedupe keys to jobs saved before keys existed
// Run: npx convex run jobCrm:backfillDedupeKeys
export const backfillDedupeKeys = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;
    for (const job of await ctx.db.query("jobs").collect()) {
      if (job.dedupeKey) continue;
      await ctx.db.patch(job._id, { dedupeKey: jobKey(job.title, job.company) });
      updated++;
    }
    return { updated };
  },
});

// One-time: strip anti-bot traps from stored descriptions and clear kits built before the fix
// Run: npx convex run jobCrm:sanitizeStored
export const sanitizeStored = internalMutation({
  args: {},
  handler: async (ctx) => {
    let cleaned = 0;
    let kitsCleared = 0;
    for (const job of await ctx.db.query("jobs").collect()) {
      const patch: Record<string, unknown> = {};
      if (job.description) {
        const safe = stripApplyTraps(job.description);
        if (safe !== job.description) {
          patch.description = safe;
          cleaned++;
        }
      }
      if (job.kit) {
        patch.kit = undefined;
        kitsCleared++;
      }
      if (Object.keys(patch).length) await ctx.db.patch(job._id, patch);
    }
    return { descriptionsCleaned: cleaned, kitsCleared };
  },
});

// Archive every not-yet-acted-on job from a source you no longer want
// Run: npx convex run jobCrm:archiveSource '{"source":"RemoteOK"}'
export const archiveSource = internalMutation({
  args: { source: v.string() },
  handler: async (ctx, { source }) => {
    let archived = 0;
    for (const job of await ctx.db.query("jobs").collect()) {
      if (job.source === source && job.status === "Saved") {
        await ctx.db.patch(job._id, { status: "Archived", statusChangedAt: Date.now() });
        archived++;
      }
    }
    return { archived };
  },
});
