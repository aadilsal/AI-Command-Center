import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { callLLMJson, QuotaExhaustedError } from "./llm";
import { PROFILE } from "./profile";

const AGENT_NAME = "Coach Agent";
const DAY = 24 * 60 * 60 * 1000;
const STRONG_MATCH = 60;
const MAX_ATTEMPTS = 3;

type WeakSpot = { area: string; evidence: string; whyItMatters: string; action: string; resource: string };
type Report = { headline: string; strengths: string[]; weakSpots: WeakSpot[]; focusThisWeek: string };

// ---------- Public ----------

export const latest = query({
  args: {},
  handler: async (ctx) =>
    await ctx.db.query("coachReports").withIndex("by_createdAt").order("desc").first(),
});

export const runNow = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.coachAgent.run, {});
  },
});

// ---------- Gather your real activity (numbers computed in code, not by the LLM) ----------

export const gather = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const jobs = (await ctx.db.query("jobs").collect()).filter((j) => j.source);
    const problems = await ctx.db.query("problems").collect();

    const by = (s: string) => jobs.filter((j) => j.status === s).length;
    const acted = ["Applied", "Interview", "Offer", "Rejected"];
    const appliedTotal = jobs.filter((j) => acted.includes(j.status)).length;

    // Skill gaps across strong matches
    const strong = jobs.filter((j) => j.matchScore >= STRONG_MATCH);
    const gapCounts = new Map<string, number>();
    for (const j of strong) {
      for (const m of j.missing ?? []) {
        const key = m.trim().toLowerCase();
        if (key) gapCounts.set(key, (gapCounts.get(key) ?? 0) + 1);
      }
    }
    const topGaps = [...gapCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([gap, count]) => ({ gap, count }));

    // Apply-rated jobs: acted on vs let go
    const applyRated = jobs.filter((j) => j.recommendation === "Apply");
    const applyRatedActed = applyRated.filter((j) => acted.includes(j.status)).length;
    const applyRatedExpired = applyRated.filter(
      (j) => j.status === "Archived" || (j.status === "Saved" && now - (j.foundAt ?? now) > 7 * DAY)
    ).length;

    const appliedLast30 = jobs.filter(
      (j) => acted.includes(j.status) && (j.statusChangedAt ?? 0) > now - 30 * DAY
    ).length;

    const appliedScores = jobs.filter((j) => acted.includes(j.status)).map((j) => j.matchScore);
    const avgAppliedScore = appliedScores.length
      ? Math.round(appliedScores.reduce((a, b) => a + b, 0) / appliedScores.length)
      : 0;

    const kitsGenerated = jobs.filter((j) => j.kit).length;
    const kitsUsed = jobs.filter((j) => j.kit && acted.includes(j.status)).length;

    return {
      jobs: {
        totalScored: jobs.length,
        strongMatches: strong.length,
        saved: by("Saved"),
        applied: by("Applied"),
        interviews: by("Interview"),
        offers: by("Offer"),
        rejected: by("Rejected"),
        appliedTotal,
        appliedLast30Days: appliedLast30,
        applyRated: applyRated.length,
        applyRatedActedOn: applyRatedActed,
        applyRatedExpiredOrStale: applyRatedExpired,
        avgMatchScoreOfApplied: avgAppliedScore,
        interviewRatePercent: appliedTotal ? Math.round(((by("Interview") + by("Offer")) / appliedTotal) * 100) : 0,
        kitsGenerated,
        kitsUsedInApplications: kitsUsed,
      },
      topSkillGaps: topGaps,
      radar: {
        problems: problems.length,
        readyToDesign: problems.filter((p) => !p.solution && p.signalCount >= 2 && p.status !== "Parked").length,
        designed: problems.filter((p) => p.solution).length,
        exploring: problems.filter((p) => p.status === "Exploring").length,
        building: problems.filter((p) => p.status === "Building").length,
        parked: problems.filter((p) => p.status === "Parked").length,
      },
    };
  },
});

// ---------- The agent ----------

const numbersIn = (t: string) => new Set(t.match(/\d+(\.\d+)?/g) ?? []);

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.agentStatus.set, { name: AGENT_NAME, status: "running" });

    try {
      const stats = await ctx.runQuery(internal.coachAgent.gather, {});
      const dataText = JSON.stringify(stats, null, 1);

      const system = `You are a direct, practical career and business coach for a software engineer who is job hunting and building a side studio.
You receive his REAL activity data. Identify his weak spots and what to do about them this week.

Respond with ONLY a JSON object:
{"headline": string, "strengths": string[], "weakSpots": [{"area": string, "evidence": string, "whyItMatters": string, "action": string, "resource": string}], "focusThisWeek": string}

Rules:
- weakSpots: 2-5 items, most important first. Group related skill gaps (e.g. "AWS", "aws lambda", "cloud deployment" = one weak spot).
- evidence: cite numbers that appear in the DATA (e.g. "missing in 9 of 23 strong matches"). Never invent numbers.
- Include process weak spots when the data shows them (e.g. many Apply-rated jobs expired, low applications in 30 days, kits generated but not used, problems ready to design but untouched).
- action: one concrete task doable in 5 hours or less (e.g. "deploy your Command Center dashboard to AWS free tier and add it to your CV").
- resource: name a well-known FREE resource (official docs, free courses). No URLs.
- strengths: 1-3 genuine strengths backed by the data. No flattery.
- focusThisWeek: the single most valuable thing to do this week, one sentence.
- headline: one honest sentence summarizing where he stands.
- If there's too little data for a conclusion, say so instead of guessing.

CANDIDATE PROFILE (for context):
${PROFILE}`;

      let report: Report | null = null;
      let violations: string[] = [];

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const feedback = violations.length
          ? `\n\nYOUR PREVIOUS ANSWER BROKE THESE RULES — fix them:\n- ${violations.join("\n- ")}`
          : "";

        const { data } = await callLLMJson<Partial<Report>>({
          system,
          user: `DATA:\n${dataText}${feedback}`,
          maxTokens: 3000,
        });

        report = {
          headline: String(data.headline ?? "").slice(0, 240),
          strengths: (data.strengths ?? []).map(String).slice(0, 3),
          weakSpots: (data.weakSpots ?? [])
            .filter((w) => w && w.area && w.action)
            .slice(0, 5)
            .map((w) => ({
              area: String(w.area).slice(0, 120),
              evidence: String(w.evidence ?? "").slice(0, 300),
              whyItMatters: String(w.whyItMatters ?? "").slice(0, 300),
              action: String(w.action).slice(0, 300),
              resource: String(w.resource ?? "").slice(0, 200),
            })),
          focusThisWeek: String(data.focusThisWeek ?? "").slice(0, 300),
        };

        // Every number must come from the data
        const allowed = numbersIn(dataText);
        const text = JSON.stringify(report);
        const invented = [...numbersIn(text)].filter((n) => !allowed.has(n) && Number(n) > 5);
        violations = [];
        if (invented.length) violations.push(`numbers not in the DATA: ${invented.join(", ")} — use only numbers from the data`);
        if (report.weakSpots.length < 1) violations.push("give at least 2 weak spots");
        if (!report.headline) violations.push("headline is required");
        if (violations.length === 0) break;
      }

      if (!report || !report.headline) throw new Error("Coach could not produce a report — try again");

      await ctx.runMutation(internal.coachAgent.save, { ...report, stats });
      await ctx.runMutation(internal.agentStatus.set, {
        name: AGENT_NAME,
        status: "idle",
        lastRun: Date.now(),
        lastError: null,
      });
      return { headline: report.headline, weakSpots: report.weakSpots.length };
    } catch (err) {
      const message =
        err instanceof QuotaExhaustedError ? err.message : err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.agentStatus.set, {
        name: AGENT_NAME,
        status: "idle",
        lastRun: Date.now(),
        lastError: message,
      });
      if (!(err instanceof QuotaExhaustedError)) throw err;
      return { stopped: message };
    }
  },
});

export const save = internalMutation({
  args: {
    headline: v.string(),
    strengths: v.array(v.string()),
    weakSpots: v.array(
      v.object({
        area: v.string(),
        evidence: v.string(),
        whyItMatters: v.string(),
        action: v.string(),
        resource: v.string(),
      })
    ),
    focusThisWeek: v.string(),
    stats: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("coachReports", { ...args, createdAt: Date.now() });
  },
});
