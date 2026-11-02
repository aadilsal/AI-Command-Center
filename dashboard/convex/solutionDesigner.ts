import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { callLLMJson } from "./llm";
import { SOLUTION_DESIGNER_SYSTEM } from "./prompts";

const MAX_ATTEMPTS = 3;
const MAX_EVIDENCE_SIGNALS = 12;
export const MIN_EVIDENCE_TO_DESIGN = 2; // below this: "needs more evidence" (unless forced)

type Solution = {
  name: string;
  concept: string;
  targetUser: string;
  mvpFeatures: string[];
  stack: string[];
  buildEffort: string;
  pricing: string;
  differentiation: string;
  channels: string[];
  contentAngles: string[];
  validationSteps: string[];
  risks: string[];
};

type Design = Partial<Solution> & { viable?: boolean; viabilityReason?: string };

const clean = (s: unknown) =>
  String(s ?? "")
    .replace(/\\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const list = (x: unknown, max: number) =>
  (Array.isArray(x) ? x : [])
    .map(clean)
    .filter(Boolean)
    .slice(0, max);

function findViolations(s: Solution): string[] {
  const out: string[] = [];
  const nonPricing = [
    s.concept,
    s.targetUser,
    s.differentiation,
    ...s.mvpFeatures,
    ...s.channels,
    ...s.contentAngles,
    ...s.validationSteps,
    ...s.risks,
  ].join("\n");

  if (/\b\d+(\.\d+)?\s?(%|percent)\b|\$?\d+(\.\d+)?\s?(billion|million|bn|mn)\b/i.test(nonPricing)) {
    out.push("contains market statistics or percentages that are not from the evidence — remove all invented numbers");
  }
  if (/\b(refunds? on (their|your) behalf|dispute|log ?in to (their|your) accounts?|scrape (their|your) account)\b/i.test(nonPricing)) {
    out.push("the product depends on acting against or inside another vendor's accounts — not viable; redesign or mark viable=false");
  }
  if (s.mvpFeatures.length < 4) out.push("MVP needs 4-8 concrete features");
  if (s.validationSteps.length < 2) out.push("give at least 2 concrete validation steps");
  if (s.channels.length < 2) out.push("give at least 2 specific channels where these users are");
  if (!s.name || s.name.split(/\s+/).length > 5) out.push("name must be 1-4 words");
  return out;
}

// ---------- Internal helpers ----------

export const getProblemWithEvidence = internalQuery({
  args: { id: v.optional(v.id("problems")), minEvidence: v.number() },
  handler: async (ctx, { id, minEvidence }) => {
    let problem: Doc<"problems"> | null = null;
    if (id) {
      problem = await ctx.db.get(id);
    } else {
      // No id: highest-scoring designable problem (handy for testing)
      const all = (await ctx.db.query("problems").collect()).filter(
        (p) => !p.solution && p.status !== "Parked" && p.signalCount >= minEvidence
      );
      all.sort((a, b) => b.score - a.score);
      problem = all[0] ?? null;
    }
    if (!problem) return null;

    const signals = await ctx.db
      .query("painSignals")
      .withIndex("by_problem", (q) => q.eq("problemId", problem!._id))
      .collect();

    return {
      problem,
      evidence: signals
        .filter((s) => s.extraction)
        .slice(0, MAX_EVIDENCE_SIGNALS)
        .map((s) => ({ source: s.source, ...s.extraction! })),
    };
  },
});

export const saveSolution = internalMutation({
  args: {
    id: v.id("problems"),
    solution: v.object({
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
    }),
  },
  handler: async (ctx, { id, solution }) => {
    const problem = await ctx.db.get(id);
    if (!problem) return;
    await ctx.db.patch(id, {
      solution: { ...solution, generatedAt: Date.now() },
      parkedReason: undefined,
      ...(problem.status === "New" && { status: "Exploring" as const, statusChangedAt: Date.now() }),
    });
  },
});

export const parkProblem = internalMutation({
  args: { id: v.id("problems"), reason: v.string() },
  handler: async (ctx, { id, reason }) => {
    await ctx.db.patch(id, {
      status: "Parked",
      parkedReason: reason,
      solution: undefined,
      statusChangedAt: Date.now(),
    });
  },
});

// Dashboard status dropdown
export const setStatus = mutation({
  args: {
    id: v.id("problems"),
    status: v.union(
      v.literal("New"),
      v.literal("Exploring"),
      v.literal("Building"),
      v.literal("Launched"),
      v.literal("Parked")
    ),
  },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, {
      status,
      statusChangedAt: Date.now(),
      ...(status !== "Parked" && { parkedReason: undefined }),
    });
  },
});

// Reopen every parked problem (e.g. after changing the viability rules)
// Run: npx convex run solutionDesigner:reopenParked
export const reopenParked = internalMutation({
  args: {},
  handler: async (ctx) => {
    let reopened = 0;
    for (const p of await ctx.db.query("problems").collect()) {
      if (p.status !== "Parked") continue;
      await ctx.db.patch(p._id, { status: "New", parkedReason: undefined, statusChangedAt: Date.now() });
      reopened++;
    }
    return { reopened };
  },
});

// ---------- Public: dashboard "Design solution" button ----------

export const designSolution = action({
  args: { id: v.optional(v.id("problems")), force: v.optional(v.boolean()) },
  handler: async (ctx, { id, force }) => {
    const minEvidence = force ? 1 : MIN_EVIDENCE_TO_DESIGN;
    const data = await ctx.runQuery(internal.solutionDesigner.getProblemWithEvidence, { id, minEvidence });
    if (!data) {
      throw new Error(
        `No problem ready to design — problems need at least ${MIN_EVIDENCE_TO_DESIGN} pieces of evidence (the Pain Agent is still collecting). Use "force" to design anyway.`
      );
    }
    const { problem, evidence } = data;

    if (!force && problem.signalCount < MIN_EVIDENCE_TO_DESIGN) {
      return {
        problem: problem.title,
        needsMoreEvidence: true,
        signalCount: problem.signalCount,
        message: `Only ${problem.signalCount} piece(s) of evidence so far — wait for more, or design anyway with force.`,
      };
    }

    const user = `PROBLEM: ${problem.title}
SUMMARY: ${problem.summary}
PERSONA: ${problem.persona}
INDUSTRIES: ${problem.industries.join(", ") || "various"}
CURRENT WORKAROUNDS: ${problem.workarounds.join("; ") || "unknown"}
WILLINGNESS-TO-PAY EVIDENCE: ${problem.wtpEvidence.join("; ") || "none found yet"}
SEEN ${problem.signalCount} TIME(S) IN: ${problem.sources.join(", ")}

EVIDENCE (each is one real post):
${evidence
  .map(
    (e, i) =>
      `${i + 1}. [${e.source}] ${e.pain}
   Persona: ${e.persona} | Workaround: ${e.workaround} | Would pay: ${e.willingnessToPay}
   Quote: "${e.quote}"`
  )
  .join("\n")}`;

    let solution: Solution | null = null;
    let violations: string[] = [];
    let attempts = 0;

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      const feedback = violations.length
        ? `\n\nYOUR PREVIOUS ANSWER BROKE THESE RULES — fix all of them:\n- ${violations.join("\n- ")}`
        : "";

      const { data: raw } = await callLLMJson<Design>({
        system: SOLUTION_DESIGNER_SYSTEM,
        user: user + feedback,
        temperature: 0.4,
        maxTokens: 4000,
      });

      // Viability gate: park it instead of inventing a product
      if (raw.viable === false) {
        const reason = clean(raw.viabilityReason).slice(0, 300) || "Not a buildable product opportunity";
        await ctx.runMutation(internal.solutionDesigner.parkProblem, { id: problem._id, reason });
        return { problem: problem.title, viable: false, parkedReason: reason, attempts };
      }

      solution = {
        name: clean(raw.name).slice(0, 60),
        concept: clean(raw.concept).slice(0, 800),
        targetUser: clean(raw.targetUser).slice(0, 300),
        mvpFeatures: list(raw.mvpFeatures, 8),
        stack: list(raw.stack, 10),
        buildEffort: clean(raw.buildEffort).slice(0, 200),
        pricing: clean(raw.pricing).slice(0, 600),
        differentiation: clean(raw.differentiation).slice(0, 600),
        channels: list(raw.channels, 6),
        contentAngles: list(raw.contentAngles, 5),
        validationSteps: list(raw.validationSteps, 5),
        risks: list(raw.risks, 4),
      };

      violations = findViolations(solution);
      if (violations.length === 0) break;
    }

    if (!solution || !solution.concept) throw new Error("Could not design a solution — try again");

    await ctx.runMutation(internal.solutionDesigner.saveSolution, { id: problem._id, solution });

    return {
      problem: problem.title,
      score: problem.score,
      viable: true,
      evidenceCount: problem.signalCount,
      attempts,
      warnings: violations,
      ...solution,
    };
  },
});
