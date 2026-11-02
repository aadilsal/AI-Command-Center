import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { PROFILE } from "./profile";
import { fetchAllJobs, type NormalizedJob } from "./jobSources";
import { callLLMJson, LLM_PACING_MS, sleep } from "./llm";
import { jobKey } from "./keys";

const AGENT_NAME = "Career Agent";
const MAX_JOBS_PER_RUN = 25;
const DESCRIPTION_CHARS = 3000;

const TITLE_KEYWORDS = [
  "full stack",
  "full-stack",
  "fullstack",
  "backend",
  "back-end",
  "back end",
  "react",
  "next.js",
  "nextjs",
  "node",
  "typescript",
  "javascript",
  "ai engineer",
  "software engineer",
  "software developer",
  "web developer",
];

type Analysis = {
  matchScore: number;
  reasons: string[];
  missing: string[];
  recommendation: "Apply" | "Maybe" | "Skip";
};

// ---------- Public trigger (dashboard "Run now" button) ----------

export const runNow = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.careerAgent.run, {});
  },
});

// ---------- The agent ----------

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.careerAgent.setAgentStatus, {
      status: "running",
    });

    try {
      // 1. Fetch every board in parallel
      const results = await fetchAllJobs();
      const sourceErrors = results
        .filter((r) => r.error)
        .map((r) => `${r.source}: ${r.error}`);

      if (results.every((r) => r.error)) {
        throw new Error(`All job sources failed — ${sourceErrors.join("; ")}`);
      }

      // 2. De-duplicate within this run (same URL, or same title + company)
      const seenUrls = new Set<string>();
      const seenKeys = new Set<string>();
      const unique: NormalizedJob[] = [];
      for (const job of results.flatMap((r) => r.jobs)) {
        const key = jobKey(job.title, job.company);
        if (seenUrls.has(job.url) || seenKeys.has(key)) continue;
        seenUrls.add(job.url);
        seenKeys.add(key);
        unique.push(job);
      }

      // 3. Keep relevant titles, newest first
      const relevant = unique
        .filter((j) =>
          TITLE_KEYWORDS.some((k) => j.title.toLowerCase().includes(k))
        )
        .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0));

      // 4. Skip anything already saved — by URL or by title + company (any status)
      const newUrls = await ctx.runQuery(internal.careerAgent.filterNew, {
        items: relevant.map((j) => ({ url: j.url, key: jobKey(j.title, j.company) })),
      });
      const newSet = new Set(newUrls);
      const fresh = relevant.filter((j) => newSet.has(j.url));
      const toScore = fresh.slice(0, MAX_JOBS_PER_RUN);

      // 5. Backfill descriptions on jobs we already have (no LLM, no tokens)
      const repeats = relevant.filter((j) => !newSet.has(j.url) && j.description);
      const backfilled = repeats.length
        ? await ctx.runMutation(internal.careerAgent.backfillDescriptions, {
            items: repeats.map((j) => ({
              url: j.url,
              description: j.description.slice(0, DESCRIPTION_CHARS),
            })),
          })
        : 0;

      // 6. Score and save
      let saved = 0;
      let retries = 0;
      let lastFailure: string | null = null;

      for (let i = 0; i < toScore.length; i++) {
        const job = toScore[i];
        if (i > 0) await sleep(LLM_PACING_MS);
        try {
          const { analysis, retriesUsed } = await scoreJob(job);
          retries += retriesUsed;
          await ctx.runMutation(internal.careerAgent.saveJob, {
            title: job.title,
            company: job.company,
            url: job.url,
            location: job.location,
            source: job.source,
            description: job.description.slice(0, DESCRIPTION_CHARS),
            dedupeKey: jobKey(job.title, job.company),
            ...analysis,
          });
          saved++;
        } catch (err) {
          lastFailure = err instanceof Error ? err.message : String(err);
          console.error(`Failed to score ${job.url}:`, lastFailure.slice(0, 300));
        }
      }

      // 7. Report status to the dashboard
      const failed = toScore.length - saved;
      let lastError: string | null = null;
      if (toScore.length > 0 && saved === 0) {
        lastError = `All ${toScore.length} scorings failed: ${lastFailure?.slice(0, 200)}`;
      } else if (sourceErrors.length > 0) {
        lastError = `Source issues — ${sourceErrors.join("; ")}`;
      } else if (failed > 0) {
        lastError = `${failed} job(s) failed to score; will retry next run`;
      }

      await ctx.runMutation(internal.careerAgent.setAgentStatus, {
        status: "idle",
        lastRun: Date.now(),
        lastError,
      });

      return {
        sources: results.map((r) => ({
          source: r.source,
          fetched: r.jobs.length,
          ...(r.error && { error: r.error }),
        })),
        unique: unique.length,
        relevant: relevant.length,
        repeatsSkipped: relevant.length - fresh.length,
        descriptionsBackfilled: backfilled,
        new: toScore.length,
        saved,
        failed,
        retries,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.careerAgent.setAgentStatus, {
        status: "idle",
        lastRun: Date.now(),
        lastError: message,
      });
      throw err;
    }
  },
});

// ---------- LLM scoring ----------

async function scoreJob(
  job: NormalizedJob
): Promise<{ analysis: Analysis; retriesUsed: number }> {
  const system = `You are a strict technical recruiter evaluating job fit.
Respond with ONLY a JSON object, no markdown, no preamble:
{"matchScore": integer 0-100, "reasons": string[] (max 4, short), "missing": string[] (max 4, short), "recommendation": "Apply" | "Maybe" | "Skip"}
Rules:
- Be honest; do not inflate scores.
- If the job's location restrictions exclude candidates in Pakistan, matchScore must be below 30 and recommendation "Skip".
- "Apply" only for matchScore >= 75.`;

  const user = `CANDIDATE PROFILE:
${PROFILE}

JOB:
Title: ${job.title}
Company: ${job.company}
Allowed locations: ${job.location || "Unspecified"}
Salary: ${job.salary || "Not listed"}
Description: ${job.description.slice(0, DESCRIPTION_CHARS)}`;

  const { data: parsed, retriesUsed } = await callLLMJson<Partial<Analysis>>({ system, user });

  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.matchScore) || 0)));
  const rec = parsed.recommendation;

  return {
    retriesUsed,
    analysis: {
      matchScore: score,
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 4).map(String) : [],
      missing: Array.isArray(parsed.missing) ? parsed.missing.slice(0, 4).map(String) : [],
      recommendation: rec === "Apply" || rec === "Maybe" || rec === "Skip" ? rec : "Maybe",
    },
  };
}

// ---------- Internal DB helpers ----------

// Returns URLs of items not already saved (checked by URL and by title+company key)
export const filterNew = internalQuery({
  args: { items: v.array(v.object({ url: v.string(), key: v.string() })) },
  handler: async (ctx, { items }) => {
    const fresh: string[] = [];
    for (const { url, key } of items) {
      const byUrl = await ctx.db
        .query("jobs")
        .withIndex("by_url", (q) => q.eq("url", url))
        .first();
      if (byUrl) continue;
      const byKey = await ctx.db
        .query("jobs")
        .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", key))
        .first();
      if (byKey) continue;
      fresh.push(url);
    }
    return fresh;
  },
});

// Fills in descriptions for saved jobs that don't have one yet
export const backfillDescriptions = internalMutation({
  args: { items: v.array(v.object({ url: v.string(), description: v.string() })) },
  handler: async (ctx, { items }) => {
    let updated = 0;
    for (const { url, description } of items) {
      const job = await ctx.db
        .query("jobs")
        .withIndex("by_url", (q) => q.eq("url", url))
        .first();
      if (job && !job.description && description) {
        await ctx.db.patch(job._id, { description });
        updated++;
      }
    }
    return updated;
  },
});

export const saveJob = internalMutation({
  args: {
    title: v.string(),
    company: v.string(),
    url: v.string(),
    location: v.string(),
    source: v.string(),
    description: v.string(),
    dedupeKey: v.string(),
    matchScore: v.number(),
    reasons: v.array(v.string()),
    missing: v.array(v.string()),
    recommendation: v.union(v.literal("Apply"), v.literal("Maybe"), v.literal("Skip")),
  },
  handler: async (ctx, args) => {
    const byUrl = await ctx.db
      .query("jobs")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .first();
    if (byUrl) return byUrl._id;

    const byKey = await ctx.db
      .query("jobs")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", args.dedupeKey))
      .first();
    if (byKey) return byKey._id;

    return await ctx.db.insert("jobs", {
      ...args,
      status: "Saved",
      foundAt: Date.now(),
    });
  },
});

export const setAgentStatus = internalMutation({
  args: {
    status: v.union(v.literal("running"), v.literal("idle"), v.literal("disabled")),
    lastRun: v.optional(v.number()),
    lastError: v.optional(v.union(v.string(), v.null())), // null = clear
  },
  handler: async (ctx, { status, lastRun, lastError }) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_name", (q) => q.eq("name", AGENT_NAME))
      .first();

    if (!agent) {
      await ctx.db.insert("agents", {
        name: AGENT_NAME,
        status,
        ...(lastRun !== undefined && { lastRun }),
        ...(typeof lastError === "string" && { lastError }),
      });
      return;
    }

    await ctx.db.patch(agent._id, {
      status,
      ...(lastRun !== undefined && { lastRun }),
      ...(lastError !== undefined && { lastError: lastError ?? undefined }),
    });
  },
});
