import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getJobs = query({
  handler: async (ctx) => {
    return await ctx.db.query("jobs").collect();
  },
});


export const addJob = mutation({
  args: {
    title: v.string(),
    company: v.string(),
    url: v.string(),
    matchScore: v.number(),
    status: v.string(),
  },

  handler: async (ctx, args) => {
    await ctx.db.insert("jobs", args);
  },
});
