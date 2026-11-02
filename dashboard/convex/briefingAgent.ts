import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { callLLMJson } from "./llm";

const AGENT_NAME = "Briefing Agent";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NEW_WINDOW_MS = 36 * HOUR; // "new" = found in the last 36h
const FOLLOW_UP_AFTER_MS = 3 * DAY; // Contacted with no reply for 3+ days
const MAX_ACTIONS = 5;

type Kind = "job" | "lead" | "followup" | "system";
type Action = { title: string; why: string; kind: Kind; url?: string };

// Today's date in Pakistan time (UTC+5)
const todayPKT = () => new Date(Date.now() + 5 * HOUR).toISOString().slice(0, 10);

// ---------- Public ----------

export const runNow = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.briefingAgent.run, {});
  },
});

// Latest briefing for the dashboard
export const latest = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("briefings").withIndex("by_date").order("desc").first();
  },
});

// ---------- Gather today's state (excludes anything you've already acted on) ----------

export const gather = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const jobs = (await ctx.db.query("jobs").collect()).filter((j) => j.source);
    const leads = (await ctx.db.query("leads").collect()).filter((l) => l.source);
    const agents = await ctx.db.query("agents").collect();

    const savedJobs = jobs.filter((j) => j.status === "Saved");
    const newJobs = savedJobs.filter((j) => (j.foundAt ?? 0) >= now - NEW_WINDOW_MS);
    const applyJobs = savedJobs
      .filter((j) => j.recommendation === "Apply")
      .sort((a, b) => b.matchScore - a.matchScore);

    const openLeads = leads.filter((l) => (l.status ?? "New") === "New");
    const newLeads = openLeads.filter((l) => (l.foundAt ?? 0) >= now - NEW_WINDOW_MS);
    const highLeads = openLeads
      .filter((l) => l.priority === "High")
      .sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0));

    const followUps = leads
      .filter(
        (l) =>
          l.status === "Contacted" &&
          l.statusChangedAt !== undefined &&
          l.statusChangedAt < now - FOLLOW_UP_AFTER_MS
      )
      .sort((a, b) => (a.statusChangedAt ?? 0) - (b.statusChangedAt ?? 0));

    const agentErrors = agents.filter((a) => a.lastError && a.name !== AGENT_NAME);

    return {
      stats: {
        newJobs: newJobs.length,
        applyJobs: applyJobs.length,
        newLeads: newLeads.length,
        highLeads: highLeads.length,
        followUpsDue: followUps.length,
        agentErrors: agentErrors.length,
      },
      topJobs: applyJobs.slice(0, 5).map((j) => ({
        title: j.title,
        company: j.company,
        score: j.matchScore,
        reasons: (j.reasons ?? []).slice(0, 2),
        url: j.url,
      })),
      topLeads: highLeads.slice(0, 5).map((l) => ({
        company: l.company,
        industry: l.industry,
        city: l.city ?? "",
        score: l.fitScore ?? 0,
        contact: [l.phone, l.email].filter(Boolean).join(" / "),
        url: l.url ?? "",
      })),
      followUps: followUps.slice(0, 5).map((l) => ({
        company: l.company,
        city: l.city ?? "",
        daysSinceContact: Math.floor((now - (l.statusChangedAt ?? now)) / DAY),
        contact: [l.phone, l.email].filter(Boolean).join(" / "),
        url: l.url ?? "",
      })),
      errors: agentErrors.map((a) => ({ agent: a.name, error: (a.lastError ?? "").slice(0, 150) })),
    };
  },
});

// ---------- The agent ----------

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.agentStatus.set, { name: AGENT_NAME, status: "running" });

    try {
      const state = await ctx.runQuery(internal.briefingAgent.gather, {});

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

      await ctx.runMutation(internal.agentStatus.set, {
        name: AGENT_NAME,
        status: "idle",
        lastRun: Date.now(),
        lastError: null,
      });

      return { date: todayPKT(), generatedBy, headline, actions: actions.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.agentStatus.set, {
        name: AGENT_NAME,
        status: "idle",
        lastRun: Date.now(),
        lastError: message,
      });
      throw err;
    }
  },
});

// ---------- Writers ----------

type State = Awaited<ReturnType<typeof gatherType>>;
declare function gatherType(): Promise<{
  stats: Record<string, number>;
  topJobs: { title: string; company: string; score: number; reasons: string[]; url: string }[];
  topLeads: { company: string; industry: string; city: string; score: number; contact: string; url: string }[];
  followUps: { company: string; city: string; daysSinceContact: number; contact: string; url: string }[];
  errors: { agent: string; error: string }[];
}>;

async function writeWithLLM(state: State): Promise<{ headline: string; actions: Action[] }> {
  const system = `You are the chief of staff for Aadil, a software engineer in Lahore who is (1) looking for a better remote engineering job and (2) growing his services company TechVersa.
Write his morning briefing from the data provided. Respond with ONLY a JSON object:
{"headline": string (one sentence, specific numbers), "actions": [{"title": string, "why": string, "kind": "job"|"lead"|"followup"|"system", "url": string}]}
Rules:
- At most ${MAX_ACTIONS} actions, ordered by importance. Fewer is fine if there is little to do.
- Priority order: overdue follow-ups (warm leads go cold) > strongest job applications > highest-fit new leads > fixing broken agents.
- Every action must refer to a specific item from the data; copy its url exactly. Never invent companies, jobs, or urls.
- title: an imperative, concrete action (e.g. "Apply to Senior Full Stack Engineer at Acme").
- why: one short sentence with the specific reason (score, days since contact, etc.).
- If there is nothing at all to act on, return a single "system" action suggesting to run the agents.`;

  const user = `DATA:\n${JSON.stringify(state, null, 1)}`;

  const { data } = await callLLMJson<{ headline?: string; actions?: Partial<Action>[] }>({
    system,
    user,
    maxTokens: 2500,
  });

  // Only keep actions that point at real items we gave it
  const validUrls = new Set(
    [...state.topJobs, ...state.topLeads, ...state.followUps].map((x) => x.url).filter(Boolean)
  );
  const kinds: Kind[] = ["job", "lead", "followup", "system"];

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

  for (const f of state.followUps.slice(0, 2)) {
    actions.push({
      kind: "followup",
      title: `Follow up with ${f.company}${f.city ? ` (${f.city})` : ""}`,
      why: `Contacted ${f.daysSinceContact} days ago with no reply.`,
      url: f.url,
    });
  }
  for (const j of state.topJobs.slice(0, 2)) {
    actions.push({
      kind: "job",
      title: `Apply to ${j.title} at ${j.company}`,
      why: `${j.score}% match.`,
      url: j.url,
    });
  }
  for (const l of state.topLeads.slice(0, 2)) {
    actions.push({
      kind: "lead",
      title: `Contact ${l.company}${l.city ? ` in ${l.city}` : ""}`,
      why: `${l.industry}, fit score ${l.score}.`,
      url: l.url,
    });
  }
  for (const e of state.errors.slice(0, 1)) {
    actions.push({ kind: "system", title: `Check the ${e.agent}`, why: e.error });
  }

  const s = state.stats;
  return {
    headline: `${s.applyJobs} jobs worth applying to, ${s.highLeads} high-priority leads, ${s.followUpsDue} follow-ups due.`,
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
