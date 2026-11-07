"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ArrowLeft, Bot, CheckCircle2, Clock, Info, Loader2, Play, XCircle, Zap } from "lucide-react";
import { Select, timeAgo } from "../ui";

const HOUR = 3600000;
const NOTE_MAX_AGE = 12 * HOUR;

// Mirrors convex/crons.ts (times in PKT = UTC+5)
const SCHEDULES: Record<string, { label: string; next: (lastRun?: number) => number | null }> = {
  "Career Agent": { label: "Daily at 8:00 AM & 8:00 PM", next: () => nextDailyPKT([8, 20]) },
  "Pain Agent": { label: "Every 6 hours", next: (last) => (last ? last + 6 * HOUR : null) },
  "Briefing Agent": { label: "Daily at 9:00 AM", next: () => nextDailyPKT([9]) },
  "Coach Agent": { label: "Sundays at 9:30 AM", next: () => nextWeeklyPKT(0, 9, 30) },
  "Trend Scout": { label: "Mondays at 9:45 AM", next: () => nextWeeklyPKT(1, 9, 45) },
  "Lead Agent": { label: "Retired", next: () => null },
};

function pktNow() {
  return new Date(Date.now() + 5 * HOUR); // shift so getUTC* reads PKT
}

function nextDailyPKT(hours: number[]): number {
  const now = pktNow();
  for (let add = 0; add < 2; add++) {
    for (const h of hours.sort((a, b) => a - b)) {
      const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + add, h, 0) - 5 * HOUR;
      if (t > Date.now()) return t;
    }
  }
  return Date.now();
}

function nextWeeklyPKT(dayOfWeek: number, hour: number, minute: number): number {
  const now = pktNow();
  for (let add = 0; add < 8; add++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + add, hour, minute));
    const t = d.getTime() - 5 * HOUR;
    if (d.getUTCDay() === dayOfWeek && t > Date.now()) return t;
  }
  return Date.now();
}

function inFuture(ts: number | null) {
  if (!ts) return "—";
  const mins = Math.round((ts - Date.now()) / 60000);
  if (mins <= 0) return "due now";
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs} h ${mins % 60} min`;
  return `in ${Math.floor(hrs / 24)} d`;
}

function duration(sec: number | null) {
  if (sec === null) return "—";
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

const statusDot: Record<string, string> = {
  running: "bg-green-500 animate-pulse",
  idle: "bg-yellow-500",
  disabled: "bg-zinc-600",
};

const outcomeStyle: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
  success: { icon: <CheckCircle2 className="h-3 w-3" />, cls: "text-green-400", label: "Success" },
  note: { icon: <Info className="h-3 w-3" />, cls: "text-zinc-400", label: "Note" },
  error: { icon: <XCircle className="h-3 w-3" />, cls: "text-red-400", label: "Error" },
  interrupted: { icon: <Zap className="h-3 w-3" />, cls: "text-orange-400", label: "Interrupted" },
};

export default function AgentsPage() {
  const agents = useQuery(api.views.agentsOverview);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const runners: Record<string, () => Promise<unknown>> = {
    "Career Agent": useMutation(api.careerAgent.runNow),
    "Pain Agent": useMutation(api.painAgent.runNow),
    "Briefing Agent": useMutation(api.briefingAgent.runNow),
    "Coach Agent": useMutation(api.coachAgent.runNow),
    "Trend Scout": useMutation(api.trendAgent.runNow),
  };

  const { results: runs, status: loadStatus, loadMore } = usePaginatedQuery(
    api.views.runsPage,
    { name: filter || undefined },
    { initialNumItems: 25 }
  );

  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100 md:p-10">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <div className="mt-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Bot className="h-6 w-6" /> AI Workers
        </h1>
        <p className="mt-1 text-sm text-zinc-400">Every agent, its schedule, health over the last 30 days, and full run history.</p>
      </div>

      {/* Agent cards */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {!agents ? (
          <div className="flex justify-center py-10 text-zinc-500 md:col-span-2">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          agents.map((a) => {
            const schedule = SCHEDULES[a.name] ?? { label: "Manual", next: () => null };
            const next = a.status === "disabled" ? null : schedule.next(a.lastRun);
            const s = a.stats30d;
            const successRate = s.runs ? Math.round((s.success / s.runs) * 100) : null;
            const runner = runners[a.name];
            const showNote = !a.lastError && a.lastNote && a.lastNoteAt && Date.now() - a.lastNoteAt < NOTE_MAX_AGE;

            return (
              <section key={a._id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 font-medium">
                      <span className={`h-2.5 w-2.5 rounded-full ${statusDot[a.status]}`} />
                      {a.name}
                      <span className="text-xs font-normal capitalize text-zinc-500">· {a.status}</span>
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                      <Clock className="h-3 w-3" /> {schedule.label}
                    </p>
                  </div>
                  {runner && a.status !== "disabled" && (
                    <button
                      onClick={async () => {
                        setBusy(a.name);
                        try {
                          await runner();
                        } finally {
                          setTimeout(() => setBusy(null), 2000);
                        }
                      }}
                      disabled={busy === a.name || a.status === "running"}
                      className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
                    >
                      {a.status === "running" || busy === a.name ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      {a.status === "running" ? "Running" : "Run now"}
                    </button>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-zinc-950 p-2">
                    <p className="text-zinc-500">Last run</p>
                    <p className="mt-0.5 text-zinc-200">{a.status === "running" ? `started ${timeAgo(a.startedAt)}` : timeAgo(a.lastRun)}</p>
                  </div>
                  <div className="rounded-lg bg-zinc-950 p-2">
                    <p className="text-zinc-500">Took</p>
                    <p className="mt-0.5 text-zinc-200">{duration(a.lastDurationSeconds)}</p>
                  </div>
                  <div className="rounded-lg bg-zinc-950 p-2">
                    <p className="text-zinc-500">Next run</p>
                    <p className="mt-0.5 text-zinc-200">{a.status === "disabled" ? "—" : inFuture(next)}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">{s.runs} runs (30d)</span>
                  {successRate !== null && (
                    <span
                      className={`rounded px-1.5 py-0.5 ${
                        successRate >= 80 ? "bg-green-500/15 text-green-400" : successRate >= 50 ? "bg-yellow-500/15 text-yellow-400" : "bg-red-500/15 text-red-400"
                      }`}
                    >
                      {successRate}% clean
                    </span>
                  )}
                  {s.notes > 0 && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">{s.notes} notes</span>}
                  {s.errors > 0 && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-400">{s.errors} errors</span>}
                  {s.interrupted > 0 && (
                    <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-orange-400">{s.interrupted} interrupted</span>
                  )}
                  {s.avgSeconds > 0 && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">avg {duration(s.avgSeconds)}</span>}
                </div>

                {a.lastError && <p className="mt-3 rounded-md bg-red-950/40 p-2 text-xs text-red-300">{a.lastError}</p>}
                {showNote && (
                  <p className="mt-3 rounded-md bg-zinc-950 p-2 text-xs text-zinc-400">
                    {a.lastNote} · {timeAgo(a.lastNoteAt)}
                  </p>
                )}
              </section>
            );
          })
        )}
      </div>

      {/* Run history */}
      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">Run history</h2>
          <Select
            label="Agent"
            value={filter}
            onChange={setFilter}
            options={[{ value: "", label: "All agents" }, ...(agents ?? []).map((a) => ({ value: a.name, label: a.name }))]}
          />
        </div>

        {loadStatus === "LoadingFirstPage" ? (
          <div className="flex justify-center py-10 text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : runs.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            No runs recorded yet — history starts from now. Press “Run now” on any agent to see one appear.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr className="border-b border-zinc-800">
                  <th className="py-2 pr-3 font-normal">Agent</th>
                  <th className="py-2 pr-3 font-normal">Started</th>
                  <th className="py-2 pr-3 font-normal">Took</th>
                  <th className="py-2 pr-3 font-normal">Outcome</th>
                  <th className="py-2 font-normal">Message</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const o = outcomeStyle[r.outcome];
                  return (
                    <tr key={r._id} className="border-b border-zinc-800/60 align-top">
                      <td className="py-2 pr-3 text-zinc-200">{r.name}</td>
                      <td className="py-2 pr-3 text-zinc-400" title={new Date(r.startedAt).toLocaleString()}>
                        {timeAgo(r.startedAt)}
                      </td>
                      <td className="py-2 pr-3 text-zinc-400">{duration(Math.round((r.finishedAt - r.startedAt) / 1000))}</td>
                      <td className={`py-2 pr-3 ${o.cls}`}>
                        <span className="flex items-center gap-1">
                          {o.icon} {o.label}
                        </span>
                      </td>
                      <td className="py-2 text-zinc-500">{r.message ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {loadStatus === "CanLoadMore" && (
          <div className="mt-4 flex justify-center">
            <button onClick={() => loadMore(25)} className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800">
              Load more
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
