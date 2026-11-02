import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { callLLMJson } from "./llm";

const AGENT_NAME = "Briefing Agent";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NEW_WINDOW_MS = 36 * HOUR;
const JOB_FOLLOW_UP_AFTER_MS = 7 * DAY;
const MIN_EVIDENCE_TO_DESIGN = 2;
const MAX_ACTIONS = 5;

type Kind = "job" | "opportunity" | "followup" | "system";
type Action = { title: string; why: string; kind: Kind; url?: string };

const todayPKT = () => new Date(Date.now() + 5 * HOUR).toISOString().slice(0, 10);
const problemLink = (id: string) => `#problem-${id}`; // jumps to the problem on the dashboard

const setStatus = (
  ctx: { runMutation: (...a: any[]) => Promise<any> },
  args: { status: "running" | "idle"; lastRun?: number; lastError?: string | null }
) => ctx.runMutation(internal.agentStatus.set, { name: AGENT_NAME, ...args });

// ---------- Public ----------

export const runNow = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.briefingAgent.run, {});
  },
});

export const latest = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("briefings").withIndex("by_date").order("desc").first();
  },
});

// ---------- Gather today's state (only things you haven't acted on) ----------

export const gather = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const jobs = (await ctx.db.query("jobs").collect()).filter((j) => j.source);
    const problems = await ctx.db.query("problems").collect();
    const agents = await ctx.db.query("agents").collect();

    const savedJobs = jobs.filter((j) => j.status === "Saved");
    const newJobs = savedJobs.filter((j) => (j.foundAt ?? 0) >= now - NEW_WINDOW_MS);
    const applyJobs = savedJobs
      .filter((j) => j.recommendation === "Apply")
      .sort((a, b) => b.matchScore - a.matchScore);

    const jobFollowUps = jobs
      .filter(
        (j) =>
          j.status === "Applied" &&
          j.statusChangedAt !== undefined &&
          j.statusChangedAt < now - JOB_FOLLOW_UP_AFTER_MS
      )
      .sort((a, b) => (a.statusChangedAt ?? 0) - (b.statusChangedAt ?? 0));

    const active = problems.filter((p) => p.status !== "Parked");
    const newProblems = active.filter((p) => p.firstSeenAt >= now - NEW_WINDOW_MS);
    const readyToDesign = active
      .filter((p) => !p.solution && p.signalCount >= MIN_EVIDENCE_TO_DESIGN)
      .sort((a, b) => b.score - a.score);
    const designedToValidate = active
      .filter((p) => p.solution && p.status === "Exploring")
      .sort((a, b) => b.score - a.score);

    const agentErrors = agents.filter(
      (a) => a.lastError && a.name !== AGENT_NAME && a.status !== "disabled"
    );

    return {
      stats: {
        newJobs: newJobs.length,
        applyJobs: applyJobs.length,
        jobFollowUps: jobFollowUps.length,
        newProblems: newProblems.length,
        readyToDesign: readyToDesign.length,
        agentErrors: agentErrors.length,
      },
      topJobs: applyJobs.slice(0, 5).map((j) => ({
        title: j.title,
        company: j.company,
        score: j.matchScore,
        hasKit: !!j.kit,
        url: j.url,
      })),
      jobFollowUps: jobFollowUps.slice(0, 3).map((j) => ({
        title: j.title,
        company: j.company,
        daysSinceApplied: Math.floor((now - (j.statusChangedAt ?? now)) / DAY),
        url: j.url,
      })),
      readyToDesign: readyToDesign.slice(0, 3).map((p) => ({
        title: p.title,
        score: p.score,
        evidence: p.signalCount,
        sources: p.sources.join(", "),
        url: problemLink(p._id),
      })),
      toValidate: designedToValidate.slice(0, 2).map((p) => ({
        title: p.title,
        product: p.solution!.name,
        firstValidationStep: p.solution!.validationSteps[0] ?? "",
        url: problemLink(p._id),
      })),
      newProblemTitles: newProblems.slice(0, 5).map((p) => p.title),
      errors: agentErrors.map((a) => ({ agent: a.name, error: (a.lastError ?? "").slice(0, 150) })),
    };
  },
});

type State = {
  stats: {
    newJobs: number;
    applyJobs: number;
    jobFollowUps: number;
    newProblems: number;
    readyToDesign: number;
    agentErrors: number;
  };
  topJobs: { title: string; company: string; score: number; hasKit: boolean; url: string }[];
  jobFollowUps: { title: string; company: string; daysSinceApplied: number; url: string }[];
  readyToDesign: { title: string; score: number; evidence: number; sources: string; url: string }[];
  toValidate: { title: string; product: string; firstValidationStep: string; url: string }[];
  newProblemTitles: string[];
  errors: { agent: string; error: string }[];
};

// ---------- The agent ----------

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    await setStatus(ctx, { status: "running" });

    try {
      const state = (await ctx.runQuery(internal.briefingAgent.gather, {})) as State;

      let headline: string;
      let actions: Action[];
      let generatedBy: "llm" | "rules" = "llm";

      try {
        ({ headline, actions } = await writeWithLLM(state));
      } catch (err) {
        console.error("LLM briefing failed, using rules:", err instanceof Error ? err.message : err);
        ({ headline, actions } = writeWithRules(state));
        generatedBy = "rules";
      }

      await ctx.runMutation(internal.briefingAgent.save, {
        date: todayPKT(),
        headline,
        actions,
        stats: state.stats,
        generatedBy,
      });

      await setStatus(ctx, { status: "idle", lastRun: Date.now(), lastError: null });
      return { date: todayPKT(), generatedBy, headline, actions: actions.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setStatus(ctx, { status: "idle", lastRun: Date.now(), lastError: message });
      throw err;
    }
  },
});

// ---------- Writers ----------

async function writeWithLLM(state: State): Promise<{ headline: string; actions: Action[] }> {
  const system = `You are the chief of staff for Aadil, a software engineer in Lahore who is (1) looking for a better remote engineering job and (2) building products for his studio TechVersa based on real pain points his agents discover.
Write his morning briefing from the data. Respond with ONLY a JSON object:
{"headline": string (one sentence, specific numbers), "actions": [{"title": string, "why": string, "kind": "job"|"opportunity"|"followup"|"system", "url": string}]}
Rules:
- At most ${MAX_ACTIONS} actions, ordered by importance. Fewer is fine.
- Priority: strongest job applications > job follow-ups > best opportunity to design (readyToDesign) or validate (toValidate) > fixing broken agents.
- For a readyToDesign item, the action is to design a solution; for a toValidate item, the action is its first validation step.
- Every action must refer to a specific item from the data; copy its url exactly. Never invent anything.
- title: imperative and concrete. why: one short sentence with the specific reason (score, days, evidence count).
- If there is nothing to act on, return one "system" action suggesting to run the agents.`;

  const { data } = await callLLMJson<{ headline?: string; actions?: Partial<Action>[] }>({
    system,
    user: `DATA:\n${JSON.stringify(state, null, 1)}`,
    maxTokens: 2500,
  });

  const validUrls = new Set(
    [...state.topJobs, ...state.jobFollowUps, ...state.readyToDesign, ...state.toValidate]
      .map((x) => x.url)
      .filter(Boolean)
  );
  const kinds: Kind[] = ["job", "opportunity", "followup", "system"];

  const actions: Action[] = (data.actions ?? [])
    .filter((a) => a && a.title && a.why && kinds.includes(a.kind as Kind))
    .filter((a) => a.kind === "system" || (a.url && validUrls.has(a.url)))
    .slice(0, MAX_ACTIONS)
    .map((a) => ({
      title: String(a.title).slice(0, 160),
      why: String(a.why).slice(0, 240),
      kind: a.kind as Kind,
      ...(a.url ? { url: String(a.url) } : {}),
    }));

  if (!data.headline || actions.length === 0) throw new Error("LLM returned no usable actions");
  return { headline: String(data.headline).slice(0, 240), actions };
}

function writeWithRules(state: State): { headline: string; actions: Action[] } {
  const actions: Action[] = [];

  for (const j of state.topJobs.slice(0, 2)) {
    actions.push({ kind: "job", title: `Apply to ${j.title} at ${j.company}`, why: `${j.score}% match.`, url: j.url });
  }
  for (const f of state.jobFollowUps.slice(0, 1)) {
    actions.push({
      kind: "followup",
      title: `Follow up on ${f.title} at ${f.company}`,
      why: `Applied ${f.daysSinceApplied} days ago with no movement.`,
      url: f.url,
    });
  }
  for (const p of state.readyToDesign.slice(0, 1)) {
    actions.push({
      kind: "opportunity",
      title: `Design a solution for: ${p.title}`,
      why: `Score ${p.score}, ${p.evidence} pieces of evidence (${p.sources}).`,
      url: p.url,
    });
  }
  for (const p of state.toValidate.slice(0, 1)) {
    actions.push({
      kind: "opportunity",
      title: `Validate ${p.product}: ${p.firstValidationStep}`.slice(0, 160),
      why: `Designed for "${p.title}" — test demand before building.`,
      url: p.url,
    });
  }
  for (const e of state.errors.slice(0, 1)) {
    actions.push({ kind: "system", title: `Check the ${e.agent}`, why: e.error });
  }

  const s = state.stats;
  return {
    headline: `${s.applyJobs} jobs worth applying to, ${s.readyToDesign} opportunities ready to design, ${s.newProblems} new problems found.`,
    actions: actions.slice(0, MAX_ACTIONS),
  };
}

// ---------- Save (one briefing per day; regenerating replaces it) ----------

export const save = internalMutation({
  args: {
    date: v.string(),
    headline: v.string(),
    actions: v.array(
      v.object({
        title: v.string(),
        why: v.string(),
        kind: v.union(v.literal("job"), v.literal("opportunity"), v.literal("followup"), v.literal("system")),
        url: v.optional(v.string()),
      })
    ),
    stats: v.object({
      newJobs: v.number(),
      applyJobs: v.number(),
      jobFollowUps: v.number(),
      newProblems: v.number(),
      readyToDesign: v.number(),
      agentErrors: v.number(),
    }),
    generatedBy: v.union(v.literal("llm"), v.literal("rules")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("briefings")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .first();
    if (existing) {
      await ctx.db.replace(existing._id, { ...args, createdAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("briefings", { ...args, createdAt: Date.now() });
  },
});
