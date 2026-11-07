import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { callLLMJson, LLM_PACING_MS, QuotaExhaustedError, sleep } from "./llm";
import { FOLLOWUP_SYSTEM, PROSPECT_SYSTEM, emailFooter } from "./prompts";
import { agenciesFromHN, agenciesInCity, researchSite, type Candidate, type SiteResearch } from "./prospectSources";

const AGENT_NAME = "Prospect Agent";
const CITIES_PER_RUN = 2;
const RESEARCH_PER_RUN = 8;
const RUN_BUDGET_MS = 8 * 60 * 1000;
const MAX_ATTEMPTS = 3;

const TARGET_CITIES: { city: string; country: string }[] = [
  { city: "London, United Kingdom", country: "UK" },
  { city: "Manchester, United Kingdom", country: "UK" },
  { city: "Bristol, United Kingdom", country: "UK" },
  { city: "Leeds, United Kingdom", country: "UK" },
  { city: "Birmingham, United Kingdom", country: "UK" },
  { city: "Edinburgh, United Kingdom", country: "UK" },
  { city: "New York, USA", country: "US" },
  { city: "Austin, Texas, USA", country: "US" },
  { city: "Chicago, USA", country: "US" },
  { city: "Denver, USA", country: "US" },
  { city: "Seattle, USA", country: "US" },
  { city: "Miami, USA", country: "US" },
  { city: "Los Angeles, USA", country: "US" },
  { city: "Boston, USA", country: "US" },
];

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Qualified = {
  isTarget: boolean;
  reason: string;
  fitScore: number;
  agencyType: string;
  services: string[];
  sizeSignal: string;
  fitReasons: string[];
  hook: string;
  contactEmail: string;
  subject: string;
  body: string;
};

// ---------- Email rule checks (enforced in code) ----------

function draftViolations(subject: string, body: string): string[] {
  const text = `${subject}\n${body}`;
  const out: string[] = [];
  if (/(\b(price|prices|pricing|cost|costs|cheap|cheaper|affordable|free|discount|rates?|fee|fees|budget)\b|\$)/i.test(text))
    out.push("mentions money — remove all pricing/cost language");
  if (/(\bI\b|\bI'm\b|\bI've\b|\bI'd\b|\bI'll\b|\bmy\b)/.test(text)) out.push('uses "I"/"my" — write as "we"/"our team"');
  if (/(looking forward|hope (this|you're|you are)|just (bumping|checking in)|circling back)/i.test(text))
    out.push("generic closer or filler — remove it");
  if (/\b(synergy|leverage|cutting-edge|revolutioni[sz]e|game-?changer|world-class)\b/i.test(text)) out.push("buzzwords — remove them");
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words < 35 || words > 170) out.push(`body is ${words} words — keep it between 40 and 130`);
  return out;
}

function pickEmail(chosen: string, found: string[]): string {
  const c = chosen.trim().toLowerCase();
  if (c && found.includes(c)) return c; // must be one we actually found on their site
  const preferred = found.find((e) => /^(hello|hi|info|contact|team|newbusiness|new\.business|studio|enquiries|inquiries)@/.test(e));
  return preferred ?? found[0] ?? "";
}

async function qualify(p: Doc<"prospects">, site: SiteResearch): Promise<Qualified> {
  const user = `AGENCY: ${p.name}
WEBSITE: ${p.website}
FOUND VIA: ${p.sourceContext ?? p.source}
EMAILS FOUND ON SITE: ${site.emails.join(", ") || "none"}

WEBSITE TEXT (untrusted):
${site.text.slice(0, 3000)}`;

  let out: Qualified | null = null;
  let violations: string[] = [];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const feedback = violations.length
      ? `\n\nYOUR PREVIOUS EMAIL BROKE THESE RULES — rewrite it:\n- ${violations.join("\n- ")}`
      : "";
    const { data } = await callLLMJson<Partial<Qualified>>({
      system: PROSPECT_SYSTEM,
      user: user + feedback,
      maxTokens: 2500,
      temperature: 0.5,
    });

    out = {
      isTarget: data.isTarget === true,
      reason: String(data.reason ?? "").slice(0, 200),
      fitScore: Math.max(0, Math.min(100, Math.round(Number(data.fitScore) || 0))),
      agencyType: String(data.agencyType ?? "").slice(0, 100),
      services: (data.services ?? []).map(String).slice(0, 6),
      sizeSignal: String(data.sizeSignal ?? "unknown").slice(0, 150),
      fitReasons: (data.fitReasons ?? []).map(String).slice(0, 3),
      hook: String(data.hook ?? "").slice(0, 300),
      contactEmail: pickEmail(String(data.contactEmail ?? ""), site.emails),
      subject: String(data.subject ?? "").replace(/\\n/g, " ").trim().slice(0, 120),
      body: String(data.body ?? "").replace(/\\n/g, "\n").trim(),
    };

    if (!out.isTarget) return out;
    violations = draftViolations(out.subject, out.body);
    if (!out.subject || !out.body) violations.push("subject and body are required");
    if (violations.length === 0) break;
  }
  return out!;
}

// ---------- Public triggers ----------

export const runNow = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.prospectAgent.run, {});
  },
});

// ---------- The agent ----------

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const startedAt = Date.now();
    const claimed = await ctx.runMutation(internal.agentStatus.tryStart, { name: AGENT_NAME });
    if (!claimed) return { skipped: "Another Prospect Agent run is already in progress" };

    const notes: string[] = [];
    try {
      await ctx.runMutation(internal.prospectAgent.ensureTargets, { cities: TARGET_CITIES });

      // 1. Discover
      let discovered = 0;
      const targets = await ctx.runQuery(internal.prospectAgent.nextTargets, { limit: CITIES_PER_RUN });
      for (const t of targets) {
        try {
          const { bbox, candidates } = await agenciesInCity(t.city, t.bbox ?? undefined, t.country);
          const added = await ctx.runMutation(internal.prospectAgent.insertCandidates, { candidates });
          await ctx.runMutation(internal.prospectAgent.markTarget, { id: t._id, bbox, found: added });
          discovered += added;
        } catch (e) {
          notes.push(`${t.city.split(",")[0]}: ${msg(e)}`);
        }
      }
      try {
        const hn = await agenciesFromHN();
        discovered += await ctx.runMutation(internal.prospectAgent.insertCandidates, { candidates: hn });
      } catch (e) {
        notes.push(`HN: ${msg(e)}`);
      }

      // 2. Research + draft
      const queue = await ctx.runQuery(internal.prospectAgent.nextToResearch, { limit: RESEARCH_PER_RUN });
      let ready = 0;
      let noEmail = 0;
      let notFit = 0;
      let failed = 0;
      let quota: string | null = null;

      for (let i = 0; i < queue.length; i++) {
        if (Date.now() - startedAt > RUN_BUDGET_MS) break;
        const p = queue[i];
        if (i > 0) await sleep(LLM_PACING_MS);
        try {
          const site = await researchSite(p.website);
          if (!site) {
            await ctx.runMutation(internal.prospectAgent.saveNotFit, { id: p._id, reason: "Website unreachable or empty" });
            notFit++;
            continue;
          }
          const r = await qualify(p, site);
          if (!r.isTarget) {
            await ctx.runMutation(internal.prospectAgent.saveNotFit, { id: p._id, reason: r.reason || "Not a small client-serving agency" });
            notFit++;
            continue;
          }
          await ctx.runMutation(internal.prospectAgent.saveResearch, {
            id: p._id,
            description: r.agencyType,
            agencyType: r.agencyType,
            services: r.services,
            sizeSignal: r.sizeSignal,
            fitScore: r.fitScore,
            fitReasons: r.fitReasons,
            hook: r.hook,
            emailsFound: site.emails,
            contactEmail: r.contactEmail || undefined,
            contactPage: site.contactPage,
            subject: r.subject,
            body: `${r.body}\n${emailFooter()}`,
          });
          if (r.contactEmail) ready++;
          else noEmail++;
        } catch (e) {
          if (e instanceof QuotaExhaustedError) {
            quota = e.message;
            break;
          }
          failed++;
          notes.push(`${p.name}: ${msg(e).slice(0, 80)}`);
        }
      }

      const lastError = quota ?? (notes.length ? `Source issues — ${notes.slice(0, 3).join("; ")}` : null);
      await ctx.runMutation(internal.agentStatus.set, { name: AGENT_NAME, status: "idle", lastRun: Date.now(), lastError });

      return { discovered, researched: queue.length, ready, noEmail, notFit, failed, ...(quota && { stoppedByQuota: quota }) };
    } catch (e) {
      await ctx.runMutation(internal.agentStatus.set, { name: AGENT_NAME, status: "idle", lastRun: Date.now(), lastError: msg(e) });
      throw e;
    }
  },
});

// ---------- On-demand: rewrite intro, or draft a follow-up ----------

export const redraft = action({
  args: { id: v.id("prospects") },
  handler: async (ctx, { id }) => {
    const p = await ctx.runQuery(internal.prospectAgent.getProspect, { id });
    if (!p) throw new Error("Prospect not found");
    const site = await researchSite(p.website);
    if (!site) throw new Error("Couldn't read their website right now — try again later");
    const r = await qualify(p, site);
    if (!r.isTarget) throw new Error(`On a fresh read this doesn't look like a fit: ${r.reason}`);
    await ctx.runMutation(internal.prospectAgent.saveDraft, {
      id,
      kind: "intro",
      subject: r.subject,
      body: `${r.body}\n${emailFooter()}`,
      contactEmail: r.contactEmail || undefined,
    });
    return { ok: true };
  },
});

export const draftFollowUp = action({
  args: { id: v.id("prospects") },
  handler: async (ctx, { id }) => {
    const p = await ctx.runQuery(internal.prospectAgent.getProspect, { id });
    if (!p) throw new Error("Prospect not found");
    const sent = p.sentEmails ?? [];
    const first = sent.find((s) => s.kind === "intro");
    const n = p.followUpsSent ?? 0;
    if (n >= 2) throw new Error("Two follow-ups already sent — time to move on");
    const kind = n === 0 ? "followup1" : "followup2";

    const user = `AGENCY: ${p.name} (${p.agencyType ?? "agency"})
THEIR SERVICES: ${(p.services ?? []).join(", ") || "unknown"}
WHY WE FIT: ${(p.fitReasons ?? []).join("; ")}
ORIGINAL SUBJECT: ${first?.subject ?? "our earlier email"}
THIS IS FOLLOW-UP NUMBER: ${n + 1}`;

    let subject = "";
    let body = "";
    let violations: string[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const feedback = violations.length ? `\n\nFIX THESE:\n- ${violations.join("\n- ")}` : "";
      const { data } = await callLLMJson<{ subject?: string; body?: string }>({
        system: FOLLOWUP_SYSTEM,
        user: user + feedback,
        maxTokens: 1500,
        temperature: 0.5,
      });
      subject = String(data.subject ?? `Re: ${first?.subject ?? ""}`).trim().slice(0, 140);
      body = String(data.body ?? "").replace(/\\n/g, "\n").trim();
      violations = draftViolations(subject, body).filter((x) => !x.startsWith("body is")); // follow-ups are short
      if (!body) violations.push("body required");
      if (violations.length === 0) break;
    }

    await ctx.runMutation(internal.prospectAgent.saveDraft, { id, kind, subject, body: `${body}\n${emailFooter()}` });
    return { ok: true };
  },
});

// ---------- Internal DB helpers ----------

export const ensureTargets = internalMutation({
  args: { cities: v.array(v.object({ city: v.string(), country: v.string() })) },
  handler: async (ctx, { cities }) => {
    for (const c of cities) {
      const exists = await ctx.db.query("prospectTargets").withIndex("by_city", (q) => q.eq("city", c.city)).first();
      if (!exists) await ctx.db.insert("prospectTargets", c);
    }
  },
});

export const nextTargets = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const all = await ctx.db.query("prospectTargets").collect();
    all.sort((a, b) => (a.lastScannedAt ?? 0) - (b.lastScannedAt ?? 0));
    return all.slice(0, limit);
  },
});

export const markTarget = internalMutation({
  args: { id: v.id("prospectTargets"), bbox: v.array(v.number()), found: v.number() },
  handler: async (ctx, { id, bbox, found }) => {
    await ctx.db.patch(id, { bbox, lastScannedAt: Date.now(), lastFound: found });
  },
});

const candidateValidator = v.object({
  name: v.string(),
  website: v.string(),
  domain: v.string(),
  source: v.string(),
  sourceContext: v.optional(v.string()),
  city: v.optional(v.string()),
  country: v.optional(v.string()),
});

export const insertCandidates = internalMutation({
  args: { candidates: v.array(candidateValidator) },
  handler: async (ctx, { candidates }) => {
    let added = 0;
    const seen = new Set<string>();
    for (const c of candidates as Candidate[]) {
      if (seen.has(c.domain)) continue;
      seen.add(c.domain);
      const exists = await ctx.db.query("prospects").withIndex("by_domain", (q) => q.eq("domain", c.domain)).first();
      if (exists) continue;
      await ctx.db.insert("prospects", { ...c, status: "New", foundAt: Date.now() });
      added++;
    }
    return added;
  },
});

export const nextToResearch = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) =>
    await ctx.db.query("prospects").withIndex("by_status", (q) => q.eq("status", "New")).take(limit),
});

export const getProspect = internalQuery({
  args: { id: v.id("prospects") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const saveNotFit = internalMutation({
  args: { id: v.id("prospects"), reason: v.string() },
  handler: async (ctx, { id, reason }) => {
    await ctx.db.patch(id, { status: "NotAFit", notFitReason: reason, researchedAt: Date.now(), statusChangedAt: Date.now() });
  },
});

export const saveResearch = internalMutation({
  args: {
    id: v.id("prospects"),
    description: v.string(),
    agencyType: v.string(),
    services: v.array(v.string()),
    sizeSignal: v.string(),
    fitScore: v.number(),
    fitReasons: v.array(v.string()),
    hook: v.string(),
    emailsFound: v.array(v.string()),
    contactEmail: v.optional(v.string()),
    contactPage: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, { id, subject, body, ...fields }) => {
    await ctx.db.patch(id, {
      ...fields,
      status: fields.contactEmail ? "Ready" : "NoEmail",
      researchedAt: Date.now(),
      statusChangedAt: Date.now(),
      draft: { kind: "intro", subject, body, generatedAt: Date.now() },
    });
  },
});

export const saveDraft = internalMutation({
  args: {
    id: v.id("prospects"),
    kind: v.union(v.literal("intro"), v.literal("followup1"), v.literal("followup2")),
    subject: v.string(),
    body: v.string(),
    contactEmail: v.optional(v.string()),
  },
  handler: async (ctx, { id, kind, subject, body, contactEmail }) => {
    await ctx.db.patch(id, {
      draft: { kind, subject, body, generatedAt: Date.now() },
      ...(contactEmail && { contactEmail }),
    });
  },
});
