"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ArrowDown, ArrowLeft, ArrowUp, GraduationCap, Loader2, Minus, Play, Target } from "lucide-react";
import { timeAgo } from "../ui";

const JOB_LABELS: Record<string, string> = {
  totalScored: "Jobs scored",
  strongMatches: "Strong matches (60%+)",
  saved: "Saved (not acted on)",
  applied: "Applied",
  interviews: "Interviews",
  offers: "Offers",
  rejected: "Rejected",
  appliedTotal: "Applications total",
  appliedLast30Days: "Applications, last 30 days",
  applyRated: "Rated “Apply”",
  applyRatedActedOn: "“Apply” jobs you acted on",
  applyRatedExpiredOrStale: "“Apply” jobs you let go",
  avgMatchScoreOfApplied: "Avg score of jobs applied to",
  interviewRatePercent: "Interview rate (%)",
  kitsGenerated: "Application kits generated",
  kitsUsedInApplications: "Kits used in applications",
};

const RADAR_LABELS: Record<string, string> = {
  problems: "Problems found",
  readyToDesign: "Ready to design",
  designed: "Designed",
  exploring: "Exploring",
  building: "Building",
  parked: "Parked",
};

// Higher is better for these; lower is better for "let go"
const KEY_METRICS = ["appliedLast30Days", "interviews", "strongMatches", "applyRatedExpiredOrStale"];

function Delta({ now, before, lowerIsBetter }: { now: number; before?: number; lowerIsBetter?: boolean }) {
  if (before === undefined) return <span className="text-zinc-600">—</span>;
  const d = now - before;
  if (d === 0) return <span className="inline-flex items-center gap-0.5 text-zinc-500"><Minus className="h-3 w-3" />0</span>;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 ${good ? "text-green-400" : "text-red-400"}`}>
      {d > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(d)}
    </span>
  );
}

export default function CoachPage() {
  const [selected, setSelected] = useState<Id<"coachReports"> | undefined>(undefined);
  const data = useQuery(api.views.coachReport, { id: selected });
  const { results: history, status, loadMore } = usePaginatedQuery(api.views.coachHistory, {}, { initialNumItems: 12 });
  const runNow = useMutation(api.coachAgent.runNow);
  const [busy, setBusy] = useState(false);

  const report = data?.report;
  const prev = data?.previous;
  const jobs = (report?.stats?.jobs ?? {}) as Record<string, number>;
  const prevJobs = (prev?.stats?.jobs ?? {}) as Record<string, number>;
  const radar = (report?.stats?.radar ?? {}) as Record<string, number>;
  const gaps = (report?.stats?.topSkillGaps ?? []) as { gap: string; count: number }[];

  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100 md:p-10">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <GraduationCap className="h-6 w-6" /> Coach
          </h1>
          <p className="mt-1 text-sm text-zinc-400">Weekly weak-spot reports, built only from your real activity.</p>
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
                      <p className="text-xs text-zinc-400">
                        {new Date(h.createdAt).toLocaleDateString()} · {timeAgo(h.createdAt)}
                      </p>
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

        {/* Selected report */}
        <div className="space-y-6">
          {data === undefined ? (
            <div className="flex justify-center py-10 text-zinc-500"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : !report ? (
            <p className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-500">No report yet — press “New report”.</p>
          ) : (
            <>
              <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                <p className="text-xs text-zinc-500">{new Date(report.createdAt).toLocaleString()}</p>
                <p className="mt-2 text-lg font-medium">{report.headline}</p>
                {report.focusThisWeek && (
                  <div className="mt-4 flex gap-2 rounded-lg border border-purple-900/60 bg-purple-950/30 p-3 text-sm text-purple-200">
                    <Target className="mt-0.5 h-4 w-4 shrink-0" />
                    <span><span className="font-medium">Focus this week:</span> {report.focusThisWeek}</span>
                  </div>
                )}
                <ol className="mt-4 space-y-3">
                  {report.weakSpots.map((w, i) => (
                    <li key={i} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <p className="text-sm font-medium">{i + 1}. {w.area}</p>
                      <p className="mt-1 text-xs text-zinc-400">{w.evidence}</p>
                      {w.whyItMatters && <p className="mt-1 text-xs text-zinc-500">{w.whyItMatters}</p>}
                      <p className="mt-2 text-sm text-zinc-200">→ {w.action}</p>
                      {w.resource && <p className="mt-1 text-xs text-zinc-500">Resource: {w.resource}</p>}
                    </li>
                  ))}
                </ol>
                {report.strengths.length > 0 && (
                  <p className="mt-4 text-xs text-zinc-500"><span className="text-zinc-400">Strengths:</span> {report.strengths.join(" · ")}</p>
                )}
              </section>

              {/* Since last report */}
              <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                <h2 className="font-medium">Since last report</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {prev ? `Compared with ${new Date(prev.createdAt).toLocaleDateString()}` : "This is your first report — next week shows the change."}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {KEY_METRICS.map((k) => (
                    <div key={k} className="rounded-lg bg-zinc-950 p-3">
                      <p className="text-xs text-zinc-500">{JOB_LABELS[k]}</p>
                      <p className="mt-1 flex items-baseline gap-2 text-xl font-semibold">
                        {jobs[k] ?? 0}
                        <span className="text-xs font-normal">
                          <Delta now={jobs[k] ?? 0} before={prev ? prevJobs[k] ?? 0 : undefined} lowerIsBetter={k === "applyRatedExpiredOrStale"} />
                        </span>
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <div className="grid gap-6 md:grid-cols-2">
                {/* All numbers */}
                <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                  <h2 className="font-medium">Your numbers</h2>
                  <table className="mt-3 w-full text-xs">
                    <tbody>
                      {Object.entries(JOB_LABELS).map(([k, label]) => (
                        <tr key={k} className="border-b border-zinc-800/60">
                          <td className="py-1.5 text-zinc-400">{label}</td>
                          <td className="py-1.5 text-right text-zinc-200">{jobs[k] ?? 0}</td>
                        </tr>
                      ))}
                      {Object.entries(RADAR_LABELS).map(([k, label]) => (
                        <tr key={k} className="border-b border-zinc-800/60">
                          <td className="py-1.5 text-zinc-400">Radar: {label}</td>
                          <td className="py-1.5 text-right text-zinc-200">{radar[k] ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                {/* All skill gaps */}
                <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                  <h2 className="font-medium">All skill gaps</h2>
                  <p className="mt-1 text-xs text-zinc-500">How often each “missing” skill appeared across your strong matches.</p>
                  {gaps.length === 0 ? (
                    <p className="mt-3 text-xs text-zinc-500">No gaps recorded.</p>
                  ) : (
                    <ul className="mt-3 space-y-1.5">
                      {gaps.map((g) => {
                        const max = gaps[0].count || 1;
                        return (
                          <li key={g.gap} className="text-xs">
                            <div className="flex justify-between text-zinc-300">
                              <span className="capitalize">{g.gap}</span>
                              <span className="text-zinc-500">{g.count}</span>
                            </div>
                            <div className="mt-0.5 h-1.5 rounded bg-zinc-800">
                              <div className="h-1.5 rounded bg-purple-500/70" style={{ width: `${(g.count / max) * 100}%` }} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
