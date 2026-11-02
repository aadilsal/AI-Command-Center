import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  jobs: defineTable({
    title: v.string(),
    company: v.string(),
    url: v.string(),
    matchScore: v.number(), // 0-100
    status: v.union(
      v.literal("Saved"),
      v.literal("Applied"),
      v.literal("Interview"),
      v.literal("Rejected"),
      v.literal("Offer"),
      v.literal("Archived") // hidden, but still blocks repeats
    ),
    // Filled in by the Career Agent
    location: v.optional(v.string()),
    source: v.optional(v.string()),
    foundAt: v.optional(v.number()),
    reasons: v.optional(v.array(v.string())),
    missing: v.optional(v.array(v.string())),
    recommendation: v.optional(
      v.union(v.literal("Apply"), v.literal("Maybe"), v.literal("Skip"))
    ),
    description: v.optional(v.string()), // trimmed job description, used for application kits
    dedupeKey: v.optional(v.string()), // normalized title|company, catches cross-board repeats
    statusChangedAt: v.optional(v.number()),
    // Tailored application kit (generated on demand)
    kit: v.optional(
      v.object({
        resumeVariant: v.string(),
        summary: v.string(),
        highlights: v.array(v.string()),
        skills: v.array(v.string()),
        coverLetter: v.string(),
        emailSubject: v.string(),
        emailBody: v.string(),
        generatedAt: v.number(),
      })
    ),
  })
    .index("by_status", ["status"])
    .index("by_url", ["url"])
    .index("by_dedupeKey", ["dedupeKey"]),

  leads: defineTable({
    company: v.string(),
    industry: v.string(),
    problem: v.string(),
    solution: v.string(),
    priority: v.union(v.literal("High"), v.literal("Medium"), v.literal("Low")),
    // Filled in by the Lead Agent
    url: v.optional(v.string()),
    source: v.optional(v.string()),
    author: v.optional(v.string()),
    summary: v.optional(v.string()),
    fitScore: v.optional(v.number()), // 0-100
    status: v.optional(
      v.union(
        v.literal("New"),
        v.literal("Contacted"),
        v.literal("Replied"),
        v.literal("Won"),
        v.literal("Lost"),
        v.literal("Not a fit"),
        v.literal("Archived") // hidden, but still blocks repeats
      )
    ),
    statusChangedAt: v.optional(v.number()),
    postedAt: v.optional(v.number()),
    foundAt: v.optional(v.number()),
    // Business details (OpenStreetMap leads)
    city: v.optional(v.string()),
    category: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    socialUrl: v.optional(v.string()),
    // Outreach draft (generated on demand)
    draft: v.optional(
      v.object({
        whatsapp: v.string(),
        emailSubject: v.string(),
        emailBody: v.string(),
        generatedAt: v.number(),
      })
    ),
  })
    .index("by_company", ["company"])
    .index("by_url", ["url"]),

  // What the Lead Agent scans: one row per city + business type.
  // Edit rows in the Convex dashboard to change targets — no code changes.
  leadTargets: defineTable({
    city: v.string(), // geocoder query, e.g. "Lahore, Pakistan"
    category: v.string(), // key from CATEGORIES in convex/osm.ts
    enabled: v.boolean(),
    lastScannedAt: v.optional(v.number()),
    lastFound: v.optional(v.number()),
    bbox: v.optional(v.array(v.number())), // cached [south, west, north, east]
  }).index("by_city_category", ["city", "category"]),

  // One briefing per day, written by the Briefing Agent
  briefings: defineTable({
    date: v.string(), // YYYY-MM-DD in Pakistan time
    createdAt: v.number(),
    headline: v.string(),
    actions: v.array(
      v.object({
        title: v.string(),
        why: v.string(),
        kind: v.union(v.literal("job"), v.literal("lead"), v.literal("followup"), v.literal("system")),
        url: v.optional(v.string()),
      })
    ),
    stats: v.object({
      newJobs: v.number(),
      applyJobs: v.number(),
      newLeads: v.number(),
      highLeads: v.number(),
      followUpsDue: v.number(),
      agentErrors: v.number(),
    }),
    generatedBy: v.union(v.literal("llm"), v.literal("rules")),
  }).index("by_date", ["date"]),

  agents: defineTable({
    name: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("idle"),
      v.literal("disabled")
    ),
    startedAt: v.optional(v.number()), // when the current/last run began (watchdog uses this)
    lastRun: v.optional(v.number()),
    lastError: v.optional(v.string()),
  }).index("by_name", ["name"]),
});
