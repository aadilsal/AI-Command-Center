"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ArrowLeft, ExternalLink, Loader2, Play, Rocket, TrendingUp } from "lucide-react";
import { CopyButton, Select, timeAgo } from "../ui";

const stageStyle: Record<string, string> = {
  early: "bg-purple-500/15 text-purple-400",
  growing: "bg-green-500/15 text-green-400",
  mainstream: "bg-zinc-500/15 text-zinc-400",
};

const typeStyle: Record<string, { label: string; cls: string }> = {
  portfolio: { label: "Portfolio", cls: "bg-blue-500/15 text-blue-400" },
  product: { label: "Product", cls: "bg-green-500/15 text-green-400" },
  service: { label: "TechVersa service", cls: "bg-orange-500/15 text-orange-400" },
};

type Term = { term: string; thisMonth: number; lastMonth: number; growth: number; isNew: boolean };

export default function TrendsPage() {
  const [selected, setSelected] = useState<Id<"trendReports"> | undefined>(undefined);
  const report = useQuery(api.views.trendReport, { id: selected });
  const { results: history, status, loadMore } = usePaginatedQuery(api.views.trendHistory, {}, { initialNumItems: 12 });
  const runNow = useMutation(api.trendAgent.runNow);
  const [busy, setBusy] = useState(false);
  const [ideaType, setIdeaType] = useState("");
  const [termSort, setTermSort] = useState<"growth" | "volume" | "new">("growth");

  const terms: Term[] = [...((report?.sources?.risingTerms ?? []) as Term[])];
  terms.sort((a, b) =>
    termSort === "volume" ? b.thisMonth - a.thisMonth : termSort === "new" ? Number(b.isNew) - Number(a.isNew) || b.growth - a.growth : b.growth - a.growth
  );
  const ideas = (report?.ideas ?? []).filter((i) => !ideaType || i.type === ideaType);

  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100 md:p-10">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <TrendingUp className="h-6 w-6" /> Trend Scout
          </h1>
          <p className="mt-1 text-sm text-zinc-400">What&apos;s rising in tech, measured month over month — and what to build on it.</p>
        </div>
        <button
          onClick={async () => {
            setBusy(true);
            setSelected(undefined);
            try {
              await runNow();
            } finally {
              setTimeout(() => setBusy(false), 3000);
            }
          }}
          disabled={busy}
          className="flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} New report
        </button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* History */}
        <aside className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
          <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Report history</p>
          {status === "LoadingFirstPage" ? (
            <Loader2 className="mx-auto my-6 h-4 w-4 animate-spin text-zinc-500" />
          ) : history.length === 0 ? (
            <p className="px-2 py-4 text-xs text-zinc-500">No reports yet.</p>
          ) : (
            <ul className="space-y-1">
              {history.map((h, i) => {
                const active = selected ? selected === h._id : i === 0;
                return (
                  <li key={h._id}>
                    <button
                      onClick={() => setSelected(h._id)}
                      className={`w-full rounded-md px-2 py-2 text-left ${active ? "bg-zinc-800" : "hover:bg-zinc-800/50"}`}
                    >
                      <p className="text-xs text-zinc-400">{new Date(h.createdAt).toLocaleDateString()} · {timeAgo(h.createdAt)}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-zinc-200">{h.headline}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {status === "CanLoadMore" && (
            <button onClick={() => loadMore(12)} className="mt-2 w-full rounded-md border border-zinc-700 py-1 text-xs hover:bg-zinc-800">
              Load more
            </button>
          )}
        </aside>

        <div className="space-y-6">
          {report === undefined ? (
            <div className="flex justify-center py-10 text-zinc-500"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : !report ? (
            <p className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-500">No report yet — press “New report”.</p>
          ) : (
            <>
              <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                <p className="text-xs text-zinc-500">
                  {new Date(report.createdAt).toLocaleString()} · based on {report.sources?.hnStories?.thisMonth ?? 0} HN stories this month (
                  {report.sources?.hnStories?.lastMonth ?? 0} last month), {report.sources?.githubRepos ?? 0} new repos,{" "}
                  {report.sources?.showHNLaunches ?? 0} launches
                </p>
                <p className="mt-2 text-lg font-medium">{report.headline}</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {report.trends.map((t, i) => (
                    <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{t.name}</p>
                        <span className={`rounded px-1.5 py-0.5 text-xs capitalize ${stageStyle[t.stage] ?? stageStyle.growing}`}>{t.stage}</span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">{t.evidence}</p>
                      {t.whyItMatters && <p className="mt-1 text-xs text-zinc-500">{t.whyItMatters}</p>}
                    </div>
                  ))}
                </div>
              </section>

              {/* Ideas */}
              <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="flex items-center gap-1 font-medium"><Rocket className="h-4 w-4" /> Project ideas</h2>
                  <Select
                    label="Type"
                    value={ideaType}
                    onChange={setIdeaType}
                    options={[
                      { value: "", label: "All" },
                      { value: "portfolio", label: "Portfolio" },
                      { value: "product", label: "Product" },
                      { value: "service", label: "TechVersa service" },
                    ]}
                  />
                </div>
                <ol className="mt-4 space-y-3">
                  {ideas.map((idea, i) => {
                    const ty = typeStyle[idea.type] ?? typeStyle.product;
                    const doc = `# ${idea.title}\n\n${idea.oneLiner}\n\n**Why now:** ${idea.whyNow}\n**Fits your stack:** ${idea.fitsYourStack}\n**Build effort:** ${idea.buildEffort}\n**First step:** ${idea.firstStep}\n`;
                    return (
                      <li key={i} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                              {idea.title}
                              <span className={`rounded px-1.5 py-0.5 text-xs font-normal ${ty.cls}`}>{ty.label}</span>
                              {idea.buildEffort && <span className="text-xs font-normal text-zinc-500">{idea.buildEffort}</span>}
                            </p>
                            <p className="mt-1 text-sm text-zinc-300">{idea.oneLiner}</p>
                          </div>
                          <CopyButton text={doc} />
                        </div>
                        <p className="mt-2 text-xs text-zinc-400"><span className="text-zinc-500">Why now:</span> {idea.whyNow}</p>
                        <p className="mt-1 text-xs text-zinc-400"><span className="text-zinc-500">Fits your stack:</span> {idea.fitsYourStack}</p>
                        <p className="mt-2 text-sm text-zinc-200">→ {idea.firstStep}</p>
                      </li>
                    );
                  })}
                  {ideas.length === 0 && <p className="text-xs text-zinc-500">No ideas of this type in this report.</p>}
                </ol>
              </section>

              {/* Rising terms */}
              <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-medium">Rising terms on Hacker News</h2>
                    <p className="mt-1 text-xs text-zinc-500">Stories mentioning each term: last 30 days vs the 30 days before. Measured in code.</p>
                  </div>
                  <Select
                    label="Sort"
                    value={termSort}
                    onChange={(v) => setTermSort(v as "growth" | "volume" | "new")}
                    options={[
                      { value: "growth", label: "Fastest growth" },
                      { value: "volume", label: "Most mentions" },
                      { value: "new", label: "Brand new first" },
                    ]}
                  />
                </div>
                {terms.length === 0 ? (
                  <p className="mt-3 text-xs text-zinc-500">Full term data is stored from the next report onward — press “New report”.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-zinc-500">
                        <tr className="border-b border-zinc-800">
                          <th className="py-2 pr-3 font-normal">Term</th>
                          <th className="py-2 pr-3 text-right font-normal">This month</th>
                          <th className="py-2 pr-3 text-right font-normal">Last month</th>
                          <th className="py-2 text-right font-normal">Growth</th>
                        </tr>
                      </thead>
                      <tbody>
                        {terms.map((t) => (
                          <tr key={t.term} className="border-b border-zinc-800/60">
                            <td className="py-1.5 pr-3 text-zinc-200">
                              {t.term}
                              {t.isNew && <span className="ml-2 rounded bg-purple-500/15 px-1 py-0.5 text-[10px] text-purple-400">new</span>}
                            </td>
                            <td className="py-1.5 pr-3 text-right text-zinc-300">{t.thisMonth}</td>
                            <td className="py-1.5 pr-3 text-right text-zinc-500">{t.lastMonth}</td>
                            <td className="py-1.5 text-right text-green-400">×{t.growth}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Repos + launches */}
              <div className="grid gap-6 md:grid-cols-2">
                <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                  <h2 className="font-medium">Hottest new GitHub repos</h2>
                  <p className="mt-1 text-xs text-zinc-500">Created in the last 30 days, by stars.</p>
                  <ul className="mt-3 space-y-2 text-xs">
                    {(report.sources?.topRepos ?? []).map((r: { name: string; stars: number; url: string }) => (
                      <li key={r.url} className="flex items-center justify-between gap-2">
                        <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate text-zinc-300 hover:text-white">
                          {r.name} <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                        <span className="shrink-0 text-zinc-500">★ {r.stars}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                  <h2 className="font-medium">Top Show HN launches</h2>
                  <p className="mt-1 text-xs text-zinc-500">What makers shipped in the last 30 days.</p>
                  <ul className="mt-3 space-y-2 text-xs">
                    {(report.sources?.topLaunches ?? []).map((l: { title: string; points: number; url: string }) => (
                      <li key={l.url} className="flex items-center justify-between gap-2">
                        <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate text-zinc-300 hover:text-white">
                          {l.title} <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                        <span className="shrink-0 text-zinc-500">▲ {l.points}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
