import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { callLLMJson } from "./llm";

type Draft = { whatsapp: string; emailSubject: string; emailBody: string };

const MAX_ATTEMPTS = 3;

const SYSTEM = `You write first-contact outreach messages for TechVersa (techversa.co), a software and AI services studio based in Lahore that works with businesses worldwide.

What TechVersa delivers (pick what fits this business; do not list everything):
- AI voice receptionists / voice agents that answer every call, 24/7, and book appointments
- WhatsApp automation: booking, confirmations, reminders, follow-ups
- Missed-call recovery and automated follow-ups
- Online booking systems, custom web apps, and websites
- Google Business Profile and local SEO

Write TWO messages to the business described: a WhatsApp message and an email.
Respond with ONLY a JSON object: {"whatsapp": string, "emailSubject": string, "emailBody": string}

How to pitch:
- Lead with the business OUTCOME (calls answered 24/7, more bookings, fewer no-shows, faster replies), not with "you need a website".
- Name the most relevant 1-2 solutions for this business type — usually the AI voice receptionist and/or WhatsApp booking. Mention a website only as part of the package, never as the main offer.
- Use the business's actual name and city.

Hard rules for both messages:
- Write as the company: "we", "our team", "us". Never use "I", "I'm", "my". Never mention any individual's background, title, or experience.
- Never mention money in any form: prices, rates, costs, fees, "free", "no extra cost", discounts, cheap, affordable, budget.
- Do not claim you noticed, saw, visited, called, or came across anything. At most say "we couldn't find online booking for [name]". Never invent facts about the business.
- One clear, low-pressure ask: a short call, or a reply if it sounds useful.
- No buzzwords ("synergy", "leverage", "cutting-edge", "revolutionize", "game-changer"), no fake familiarity, at most 1 emoji.
- No generic closers like "let's catch up soon", "looking forward to hearing from you", "hope this finds you well".

WhatsApp message rules:
- Casual and conversational. 50-90 words. Short paragraphs, no bullet lists, no headings.
- WhatsApp formatting: single asterisks for bold (*like this*), at most once. Never **double asterisks** or markdown.
- Do not add a sign-off; it is added automatically.

Email rules:
- Subject: under 8 words, specific to them, not salesy.
- Body: 80-140 words, plain text, short paragraphs.
- Sign off with:
TechVersa
techversa.co | support@techversa.co`;

// ---------- Rule checks (enforced in code, not just the prompt) ----------

const RULES: { name: string; test: RegExp }[] = [
  {
    name: 'claims of having observed them ("noticed", "saw", "I see", "came across", "visited")',
    test: /\b(notic(e|ed|ing)|we saw|i saw|we see|i see|came across|stumbled|visited|looked at your)\b/i,
  },
  {
    name: 'any mention of money ("cost", "price", "free", "cheap", "discount", "rates", "fees", currency)',
    test: /(\b(cost|costs|costing|price|prices|pricing|priced|cheap|cheaper|affordable|free|discount|discounts|budget|fee|fees|rates?|invoice|payment)\b|\$|\bpkr\b|\brs\.?\s?\d)/i,
  },
  {
    name: 'first-person singular ("I", "I\'m", "I\'ve", "my") — must be "we" / "our team"',
    test: /(\bI\b|\bI'm\b|\bI've\b|\bI'd\b|\bI'll\b|\bmy\b)/,
  },
  {
    name: 'personal background ("engineer", "developer", "years of experience")',
    test: /\b(engineer|developer|years of experience|my experience|freelancer)\b/i,
  },
  {
    name: 'generic closers ("looking forward", "hope this finds you", "catch up")',
    test: /(looking forward|hope (this|you're|you are)|catch up soon|hope all is well)/i,
  },
];

function findViolations(d: Draft): string[] {
  const text = `${d.whatsapp}\n${d.emailSubject}\n${d.emailBody}`;
  return RULES.filter((r) => r.test.test(text)).map((r) => r.name);
}

// ---------- Internal helpers ----------

export const getLead = internalQuery({
  args: { id: v.optional(v.id("leads")) },
  handler: async (ctx, { id }): Promise<Doc<"leads"> | null> => {
    if (id) return await ctx.db.get(id);
    // No id: pick the best New lead without a draft (handy for testing)
    const leads = (await ctx.db.query("leads").collect()).filter(
      (l) => l.source && (l.status ?? "New") === "New" && !l.draft
    );
    leads.sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0));
    return leads[0] ?? null;
  },
});

export const saveDraft = internalMutation({
  args: {
    id: v.id("leads"),
    whatsapp: v.string(),
    emailSubject: v.string(),
    emailBody: v.string(),
  },
  handler: async (ctx, { id, ...draft }) => {
    await ctx.db.patch(id, { draft: { ...draft, generatedAt: Date.now() } });
  },
});

// ---------- Public: called by the dashboard "Draft message" button ----------

export const draftLead = action({
  args: { id: v.optional(v.id("leads")) },
  handler: async (
    ctx,
    { id }
  ): Promise<Draft & { company: string; attempts: number; warnings: string[] }> => {
    const lead = await ctx.runQuery(internal.outreach.getLead, { id });
    if (!lead) throw new Error("Lead not found");

    const baseUser = `BUSINESS:
Name: ${lead.company}
Type: ${lead.industry}
City: ${lead.city ?? "Unknown"}
Has social media page: ${lead.socialUrl ? "yes" : "no"}
Their likely pain: ${lead.problem}
What we'd offer: ${lead.solution}`;

    let draft: Draft | null = null;
    let violations: string[] = [];
    let attempts = 0;

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      const feedback =
        violations.length > 0
          ? `\n\nYOUR PREVIOUS DRAFT BROKE THESE RULES — rewrite both messages without them:\n- ${violations.join("\n- ")}`
          : "";

      const { data } = await callLLMJson<Partial<Draft>>({
        system: SYSTEM,
        user: baseUser + feedback,
        temperature: 0.6,
        maxTokens: 2500,
      });

      if (!data.whatsapp || !data.emailSubject || !data.emailBody) {
        violations = ["incomplete JSON — all three fields are required"];
        continue;
      }

      draft = {
        whatsapp: String(data.whatsapp)
          .replace(/\*\*(.+?)\*\*/g, "*$1*") // WhatsApp bold is single asterisks
          .replace(/\s*[—-]\s*TechVersa\s*$/i, "") // sign-off is added below
          .trim(),
        emailSubject: String(data.emailSubject).trim(),
        emailBody: String(data.emailBody).trim(),
      };

      violations = findViolations(draft);
      if (violations.length === 0) break;
    }

    if (!draft) throw new Error("Could not generate a draft — try again");

    draft.whatsapp = `${draft.whatsapp}\n\n— TechVersa`;
    await ctx.runMutation(internal.outreach.saveDraft, { id: lead._id, ...draft });

    // If all attempts still broke a rule, the draft is saved but flagged for you to edit
    return { company: lead.company, ...draft, attempts, warnings: violations };
  },
});
