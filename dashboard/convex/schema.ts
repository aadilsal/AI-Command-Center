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
    location: v.optional(v.string()),
    source: v.optional(v.string()),
    foundAt: v.optional(v.number()),
    reasons: v.optional(v.array(v.string())),
    missing: v.optional(v.array(v.string())),
    recommendation: v.optional(
      v.union(v.literal("Apply"), v.literal("Maybe"), v.literal("Skip"))
    ),
    description: v.optional(v.string()),
    dedupeKey: v.optional(v.string()),
    statusChangedAt: v.optional(v.number()),
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

  // ---------------------------------------------------------------- Opportunity Radar

  painSignals: defineTable({
    url: v.string(),
    source: v.string(),
    title: v.string(),
    text: v.string(),
    postedAt: v.optional(v.number()),
    engagement: v.optional(v.number()),
    fetchedAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("analyzed"), v.literal("noise")),
    problemId: v.optional(v.id("problems")),
    extraction: v.optional(
      v.object({
        pain: v.string(),
        persona: v.string(),
        industry: v.string(),
        workaround: v.string(),
        willingnessToPay: v.string(),
        intensity: v.number(),
        buildability: v.number(),
        quote: v.string(),
      })
    ),
  })
    .index("by_url", ["url"])
    .index("by_status", ["status"])
    .index("by_problem", ["problemId"]),

  problems: defineTable({
    title: v.string(),
    summary: v.string(),
    persona: v.string(),
    industries: v.array(v.string()),
    workarounds: v.array(v.string()),
    wtpEvidence: v.array(v.string()),
    evidence: v.array(v.object({ quote: v.string(), url: v.string(), source: v.string() })),
    signalCount: v.number(),
    sources: v.array(v.string()),
    avgIntensity: v.number(),
    avgBuildability: v.number(),
    wtpCount: v.number(),
    score: v.number(),
    status: v.union(
      v.literal("New"),
      v.literal("Exploring"),
      v.literal("Building"),
      v.literal("Launched"),
      v.literal("Parked")
    ),
    parkedReason: v.optional(v.string()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    statusChangedAt: v.optional(v.number()),
    solution: v.optional(
      v.object({
        name: v.string(),
        concept: v.string(),
        targetUser: v.string(),
        mvpFeatures: v.array(v.string()),
        stack: v.array(v.string()),
        buildEffort: v.string(),
        pricing: v.string(),
        differentiation: v.string(),
        channels: v.array(v.string()),
        contentAngles: v.array(v.string()),
        validationSteps: v.array(v.string()),
        risks: v.array(v.string()),
        generatedAt: v.number(),
      })
    ),
  })
    .index("by_score", ["score"])
    .index("by_status", ["status"]),

  // ---------------------------------------------------------------- Legacy (Lead Agent, retired)

  leads: defineTable({
    company: v.string(),
    industry: v.string(),
    problem: v.string(),
    solution: v.string(),
    priority: v.union(v.literal("High"), v.literal("Medium"), v.literal("Low")),
    url: v.optional(v.string()),
    source: v.optional(v.string()),
    author: v.optional(v.string()),
    summary: v.optional(v.string()),
    fitScore: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("New"),
        v.literal("Contacted"),
        v.literal("Replied"),
        v.literal("Won"),
        v.literal("Lost"),
        v.literal("Not a fit"),
        v.literal("Archived")
      )
    ),
    statusChangedAt: v.optional(v.number()),
    postedAt: v.optional(v.number()),
    foundAt: v.optional(v.number()),
    city: v.optional(v.string()),
    category: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    socialUrl: v.optional(v.string()),
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

  leadTargets: defineTable({
    city: v.string(),
    category: v.string(),
    enabled: v.boolean(),
    lastScannedAt: v.optional(v.number()),
    lastFound: v.optional(v.number()),
    bbox: v.optional(v.array(v.number())),
  }).index("by_city_category", ["city", "category"]),

  // ---------------------------------------------------------------- System

  briefings: defineTable({
    date: v.string(),
    createdAt: v.number(),
    headline: v.string(),
    actions: v.array(
      v.object({
        title: v.string(),
        why: v.string(),
        kind: v.union(
          v.literal("job"),
          v.literal("opportunity"),
          v.literal("followup"),
          v.literal("system"),
          v.literal("lead") // legacy
        ),
        url: v.optional(v.string()),
      })
    ),
    stats: v.object({
      newJobs: v.number(),
      applyJobs: v.number(),
      agentErrors: v.number(),
      // Opportunity Radar
      newProblems: v.optional(v.number()),
      readyToDesign: v.optional(v.number()),
      jobFollowUps: v.optional(v.number()),
      // Legacy (Lead Agent era)
      newLeads: v.optional(v.number()),
      highLeads: v.optional(v.number()),
      followUpsDue: v.optional(v.number()),
    }),
    generatedBy: v.union(v.literal("llm"), v.literal("rules")),
  }).index("by_date", ["date"]),

  agents: defineTable({
    name: v.string(),
    status: v.union(v.literal("running"), v.literal("idle"), v.literal("disabled")),
    startedAt: v.optional(v.number()),
    lastRun: v.optional(v.number()),
    lastError: v.optional(v.string()),
  }).index("by_name", ["name"]),
});
