import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { fetchAllSignals } from "./painSources";
import { callLLMJson, LLM_PACING_MS, sleep } from "./llm";
import { PAIN_ANALYST_SYSTEM } from "./prompts";

const AGENT_NAME = "Pain Agent";
const MAX_ANALYZE_PER_RUN = 20;
const RUN_BUDGET_MS = 8 * 60 * 1000;
const CATALOG_SIZE = 60;
const POST_CHARS = 1500;
const EVIDENCE_KEEP = 6;
const DAY = 24 * 60 * 60 * 1000;

type Extraction = {
  isPain: boolean;
  pain: string;
  persona: string;
  industry: string;
  workaround: string;
  willingnessToPay: string;
  intensity: number;
  buildability: number;
  quote: string;
  matchProblemId: string | null;
  newProblemTitle: string;
  newProblemSummary: string;
};

const setStatus = (
  ctx: { runMutation: (...a: any[]) => Promise<any> },
  args: { status: "running" | "idle"; lastRun?: number; lastError?: string | null }
) => ctx.runMutation(internal.agentStatus.set, { name: AGENT_NAME, ...args });

const clamp15 = (n: unknown) => Math.max(1, Math.min(5, Math.round(Number(n) || 1)));
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Opportunity score (0-100). Quality factors scaled by confidence: one mention ≈ half credit.
function scoreProblem(p: {
  signalCount: number;
  sources: string[];
  avgIntensity: number;
  avgBuildability: number;
  wtpCount: number;
  lastSeenAt: number;
}): number {
  const confidence = Math.min(1, 0.4 + 0.15 * p.signalCount);
  const frequency = (Math.min(p.signalCount, 10) / 10) * 35;
  const intensity = (p.avgIntensity / 5) * 20 * confidence;
  const wtp = (Math.min(p.wtpCount, 3) / 3) * 15;
  const buildability = (p.avgBuildability / 5) * 15 * confidence;
  const spread = (Math.min(p.sources.length, 3) / 3) * 10;
  const recency = Date.now() - p.lastSeenAt < 14 * DAY ? 5 : 0;
  return Math.round(frequency + intensity + wtp + buildability + spread + recency);
}

export const runNow = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.painAgent.run, {});
  },
});

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const startedAt = Date.now();

    // Never run two copies at once (scheduled + manual would share the rate limit)
    const claimed = await ctx.runMutation(internal.agentStatus.tryStart, { name: AGENT_NAME });
    if (!claimed) return { skipped: "Another Pain Agent run is already in progress" };

    try {
      // 1. Collect raw signals (no LLM)
      const results = await fetchAllSignals();
      const sourceErrors = results.filter((r) => r.error).map((r) => `${r.source}: ${r.error}`);
      const all = results.flatMap((r) => r.signals);

      const collected = all.length
        ? await ctx.runMutation(internal.painAgent.insertSignals, {
            signals: all.map((s) => ({
              url: s.url,
              source: s.source,
              title: s.title.slice(0, 300),
              text: s.text,
              postedAt: s.postedAt,
              engagement: s.engagement,
            })),
          })
        : 0;

      // 2. Analyze pending signals, taking turns across sources
      const pending = await ctx.runQuery(internal.painAgent.nextPending, { limit: MAX_ANALYZE_PER_RUN });

      let realPains = 0;
      let noise = 0;
      let newProblems = 0;
      let failed = 0;
      let stoppedEarly = false;
      let lastFailure: string | null = null;

      for (let i = 0; i < pending.length; i++) {
        if (Date.now() - startedAt > RUN_BUDGET_MS) {
          stoppedEarly = true;
          break;
        }
        if (i > 0) await sleep(LLM_PACING_MS);

        const signal = pending[i];
        try {
          const catalog = await ctx.runQuery(internal.painAgent.problemCatalog, { limit: CATALOG_SIZE });
          const x = await analyzeSignal(signal, catalog);

          if (!x.isPain) {
            await ctx.runMutation(internal.painAgent.markNoise, { id: signal._id });
            noise++;
            continue;
          }

          const quote = verifiedQuote(x.quote, `${signal.title}\n${signal.text}`);
          const validMatch = catalog.find((p) => p._id === x.matchProblemId);

          const created = await ctx.runMutation(internal.painAgent.applyAnalysis, {
            signalId: signal._id,
            problemId: validMatch ? (validMatch._id as Id<"problems">) : undefined,
            newTitle: String(x.newProblemTitle || x.pain).slice(0, 140),
            newSummary: String(x.newProblemSummary || x.pain).slice(0, 400),
            extraction: {
              pain: String(x.pain).slice(0, 300),
              persona: String(x.persona || "Unknown").slice(0, 120),
              industry: String(x.industry || "General").slice(0, 60),
              workaround: String(x.workaround || "Unknown").slice(0, 300),
              willingnessToPay: String(x.willingnessToPay || "none").slice(0, 300),
              intensity: clamp15(x.intensity),
              buildability: clamp15(x.buildability),
              quote,
            },
          });
          realPains++;
          if (created) newProblems++;
        } catch (err) {
          failed++;
          lastFailure = err instanceof Error ? err.message : String(err);
          console.error(`Failed to analyze ${signal.url}:`, lastFailure.slice(0, 300));
        }
      }

      // 3. Report
      let lastError: string | null = null;
      if (pending.length > 0 && realPains + noise === 0 && !stoppedEarly) {
        lastError = `All ${pending.length} analyses failed: ${lastFailure?.slice(0, 200)}`;
      } else if (sourceErrors.length) {
        lastError = `Source issues — ${sourceErrors.join("; ")}`;
      } else if (failed > 0) {
        lastError = `${failed} signal(s) failed to analyze; will retry next run`;
      }

      await setStatus(ctx, { status: "idle", lastRun: Date.now(), lastError });

      const stillPending = await ctx.runQuery(internal.painAgent.pendingCount, {});
      return {
        sources: results.map((r) => ({
          source: r.source,
          fetched: r.signals.length,
          ...(r.error && { error: r.error }),
        })),
        newSignalsCollected: collected,
        analyzed: realPains + noise,
        realPains,
        noise,
        newProblems,
        failed,
        stillPending,
        ...(stoppedEarly && { stoppedEarly: true }),
        seconds: Math.round((Date.now() - startedAt) / 1000),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setStatus(ctx, { status: "idle", lastRun: Date.now(), lastError: message });
      throw err;
    }
  },
});

async function analyzeSignal(
  signal: Doc<"painSignals">,
  catalog: { _id: string; title: string; persona: string }[]
): Promise<Extraction> {
  const catalogText = catalog.length
    ? catalog.map((p) => `${p._id} | ${p.title} | ${p.persona}`).join("\n")
    : "(none yet)";

  const user = `EXISTING PROBLEMS (id | title | persona):
${catalogText}

POST (source: ${signal.source}):
Title: ${signal.title}
${signal.text.slice(0, POST_CHARS)}`;

  const { data } = await callLLMJson<Partial<Extraction>>({
    system: PAIN_ANALYST_SYSTEM,
    user,
    maxTokens: 1500,
  });

  return {
    isPain: data.isPain === true,
    pain: String(data.pain ?? ""),
    persona: String(data.persona ?? ""),
    industry: String(data.industry ?? ""),
    workaround: String(data.workaround ?? ""),
    willingnessToPay: String(data.willingnessToPay ?? "none"),
    intensity: Number(data.intensity ?? 1),
    buildability: Number(data.buildability ?? 1),
    quote: String(data.quote ?? ""),
    matchProblemId: data.matchProblemId ? String(data.matchProblemId) : null,
    newProblemTitle: String(data.newProblemTitle ?? ""),
    newProblemSummary: String(data.newProblemSummary ?? ""),
  };
}

function verifiedQuote(quote: string, source: string): string {
  const q = quote.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (q.length >= 15 && norm(source).includes(norm(q))) return q.slice(0, 300);
  const words = source.replace(/\s+/g, " ").trim().split(" ").slice(0, 30).join(" ");
  return words.slice(0, 300);
}

// ---------- Internal DB helpers ----------

export const insertSignals = internalMutation({
  args: {
    signals: v.array(
      v.object({
        url: v.string(),
        source: v.string(),
        title: v.string(),
        text: v.string(),
        postedAt: v.optional(v.number()),
        engagement: v.number(),
      })
    ),
  },
  handler: async (ctx, { signals }) => {
    let inserted = 0;
    for (const s of signals) {
      const exists = await ctx.db
        .query("painSignals")
        .withIndex("by_url", (q) => q.eq("url", s.url))
        .first();
      if (exists) continue;
      await ctx.db.insert("painSignals", { ...s, fetchedAt: Date.now(), status: "pending" });
      inserted++;
    }
    return inserted;
  },
});

// Round-robin across sources (and each App Store app), best engagement first within each
export const nextPending = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const pending = await ctx.db
      .query("painSignals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    const buckets = new Map<string, Doc<"painSignals">[]>();
    for (const s of pending) {
      const list = buckets.get(s.source) ?? [];
      list.push(s);
      buckets.set(s.source, list);
    }
    for (const list of buckets.values()) list.sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0));

    const out: Doc<"painSignals">[] = [];
    const queues = [...buckets.values()];
    while (out.length < limit && queues.some((q) => q.length)) {
      for (const q of queues) {
        const next = q.shift();
        if (next) out.push(next);
        if (out.length >= limit) break;
      }
    }
    return out;
  },
});

export const pendingCount = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db
      .query("painSignals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect()).length,
});

export const problemCatalog = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const problems = (await ctx.db.query("problems").collect()).filter((p) => p.status !== "Parked");
    problems.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    return problems.slice(0, limit).map((p) => ({ _id: p._id as string, title: p.title, persona: p.persona }));
  },
});

export const markNoise = internalMutation({
  args: { id: v.id("painSignals") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: "noise" });
  },
});

const extractionValidator = v.object({
  pain: v.string(),
  persona: v.string(),
  industry: v.string(),
  workaround: v.string(),
  willingnessToPay: v.string(),
  intensity: v.number(),
  buildability: v.number(),
  quote: v.string(),
});

export const applyAnalysis = internalMutation({
  args: {
    signalId: v.id("painSignals"),
    problemId: v.optional(v.id("problems")),
    newTitle: v.string(),
    newSummary: v.string(),
    extraction: extractionValidator,
  },
  handler: async (ctx, { signalId, problemId, newTitle, newSummary, extraction }) => {
    const signal = await ctx.db.get(signalId);
    if (!signal) return false;

    let pid = problemId;
    let created = false;
    if (!pid || !(await ctx.db.get(pid))) {
      const now = Date.now();
      pid = await ctx.db.insert("problems", {
        title: newTitle,
        summary: newSummary,
        persona: extraction.persona,
        industries: [],
        workarounds: [],
        wtpEvidence: [],
        evidence: [],
        signalCount: 0,
        sources: [],
        avgIntensity: 1,
        avgBuildability: 1,
        wtpCount: 0,
        score: 0,
        status: "New",
        firstSeenAt: now,
        lastSeenAt: now,
      });
      created = true;
    }

    await ctx.db.patch(signalId, { status: "analyzed", problemId: pid, extraction });

    const linked = await ctx.db
      .query("painSignals")
      .withIndex("by_problem", (q) => q.eq("problemId", pid))
      .collect();
    const ex = linked.filter((s) => s.extraction);
    const uniq = (xs: string[], max: number) =>
      [...new Set(xs.map((x) => x.trim()).filter((x) => x && !/^(unknown|none|general)$/i.test(x)))].slice(0, max);

    const wtp = ex.filter((s) => !/^none$/i.test(s.extraction!.willingnessToPay.trim()));
    const newest = [...ex].sort((a, b) => (b.postedAt ?? b.fetchedAt) - (a.postedAt ?? a.fetchedAt));

    const stats = {
      signalCount: ex.length,
      sources: uniq(ex.map((s) => s.source.split(":")[0]), 10),
      industries: uniq(ex.map((s) => s.extraction!.industry), 6),
      workarounds: uniq(ex.map((s) => s.extraction!.workaround), 6),
      wtpEvidence: uniq(wtp.map((s) => s.extraction!.willingnessToPay), 6),
      wtpCount: wtp.length,
      avgIntensity: ex.reduce((a, s) => a + s.extraction!.intensity, 0) / Math.max(1, ex.length),
      avgBuildability: ex.reduce((a, s) => a + s.extraction!.buildability, 0) / Math.max(1, ex.length),
      evidence: newest.slice(0, EVIDENCE_KEEP).map((s) => ({
        quote: s.extraction!.quote,
        url: s.url,
        source: s.source,
      })),
      lastSeenAt: Math.max(...ex.map((s) => s.postedAt ?? s.fetchedAt)),
    };

    await ctx.db.patch(pid, { ...stats, score: scoreProblem(stats) });
    return created;
  },
});

// One-time reset after changing the analysis rules
// Run: npx convex run painAgent:resetRadar
export const resetRadar = internalMutation({
  args: {},
  handler: async (ctx) => {
    let problemsDeleted = 0;
    for (const p of await ctx.db.query("problems").collect()) {
      await ctx.db.delete(p._id);
      problemsDeleted++;
    }
    let signalsReset = 0;
    for (const s of await ctx.db.query("painSignals").collect()) {
      if (s.status === "pending") continue;
      await ctx.db.patch(s._id, { status: "pending", problemId: undefined, extraction: undefined });
      signalsReset++;
    }
    return { problemsDeleted, signalsReset };
  },
});
