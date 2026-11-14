import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

// Measures how big each table is, so we can check the Convex free tier limits
// before moving to the cloud. Run:  npx convex run usageCheck:sizes
// (Reads every row once — fine on your local backend.)

const TABLES = [
  "jobs",
  "painSignals",
  "problems",
  "prospects",
  "prospectTargets",
  "leads",
  "leadTargets",
  "agentRuns",
  "agents",
  "briefings",
  "coachReports",
  "trendReports",
  "counters",
  "homeSnapshot",
  "pageVisits",
  "autopilotSettings",
  "autopilotActions",
  "integrations",
  "suppressions",
  "inboundEmails",
  "seenMail",
  "jobDetails",
  "tombstones",
] as const;

export const sizePage = internalQuery({
  args: { table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, cursor }) => {
    const res = await ctx.db.query(table as any).paginate({ cursor, numItems: 25 });
    let bytes = 0;
    let descBytes = 0;
    let textBytes = 0;
    for (const doc of res.page as any[]) {
      bytes += JSON.stringify(doc).length;
      if (typeof doc.description === "string") descBytes += doc.description.length;
      if (typeof doc.text === "string") textBytes += doc.text.length;
    }
    return { n: res.page.length, bytes, descBytes, textBytes, cursor: res.continueCursor, isDone: res.isDone };
  },
});

export const sizes = internalAction({
  args: {},
  handler: async (ctx) => {
    const out: Record<string, string> = {};
    let total = 0;
    for (const table of TABLES) {
      let rows = 0;
      let bytes = 0;
      let desc = 0;
      let text = 0;
      let cursor: string | null = null;
      try {
        do {
          const r: { n: number; bytes: number; descBytes: number; textBytes: number; cursor: string; isDone: boolean } =
            await ctx.runQuery(internal.usageCheck.sizePage, { table, cursor });
          rows += r.n;
          bytes += r.bytes;
          desc += r.descBytes;
          text += r.textBytes;
          cursor = r.isDone ? null : r.cursor;
        } while (cursor);
      } catch {
        out[table] = "missing";
        continue;
      }
      total += bytes;
      const kb = (n: number) => `${Math.round(n / 1024)} KB`;
      out[table] =
        `${rows} rows · ${kb(bytes)}` +
        (desc ? ` (descriptions ${kb(desc)})` : "") +
        (text ? ` (post text ${kb(text)})` : "");
    }
    out.TOTAL = `${(total / 1024 / 1024).toFixed(1)} MB`;
    return out;
  },
});
