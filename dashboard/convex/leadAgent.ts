import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { CATEGORIES, findBusinesses, geocodeCity } from "./osm";
import { sleep } from "./llm";

const AGENT_NAME = "Lead Agent";
const TARGETS_PER_RUN = 4;
const MAX_NEW_LEADS_PER_RUN = 60;
const GEOCODE_PAUSE_MS = 1500; // Nominatim policy: max 1 request/second
const TARGET_PAUSE_MS = 5000;
const RUN_BUDGET_MS = 8 * 60 * 1000; // stop cleanly before Convex's 10-minute limit

const priorityFor = (score: number): "High" | "Medium" | "Low" =>
  score >= 75 ? "High" : score >= 60 ? "Medium" : "Low";

const setStatus = (
  ctx: { runMutation: (...a: any[]) => Promise<any> },
  args: { status: "running" | "idle"; lastRun?: number; lastError?: string | null }
) => ctx.runMutation(internal.agentStatus.set, { name: AGENT_NAME, ...args });

// ---------- Public trigger (dashboard "Run now" button) ----------

export const runNow = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.leadAgent.run, {});
  },
});

// ---------- The agent ----------

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const startedAt = Date.now();
    await setStatus(ctx, { status: "running" });

    try {
      const targets = await ctx.runQuery(internal.leadTargets.nextToScan, {
        limit: TARGETS_PER_RUN,
      });
      if (targets.length === 0) throw new Error("No enabled lead targets — check the leadTargets table");

      const bboxCache = new Map<string, number[]>();
      const report: {
        target: string;
        businesses?: number;
        noWebsite?: number;
        saved?: number;
        error?: string;
      }[] = [];
      let totalSaved = 0;
      let stoppedEarly = false;

      for (let i = 0; i < targets.length; i++) {
        if (Date.now() - startedAt > RUN_BUDGET_MS) {
          stoppedEarly = true;
          break;
        }
        const t = targets[i];
        const category = CATEGORIES[t.category];
        const cityName = t.city.split(",")[0].trim();
        const label = `${cityName} — ${category.label}`;

        if (i > 0) await sleep(TARGET_PAUSE_MS);

        try {
          // 1. City bounding box (cached on the row after the first lookup)
          let bbox = t.bbox ?? bboxCache.get(t.city);
          if (!bbox) {
            bbox = await geocodeCity(t.city);
            await sleep(GEOCODE_PAUSE_MS);
            bboxCache.set(t.city, bbox);
            await ctx.runMutation(internal.leadTargets.cacheBbox, { city: t.city, bbox });
          }

          // 2. All named businesses of this type in the city
          const businesses = await findBusinesses(bbox, t.category);

          // 3. The gap: reachable by phone, but no website
          const gaps = businesses.filter((b) => b.phone && !b.website);

          // 4. Skip ones we already have
          const newUrls = new Set(
            await ctx.runQuery(internal.leadAgent.filterNewUrls, {
              urls: gaps.map((b) => b.osmUrl),
            })
          );

          let saved = 0;
          for (const b of gaps) {
            if (!newUrls.has(b.osmUrl)) continue;
            if (totalSaved >= MAX_NEW_LEADS_PER_RUN) break;

            // Fit score: base + business value + how reachable they are
            const fitScore = Math.min(
              100,
              50 + category.value + (b.email ? 10 : 0) + (b.socialUrl ? 5 : 0) + (b.address ? 5 : 0)
            );

            const contactBits = [
              b.phone && `Phone: ${b.phone}`,
              b.email && `Email: ${b.email}`,
              b.socialUrl && `Social: ${b.socialUrl}`,
            ].filter(Boolean);

            const summary =
              `${category.label} in ${cityName}${b.address ? ` (${b.address})` : ""}. ` +
              `${contactBits.join(" · ")}.` +
              (b.socialUrl ? " Active on social media but no website — likely receptive." : "");

            await ctx.runMutation(internal.leadAgent.saveLead, {
              url: b.osmUrl,
              source: "OpenStreetMap",
              company: b.name.slice(0, 120),
              industry: category.label,
              problem: category.problem,
              solution: category.solution,
              summary: summary.slice(0, 500),
              fitScore,
              priority: priorityFor(fitScore),
              city: cityName,
              category: t.category,
              phone: b.phone,
              email: b.email,
              address: b.address,
              socialUrl: b.socialUrl,
            });
            saved++;
            totalSaved++;
          }

          await ctx.runMutation(internal.leadTargets.markScanned, { id: t._id, found: saved });
          report.push({ target: label, businesses: businesses.length, noWebsite: gaps.length, saved });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Target "${label}" failed:`, message);
          report.push({ target: label, error: message });
        }
      }

      // 5. Report status to the dashboard
      const failedTargets = report.filter((r) => r.error);
      let lastError: string | null = null;
      if (report.length > 0 && failedTargets.length === report.length) {
        lastError = `All targets failed: ${failedTargets[0]?.error}`;
      } else if (failedTargets.length > 0) {
        lastError = `${failedTargets.length} target(s) failed: ${failedTargets
          .map((r) => r.target)
          .join(", ")} — will retry`;
      }

      await setStatus(ctx, { status: "idle", lastRun: Date.now(), lastError });

      return {
        targets: report,
        saved: totalSaved,
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

// ---------- Internal DB helpers ----------

export const filterNewUrls = internalQuery({
  args: { urls: v.array(v.string()) },
  handler: async (ctx, { urls }) => {
    const fresh: string[] = [];
    for (const url of urls) {
      const exists = await ctx.db
        .query("leads")
        .withIndex("by_url", (q) => q.eq("url", url))
        .first();
      if (!exists) fresh.push(url);
    }
    return fresh;
  },
});

export const saveLead = internalMutation({
  args: {
    url: v.string(),
    source: v.string(),
    company: v.string(),
    industry: v.string(),
    problem: v.string(),
    solution: v.string(),
    summary: v.string(),
    fitScore: v.number(),
    priority: v.union(v.literal("High"), v.literal("Medium"), v.literal("Low")),
    city: v.string(),
    category: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    socialUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const exists = await ctx.db
      .query("leads")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .first();
    if (exists) return exists._id;

    return await ctx.db.insert("leads", {
      ...args,
      status: "New",
      foundAt: Date.now(),
    });
  },
});
