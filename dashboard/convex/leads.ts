import { mutation, query } from "./_generated/server";
import { v } from "convex/values";


export const getLeads = query({
  handler: async (ctx) => {
    return await ctx.db.query("leads").collect();
  },
});


export const addLead = mutation({
  args: {
    company: v.string(),
    industry: v.string(),
    problem: v.string(),
    solution: v.string(),
    priority: v.string(),
  },

  handler: async (ctx, args) => {
    await ctx.db.insert("leads", args);
  },
});
