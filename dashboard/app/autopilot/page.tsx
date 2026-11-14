"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AlertTriangle, ArrowUpRight, Check, Loader2, Lock, Mail, Pause, Play, X, Zap } from "lucide-react";
import { timeAgo } from "../ui";

const MODES = [
  ["off", "Off"],
  ["draft", "Ask me"],
  ["auto", "Auto"],
] as const;

const LOG_TABS = [
  ["", "All"],
  ["done", "Done"],
  ["queued", "Queued"],
  ["running", "Running"],
  ["failed", "Failed"],
  ["rejected", "Rejected"],
] as const;

const statusStyle: Record<string, string> = {
  pending: "text-[#fb923c]",
  queued: "text-zinc-400",
  running: "text-[#fbbf24]",
  done: "text-[#5eead4]",
  failed: "text-red-400",
  rejected: "text-zinc-500",
};

export default function AutopilotPage() {
  const state = useQuery(api.autopilot.state);
  const gmail = useQuery(api.gmail.status);
  const setPaused = useMutation(api.autopilot.setPaused);
  const setPolicy = useMutation(api.autopilot.setPolicy);
  const approve = useMutation(api.autopilot.approve);
  const reject = useMutation(api.autopilot.reject);
  const approveAll = useMutation(api.autopilot.approveAll);
  const runNow = useMutation(api.autopilot.runNow);
  const [logTab, setLogTab] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const pending = usePaginatedQuery(api.autopilot.actionsPage, { status: "pending" }, { initialNumItems: 20 });
  const log = usePaginatedQuery(api.autopilot.actionsPage, { status: logTab || undefined }, { initialNumItems: 20 });

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center text-zinc-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </main>
    );
  }

  async function savePolicy(key: string, patch: { mode?: "off" | "draft" | "auto"; dailyCap?: number; minScore?: number }) {
    setNotice(null);
    try {
      await setPolicy({ key, ...patch });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="px-4 pt-7 pb-14 md:px-9">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className={`mb-1 font-mono text-xs tracking-[0.14em] ${state.paused ? "text-red-400" : "text-[#fb923c]"}`}>
              {state.paused ? "AUTOPILOT PAUSED — NOTHING RUNS" : "AUTOPILOT ENGAGED · SCANS FOR WORK EVERY 3 HOURS"}
            </p>
            <h1 className="flex items-center gap-2 font-display text-[32px] font-semibold tracking-tight">
              <Zap className="h-7 w-7 text-[#fb923c]" /> Autopilot
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-hud-muted">
              The work your agents do without you. <b className="text-hud-text">Auto</b> runs by itself up to a daily limit,{" "}
              <b className="text-hud-text">Ask me</b> waits for your approval below, <b className="text-hud-text">Off</b> never
              happens. Every step is logged.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => runNow()}
              disabled={state.paused}
              className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-hud-line px-4 text-sm text-hud-text hover:border-[#fb923c] disabled:opacity-40"
            >
              <Play className="h-4 w-4" /> Run now
            </button>
            <button
              type="button"
              onClick={() => setPaused({ paused: !state.paused })}
              className={`inline-flex min-h-11 items-center gap-2 rounded-[10px] px-4 text-sm font-semibold ${
                state.paused
                  ? "bg-[#5eead4] text-zinc-950 hover:bg-[#99f6e4]"
                  : "border border-red-500/60 bg-red-500/10 text-red-300 hover:bg-red-500/20"
              }`}
            >
              {state.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {state.paused ? "Resume autopilot" : "Pause everything"}
            </button>
          </div>
        </header>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Waiting for you", state.pendingCount, "#fb923c"],
            ["Queued", state.queuedCount, undefined],
            ["Done today", state.doneToday, "#5eead4"],
            ["Failed today", state.failedToday, state.failedToday ? "#f87171" : undefined],
          ].map(([label, value, color]) => (
            <div key={label as string} className="rounded-xl border border-hud-line bg-hud-panel p-4">
              <p className="hud-label">{label}</p>
              <p className="mt-1 font-display text-[30px] font-semibold" style={color ? { color: color as string } : undefined}>
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Gmail connection */}
        {gmail && (
          <section
            aria-label="Gmail connection"
            className={`flex flex-wrap items-start gap-3 rounded-2xl border p-4 ${
              gmail.status === "connected" ? "border-hud-line bg-hud-panel" : "border-red-500/40 bg-red-500/[0.06]"
            }`}
          >
            <Mail className={`mt-0.5 h-5 w-5 shrink-0 ${gmail.status === "connected" ? "text-[#5eead4]" : "text-red-400"}`} />
            <div className="min-w-0 flex-1 text-sm">
              {gmail.status === "connected" ? (
                <p>
                  Gmail connected as <b>{gmail.email}</b>. Cold emails go out on weekdays between 14:00 and 23:00 PKT,
                  one every few minutes ({state.sendingWindowOpen ? "sending window is open now" : "outside the sending window right now"}).
                  Answers to replies can go any time.
                </p>
              ) : gmail.status === "error" ? (
                <p>
                  <b className="text-red-300">Gmail needs you to sign in again.</b> {gmail.lastError} Run{" "}
                  <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs">node scripts/gmail-login.mjs</code>
                </p>
              ) : (
                <p>
                  <b>Gmail isn&apos;t connected yet</b>, so sending and reply reading are locked. Run{" "}
                  <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs">node scripts/gmail-login.mjs</code> in the dashboard
                  folder.
                </p>
              )}
              {gmail.status === "connected" && !gmail.postalAddressSet && (
                <p className="mt-2 flex items-start gap-1.5 text-[#fbbf24]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Add your business postal address — business emails must include one, so sending is blocked until it&apos;s set:{" "}
                    <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs">
                      npx convex env set POSTAL_ADDRESS &quot;TechVersa, street, Lahore, Pakistan&quot;
                    </code>
                  </span>
                </p>
              )}
              {gmail.status === "connected" && !gmail.bookingUrlSet && (
                <p className="mt-2 text-hud-dim">
                  Tip: add a free Cal.com booking link so replies can offer a call slot:{" "}
                  <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs">npx convex env set BOOKING_URL &quot;https://cal.com/you/15min&quot;</code>
                </p>
              )}
            </div>
          </section>
        )}

        {notice && <p className="rounded-lg border border-hud-line bg-hud-panel p-3 text-sm text-hud-muted">{notice}</p>}

        {/* Approval queue */}
        <section aria-labelledby="queue-h" className="rounded-2xl border border-hud-line bg-hud-panel">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hud-soft px-5 py-4">
            <h2 id="queue-h" className="font-display text-lg font-semibold">
              Waiting for you
            </h2>
            {pending.results.length > 1 && (
              <button
                type="button"
                onClick={() => approveAll()}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#5eead4]/50 px-3 text-xs text-[#5eead4] hover:bg-[#5eead4]/10"
              >
                <Check className="h-3.5 w-3.5" /> Approve all
              </button>
            )}
          </div>
          {pending.results.length === 0 ? (
            <p className="px-5 py-6 text-sm text-hud-dim">
              Nothing needs your approval. Set an action to <b>Ask me</b> below to review each step before it runs.
            </p>
          ) : (
            <ul className="divide-y divide-hud-soft">
              {pending.results.map((a) => (
                <li key={a._id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="hud-label w-20 shrink-0">{a.agent}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{a.title}</span>
                    <span className="block text-[13px] text-hud-dim">
                      {a.detail ? `${a.detail} · ` : ""}proposed {timeAgo(a.createdAt)}
                    </span>
                  </span>
                  {a.href && (
                    <Link href={a.href} className="text-xs text-hud-muted hover:text-hud-text" aria-label={`Open ${a.agent}`}>
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => approve({ id: a._id as Id<"autopilotActions"> })}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-[#5eead4] px-3 text-xs font-semibold text-zinc-950 hover:bg-[#99f6e4]"
                  >
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => reject({ id: a._id as Id<"autopilotActions"> })}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-hud-line px-3 text-xs text-hud-muted hover:text-hud-text"
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Rules */}
        <section aria-labelledby="rules-h" className="overflow-hidden rounded-2xl border border-hud-line bg-hud-panel">
          <div className="border-b border-hud-soft px-5 py-4">
            <h2 id="rules-h" className="font-display text-lg font-semibold">
              What Autopilot may do
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="text-left">
                  {["Action", "Agent", "Mode", "Daily limit", "Min score", "Used today"].map((h) => (
                    <th key={h} scope="col" className="hud-label px-5 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.policies.map((p) => (
                  <tr key={p.key} className={`border-t border-hud-soft ${p.available ? "" : "opacity-60"}`}>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2">
                        {!p.available && <Lock className="h-3.5 w-3.5 shrink-0 text-hud-dim" />}
                        {p.label}
                      </span>
                      {!p.available && <span className="text-xs text-hud-dim">{p.lockedReason}</span>}
                    </td>
                    <td className="px-5 py-3 text-hud-muted">{p.agent}</td>
                    <td className="px-5 py-3">
                      <div className="inline-flex overflow-hidden rounded-lg border border-hud-line" role="group" aria-label={`Mode for ${p.label}`}>
                        {MODES.map(([m, label]) => (
                          <button
                            key={m}
                            type="button"
                            disabled={!p.available}
                            aria-pressed={p.mode === m}
                            onClick={() => savePolicy(p.key, { mode: m })}
                            className={`min-h-9 px-3 text-xs ${
                              p.mode === m
                                ? m === "auto"
                                  ? "bg-[#fb923c] font-semibold text-zinc-950"
                                  : m === "draft"
                                    ? "bg-zinc-100 font-medium text-zinc-900"
                                    : "bg-zinc-800 text-zinc-300"
                                : "text-hud-muted hover:bg-white/[0.04]"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <NumberField
                        label={`Daily limit for ${p.label}`}
                        value={p.dailyCap}
                        disabled={!p.available}
                        onSave={(n) => savePolicy(p.key, { dailyCap: n })}
                      />
                    </td>
                    <td className="px-5 py-3">
                      {p.key === "autoFollowUpDraft" || p.key === "sendFollowUp" || p.key === "replyTriage" ? (
                        <span className="text-hud-dim">—</span>
                      ) : (
                        <NumberField
                          label={`Minimum score for ${p.label}`}
                          value={p.minScore}
                          disabled={!p.available}
                          onSave={(n) => savePolicy(p.key, { minScore: n })}
                        />
                      )}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-hud-muted">
                      {p.usedToday} / {p.dailyCap}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Activity log */}
        <section aria-labelledby="log-h" className="rounded-2xl border border-hud-line bg-hud-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hud-soft px-5 py-4">
            <h2 id="log-h" className="hud-label text-xs">
              // Activity log
            </h2>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter log">
              {LOG_TABS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={logTab === key}
                  onClick={() => setLogTab(key)}
                  className={`min-h-8 rounded-full px-3 text-xs ${
                    logTab === key ? "bg-zinc-100 text-zinc-900" : "border border-hud-line text-hud-muted hover:text-hud-text"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {log.status === "LoadingFirstPage" ? (
            <div className="flex justify-center py-8 text-hud-dim">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : log.results.length === 0 ? (
            <p className="px-5 py-6 text-sm text-hud-dim">No activity yet. Autopilot scans every 3 hours, or press Run now.</p>
          ) : (
            <ul className="divide-y divide-hud-soft">
              {log.results.map((a) => (
                <li key={a._id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                  <span className={`w-20 shrink-0 font-mono text-[11px] uppercase tracking-wider ${statusStyle[a.status]}`}>
                    {a.status === "pending" ? "waiting" : a.status}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{a.title}</span>
                    {a.result && <span className="block text-[13px] text-hud-muted">{a.result}</span>}
                    <span className="block text-xs text-hud-dim">
                      {a.agent} · {a.decidedBy === "you" ? "approved by you" : a.decidedBy === "autopilot" ? "automatic" : "proposed"} ·{" "}
                      {timeAgo(a.finishedAt ?? a.createdAt)}
                    </span>
                  </span>
                  {a.href && (
                    <Link href={a.href} className="text-hud-muted hover:text-hud-text" aria-label={`Open ${a.agent}`}>
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          {log.status === "CanLoadMore" && (
            <div className="flex justify-center border-t border-hud-soft py-3">
              <button
                type="button"
                onClick={() => log.loadMore(20)}
                className="min-h-9 rounded-lg border border-hud-line px-4 text-xs text-hud-muted hover:text-hud-text"
              >
                Load more
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onSave: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      min={0}
      max={100}
      aria-label={label}
      disabled={disabled}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== "" && Number(draft) !== value) onSave(Number(draft));
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-20 rounded-md border border-hud-line bg-transparent px-2 py-1.5 font-mono text-xs text-hud-text disabled:opacity-50"
    />
  );
}
