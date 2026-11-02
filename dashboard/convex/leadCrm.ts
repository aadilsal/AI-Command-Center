import { v } from "convex/values";
import { mutation } from "./_generated/server";

const leadStatus = v.union(
  v.literal("New"),
  v.literal("Contacted"),
  v.literal("Replied"),
  v.literal("Won"),
  v.literal("Lost"),
  v.literal("Not a fit")
);

// Dropdown: set any status
export const setStatus = mutation({
  args: { id: v.id("leads"), status: leadStatus },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status, statusChangedAt: Date.now() });
  },
});

// Tapping phone/email: mark Contacted, but only if still New
export const markContacted = mutation({
  args: { id: v.id("leads") },
  handler: async (ctx, { id }) => {
    const lead = await ctx.db.get(id);
    if (!lead || (lead.status ?? "New") !== "New") return;
    await ctx.db.patch(id, { status: "Contacted", statusChangedAt: Date.now() });
  },
});
