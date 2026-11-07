import { v } from "convex/values";
import { query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

const ACTED = ["Applied", "Interview", "Offer", "Rejected"];

// ---------------------------------------------------------------- Career: jobs

export const jobsPage = query({
  args: {
    status: v.optional(v.string()), // "active" (default), "all", or a specific status
    recommendation: v.optional(v.string()),
    source: v.optional(v.string()),
    minScore: v.optional(v.number()),
    search: v.optional(v.string()),
    sort: v.optional(v.union(v.literal("score"), v.literal("newest"))),
    page: v.number(),
    pageSize: v.number(),
  },
  handler: async (ctx, a) => {
    const all = (await ctx.db.query("jobs").collect()).filter((j) => j.source);

    // Facets (for filter dropdowns + header stats), computed before filtering
    const statusCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};
    for (const j of all) {
      statusCounts[j.status] = (statusCounts[j.status] ?? 0) + 1;
      sourceCounts[j.source!] = (sourceCounts[j.source!] ?? 0) + 1;
    }
    const active = all.filter((j) => j.status !== "Archived");
    const avgScore = active.length
      ? Math.round(active.reduce((s, j) => s + j.matchScore, 0) / active.length)
      : 0;

    // Filters
    const status = a.status ?? "active";
    const q = (a.search ?? "").trim().toLowerCase();
    let rows = all.filter((j) => {
      if (status === "active" && j.status === "Archived") return false;
      if (status !== "active" && status !== "all" && j.status !== status) return false;
      if (a.recommendation && j.recommendation !== a.recommendation) return false;
      if (a.source && j.source !== a.source) return false;
      if (a.minScore && j.matchScore < a.minScore) return false;
      if (q && !`${j.title} ${j.company} ${j.location ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });

    rows.sort((x, y) =>
      a.sort === "newest"
        ? (y.foundAt ?? y._creationTime) - (x.foundAt ?? x._creationTime)
        : y.matchScore - x.matchScore
    );

    const total = rows.length;
    const pageCount = Math.max(1, Math.ceil(total / a.pageSize));
    const page = Math.min(Math.max(1, a.page), pageCount);
    const items = rows
      .slice((page - 1) * a.pageSize, page * a.pageSize)
      .map(({ description: _d, ...rest }) => rest); // never send descriptions to the browser

    return {
      items,
      total,
      page,
      pageCount,
      facets: {
        statusCounts,
        sources: Object.keys(sourceCounts).sort(),
        activeCount: active.length,
        actedCount: all.filter((j) => ACTED.includes(j.status)).length,
        kits: all.filter((j) => j.kit).length,
        avgScore,
      },
    };
  },
});

// ---------------------------------------------------------------- Radar: problems

export const problemsPage = query({
  args: {
    status: v.optional(v.string()), // "all" or a status
    source: v.optional(v.string()),
    minEvidence: v.optional(v.number()),
    wtpOnly: v.optional(v.boolean()),
    designedOnly: v.optional(v.boolean()),
    search: v.optional(v.string()),
    sort: v.optional(v.union(v.literal("score"), v.literal("evidence"), v.literal("newest"))),
    page: v.number(),
    pageSize: v.number(),
  },
  handler: async (ctx, a) => {
    const all = await ctx.db.query("problems").collect();

    const statusCounts: Record<string, number> = {};
    const sourceSet = new Set<string>();
    for (const p of all) {
      statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
      p.sources.forEach((s) => sourceSet.add(s));
    }

    const status = a.status ?? "all";
    const q = (a.search ?? "").trim().toLowerCase();
    let rows = all.filter((p) => {
      if (status !== "all" && p.status !== status) return false;
      if (a.source && !p.sources.includes(a.source)) return false;
      if (a.minEvidence && p.signalCount < a.minEvidence) return false;
      if (a.wtpOnly && p.wtpCount === 0) return false;
      if (a.designedOnly && !p.solution) return false;
      if (q) {
        const hay = `${p.title} ${p.summary} ${p.persona} ${p.industries.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    rows.sort((x, y) =>
      a.sort === "evidence"
        ? y.signalCount - x.signalCount || y.score - x.score
        : a.sort === "newest"
          ? y.firstSeenAt - x.firstSeenAt
          : y.score - x.score
    );

    const total = rows.length;
    const pageCount = Math.max(1, Math.ceil(total / a.pageSize));
    const page = Math.min(Math.max(1, a.page), pageCount);

    return {
      items: rows.slice((page - 1) * a.pageSize, page * a.pageSize),
      total,
      page,
      pageCount,
      facets: {
        statusCounts,
        sources: [...sourceSet].sort(),
        total: all.length,
        designed: all.filter((p) => p.solution).length,
        withWtp: all.filter((p) => p.wtpCount > 0).length,
      },
    };
  },
});

// ---------------------------------------------------------------- Radar: raw signals (large table → cursor pagination)

export const signalsPage = query({
  args: {
    status: v.union(v.literal("pending"), v.literal("analyzed"), v.literal("noise")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { status, paginationOpts }) => {
    const result = await ctx.db
      .query("painSignals")
      .withIndex("by_status", (q) => q.eq("status", status))
      .order("desc")
      .paginate(paginationOpts);

    return {
      ...result,
      page: result.page.map((s) => ({
        _id: s._id,
        url: s.url,
        source: s.source,
        title: s.title,
        snippet: s.text.slice(0, 280),
        postedAt: s.postedAt,
        fetchedAt: s.fetchedAt,
        problemId: s.problemId,
        pain: s.extraction?.pain,
        persona: s.extraction?.persona,
      })),
    };
  },
});
