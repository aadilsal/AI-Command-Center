"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  Briefcase,
  Building2,
  Bot,
  Loader2,
  Play,
  Phone,
  Mail,
  Globe,
  MapPin,
  Sparkles,
  RefreshCw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const JOBS_PER_PAGE = 6;
const LEADS_PER_PAGE = 10;

const statusDot: Record<string, string> = {
  running: "bg-green-500 animate-pulse",
  idle: "bg-yellow-500",
  disabled: "bg-zinc-500",
};

const recBadge: Record<string, string> = {
  Apply: "bg-green-500/15 text-green-400",
  Maybe: "bg-yellow-500/15 text-yellow-400",
  Skip: "bg-zinc-500/15 text-zinc-400",
};

const priorityBadge: Record<string, string> = {
  High: "bg-green-500/15 text-green-400",
  Medium: "bg-yellow-500/15 text-yellow-400",
  Low: "bg-zinc-500/15 text-zinc-400",
};

const kindBadge: Record<string, { label: string; cls: string }> = {
  followup: { label: "Follow up", cls: "bg-orange-500/15 text-orange-400" },
  job: { label: "Job", cls: "bg-blue-500/15 text-blue-400" },
  lead: { label: "Lead", cls: "bg-green-500/15 text-green-400" },
  system: { label: "System", cls: "bg-zinc-500/15 text-zinc-400" },
};

const LEAD_TABS = ["New", "Contacted", "Replied", "Won", "Lost"] as const;
type LeadStatus = (typeof LEAD_TABS)[number] | "Not a fit" | "Archived";
const JOB_STATUSES = ["Saved", "Applied", "Interview", "Rejected", "Offer"] as const;
type JobStatus = (typeof JOB_STATUSES)[number];

function timeAgo(ts?: number) {
  if (!ts) return "Never";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

// ---------- Pagination ----------

function paginate<T>(items: T[], page: number, perPage: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(Math.max(1, page), pageCount); // clamp if the list shrank
  const start = (current - 1) * perPage;
  return {
    pageItems: items.slice(start, start + perPage),
    pageCount,
    current,
    from: items.length ? start + 1 : 0,
    to: Math.min(start + perPage, items.length),
  };
}

function pageNumbers(current: number, count: number): (number | "…")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const pages: (number | "…")[] = [1];
  const lo = Math.max(2, current - 1);
  const hi = Math.min(count - 1, current + 1);
  if (lo > 2) pages.push("…");
  for (let p = lo; p <= hi; p++) pages.push(p);
  if (hi < count - 1) pages.push("…");
  pages.push(count);
  return pages;
}

function Pagination({
  current,
  pageCount,
  from,
  to,
  total,
  onChange,
}: {
  current: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4">
      <span className="text-xs text-zinc-500">
        {from}–{to} of {total}
      </span>
      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onChange(current - 1)}
            disabled={current === 1}
            className="rounded-md border border-zinc-700 p-1 text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {pageNumbers(current, pageCount).map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-zinc-600">
                …
              </span>
            ) : (
              <button
                key={p}
                onClick={() => onChange(p)}
                className={`min-w-7 rounded-md px-2 py-1 text-xs ${
                  p === current
                    ? "bg-zinc-100 text-zinc-900"
                    : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {p}
              </button>
            )
          )}
          <button
            onClick={() => onChange(current + 1)}
            disabled={current === pageCount}
            className="rounded-md border border-zinc-700 p-1 text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Run button ----------

function RunButton({
  running,
  onRun,
  label = "Run now",
  icon = "play",
}: {
  running: boolean;
  onRun: () => Promise<unknown>;
  label?: string;
  icon?: "play" | "refresh";
}) {
  const [busy, setBusy] = useState(false);
  const Icon = icon === "refresh" ? RefreshCw : Play;
  return (
    <button
      onClick={async () => {
        setBusy(true);
        try {
          await onRun();
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy || running}
      className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
    >
      {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
      {running ? "Running" : label}
    </button>
  );
}

// ---------- Page ----------

export default function Home() {
  const data = useQuery(api.dashboard.summary);
  const briefing = useQuery(api.briefingAgent.latest);

  const runCareerAgent = useMutation(api.careerAgent.runNow);
  const runLeadAgent = useMutation(api.leadAgent.runNow);
  const runBriefing = useMutation(api.briefingAgent.runNow);

  const setLeadStatus = useMutation(api.leadCrm.setStatus);
  const markContacted = useMutation(api.leadCrm.markContacted);
  const setJobStatus = useMutation(api.jobCrm.setStatus);
  const markApplied = useMutation(api.jobCrm.markApplied);

  const [leadTab, setLeadTab] = useState<(typeof LEAD_TABS)[number]>("New");
  const [jobPage, setJobPage] = useState(1);
  const [leadPage, setLeadPage] = useState(1);

  if (data === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </main>
    );
  }

  const agentRunning = (name: string) =>
    data.agents.find((a) => a.name === name)?.status === "running";

  const jobsPaged = paginate(data.matchJobs, jobPage, JOBS_PER_PAGE);
  const tabLeads = data.leads.filter((l) => (l.status ?? "New") === leadTab);
  const leadsPaged = paginate(tabLeads, leadPage, LEADS_PER_PAGE);

  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100 md:p-10">
      <h1 className="text-2xl font-semibold">Aadil AI Command Center</h1>
      <p className="mt-1 text-sm text-zinc-400">What needs your attention today</p>

      {/* ---------- Daily briefing ---------- */}
      <section className="mt-8 rounded-xl border border-zinc-700 bg-gradient-to-b from-zinc-900 to-zinc-950 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-zinc-300">
            <Sparkles className="h-4 w-4" /> Today&apos;s briefing
            {briefing && (
              <span className="text-xs text-zinc-500">
                · {briefing.date} · {timeAgo(briefing.createdAt)}
                {briefing.generatedBy === "rules" ? " · basic mode" : ""}
              </span>
            )}
          </span>
          <RunButton
            running={agentRunning("Briefing Agent")}
            onRun={() => runBriefing()}
            label="Regenerate"
            icon="refresh"
          />
        </div>

        {!briefing ? (
          <p className="mt-4 text-sm text-zinc-500">No briefing yet — press Regenerate.</p>
        ) : (
          <>
            <p className="mt-3 text-lg font-medium">{briefing.headline}</p>
            <ol className="mt-4 space-y-3">
              {briefing.actions.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs text-zinc-400">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${kindBadge[a.kind].cls}`}>
                        {kindBadge[a.kind].label}
                      </span>
                      {a.url ? (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-sm hover:underline"
                        >
                          {a.title} <ExternalLink className="h-3 w-3 text-zinc-500" />
                        </a>
                      ) : (
                        <span className="text-sm">{a.title}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500">{a.why}</p>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      {/* ---------- Summary cards ---------- */}
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-zinc-400">
              <Briefcase className="h-4 w-4" /> Career Agent
            </span>
            <RunButton running={agentRunning("Career Agent")} onRun={() => runCareerAgent()} />
          </div>
          <p className="mt-3 text-3xl font-semibold">{data.matchJobs.length}</p>
          <p className="text-sm text-zinc-400">
            open matches · {data.appliedCount} acted on · {data.archivedJobs} archived
          </p>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-zinc-400">
              <Building2 className="h-4 w-4" /> TechVersa Agent
            </span>
            <RunButton running={agentRunning("Lead Agent")} onRun={() => runLeadAgent()} />
          </div>
          <p className="mt-3 text-3xl font-semibold">{data.newLeads}</p>
          <p className="text-sm text-zinc-400">
            new leads · {data.highPriorityLeads} high priority · {data.archivedLeads} archived
          </p>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="flex items-center gap-2 text-zinc-400">
            <Bot className="h-4 w-4" /> AI Workers
          </div>
          <ul className="mt-3 space-y-2">
            {data.agents.map((a) => (
              <li key={a._id} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${statusDot[a.status]}`} />
                    {a.name}
                  </span>
                  <span className="text-zinc-500">{timeAgo(a.lastRun)}</span>
                </div>
                {a.lastError && (
                  <p className="mt-1 truncate text-xs text-red-400" title={a.lastError}>
                    {a.lastError}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ---------- Job matches ---------- */}
      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="font-medium">Job matches</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Jobs you haven&apos;t acted on, best first. “Apply ↗” opens the posting and marks it Applied.
        </p>
        {data.matchJobs.length === 0 && (
          <p className="mt-4 text-sm text-zinc-500">Nothing new — you&apos;re caught up.</p>
        )}
        <ul className="mt-4 grid gap-5 md:grid-cols-2">
          {jobsPaged.pageItems.map((j) => (
            <li key={j._id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="block text-sm">{j.title}</span>
                  <span className="block text-xs text-zinc-500">
                    {j.company} · {j.location ?? "—"} · {j.source}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {j.recommendation && (
                    <span className={`rounded px-1.5 py-0.5 text-xs ${recBadge[j.recommendation]}`}>
                      {j.recommendation}
                    </span>
                  )}
                  <span className="text-sm font-semibold text-green-400">{j.matchScore}%</span>
                </div>
              </div>
              {j.missing?.length ? (
                <p className="mt-1 text-xs text-zinc-500">Missing: {j.missing.join(", ")}</p>
              ) : null}
              <div className="mt-2 flex items-center gap-2">
                <a
                  href={j.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => markApplied({ id: j._id as Id<"jobs"> })}
                  className="flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-white"
                >
                  Apply <ExternalLink className="h-3 w-3" />
                </a>
                <select
                  value={j.status}
                  onChange={(e) =>
                    setJobStatus({ id: j._id as Id<"jobs">, status: e.target.value as JobStatus })
                  }
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
                >
                  {JOB_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
        <Pagination
          current={jobsPaged.current}
          pageCount={jobsPaged.pageCount}
          from={jobsPaged.from}
          to={jobsPaged.to}
          total={data.matchJobs.length}
          onChange={setJobPage}
        />
      </section>

      {/* ---------- TechVersa leads pipeline ---------- */}
      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">TechVersa leads</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Tapping a phone or email marks the lead Contacted.
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {LEAD_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setLeadTab(tab);
                  setLeadPage(1);
                }}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  leadTab === tab
                    ? "bg-zinc-100 text-zinc-900"
                    : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {tab} ({data.statusCounts[tab] ?? 0})
              </button>
            ))}
          </div>
        </div>

        {tabLeads.length === 0 && (
          <p className="mt-4 text-sm text-zinc-500">No leads with status “{leadTab}”.</p>
        )}

        <ul className="mt-4 divide-y divide-zinc-800">
          {leadsPaged.pageItems.map((l) => {
            const id = l._id as Id<"leads">;
            return (
              <li key={l._id} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {l.company}{" "}
                      <span className="font-normal text-zinc-500">
                        · {l.industry}
                        {l.city ? ` · ${l.city}` : ""}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">{l.problem}</p>
                    <p className="text-xs text-zinc-400">→ {l.solution}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${priorityBadge[l.priority]}`}>
                      {l.priority}
                    </span>
                    <span className="text-sm font-semibold text-green-400">{l.fitScore ?? "—"}</span>
                    <select
                      value={l.status ?? "New"}
                      onChange={(e) => setLeadStatus({ id, status: e.target.value as LeadStatus })}
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
                    >
                      {[...LEAD_TABS, "Not a fit"].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                  {l.phone && (
                    <a
                      href={`tel:${l.phone}`}
                      onClick={() => markContacted({ id })}
                      className="flex items-center gap-1 hover:text-zinc-100"
                    >
                      <Phone className="h-3 w-3" /> {l.phone}
                    </a>
                  )}
                  {l.email && (
                    <a
                      href={`mailto:${l.email}`}
                      onClick={() => markContacted({ id })}
                      className="flex items-center gap-1 hover:text-zinc-100"
                    >
                      <Mail className="h-3 w-3" /> {l.email}
                    </a>
                  )}
                  {l.socialUrl && (
                    <a
                      href={l.socialUrl.startsWith("http") ? l.socialUrl : `https://${l.socialUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 hover:text-zinc-100"
                    >
                      <Globe className="h-3 w-3" /> Social
                    </a>
                  )}
                  {l.url && (
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 hover:text-zinc-100"
                    >
                      <MapPin className="h-3 w-3" /> {l.address ?? "Map"}
                    </a>
                  )}
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(
                      `${l.company} ${l.city ?? ""}`
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-zinc-100"
                  >
                    Check on Google ↗
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
        <Pagination
          current={leadsPaged.current}
          pageCount={leadsPaged.pageCount}
          from={leadsPaged.from}
          to={leadsPaged.to}
          total={tabLeads.length}
          onChange={setLeadPage}
        />
      </section>
    </main>
  );
}
