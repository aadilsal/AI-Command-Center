import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { callLLMJson } from "./llm";

type Draft = { whatsapp: string; emailSubject: string; emailBody: string };

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
- Present TechVersa as a company ("we" / "our team"). Never mention any individual's background, title, or experience.
- Never mention prices, rates, costs, discounts, or being cheaper.
- Do not claim you visited, called, saw, or noticed anything about them. At most say you couldn't find online booking for them. Never invent facts about the business.
- One clear, low-pressure ask: a short call, or a reply if it sounds useful.
- No buzzwords ("synergy", "leverage", "cutting-edge", "revolutionize", "game-changer"), no fake familiarity, at most 1 emoji.
- No generic closers like "let's catch up soon", "looking forward to hearing from you", "hope this finds you well".

WhatsApp message rules:
- Casual and conversational, like a real person typing. 50-90 words. Short paragraphs, no bullet lists, no headings.
- WhatsApp formatting: single asterisks for bold (*like this*), at most once. Never **double asterisks** or markdown.
- End with "— TechVersa" on its own line.

Email rules:
- Subject: under 8 words, specific to them, not salesy.
- Body: 80-140 words, plain text, short paragraphs.
- Sign off with:
TechVersa
techversa.co | support@techversa.co`;

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
  handler: async (ctx, { id }): Promise<Draft & { company: string }> => {
    const lead = await ctx.runQuery(internal.outreach.getLead, { id });
    if (!lead) throw new Error("Lead not found");

    const user = `BUSINESS:
Name: ${lead.company}
Type: ${lead.industry}
City: ${lead.city ?? "Unknown"}
Has social media page: ${lead.socialUrl ? "yes" : "no"}
Their likely pain: ${lead.problem}
What we'd offer: ${lead.solution}`;

    const { data } = await callLLMJson<Partial<Draft>>({
      system: SYSTEM,
      user,
      temperature: 0.6,
      maxTokens: 2500,
    });

    if (!data.whatsapp || !data.emailSubject || !data.emailBody) {
      throw new Error("The model returned an incomplete draft — try again");
    }

    const whatsapp = String(data.whatsapp)
      .replace(/\*\*(.+?)\*\*/g, "*$1*") // WhatsApp bold is single asterisks
      .replace(/\s*[—-]\s*TechVersa\s*$/i, "") // strip sign-off wherever it landed…
      .trim();

    const draft: Draft = {
      whatsapp: `${whatsapp}\n\n— TechVersa`, // …and put it on its own line
      emailSubject: String(data.emailSubject).trim(),
      emailBody: String(data.emailBody).trim(),
    };

    await ctx.runMutation(internal.outreach.saveDraft, { id: lead._id, ...draft });
    return { company: lead.company, ...draft };
  },
});
