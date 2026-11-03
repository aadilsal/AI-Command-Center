"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import {
  Briefcase,
  Radar,
  Bot,
  Loader2,
  Play,
  Sparkles,
  RefreshCw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  FileText,
  Lightbulb,
  Quote,
} from "lucide-react";

const JOBS_PER_PAGE = 6;
const PROBLEMS_PER_PAGE = 8;

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

const kindBadge: Record<string, { label: string; cls: string }> = {
  followup: { label: "Follow up", cls: "bg-orange-500/15 text-orange-400" },
  job: { label: "Job", cls: "bg-blue-500/15 text-blue-400" },
  opportunity: { label: "Opportunity", cls: "bg-purple-500/15 text-purple-400" },
  lead: { label: "Lead", cls: "bg-green-500/15 text-green-400" },
  system: { label: "System", cls: "bg-zinc-500/15 text-zinc-400" },
};

const JOB_STATUSES = ["Saved", "Applied", "Interview", "Rejected", "Offer"] as const;
type JobStatus = (typeof JOB_STATUSES)[number];
const PROBLEM_TABS = ["New", "Exploring", "Building", "Launched", "Parked"] as const;
type ProblemStatus = (typeof PROBLEM_TABS)[number];

function timeAgo(ts?: number) {
  if (!ts) return "Never";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

function scoreColor(score: number) {
  if (score >= 60) return "text-green-400";
  if (score >= 40) return "text-yellow-400";
  return "text-zinc-400";
}

// ---------- Small UI helpers ----------

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
    >
      {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function Block({ title, text, copyText }: { title: string; text: string; copyText?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</span>
        <CopyButton text={copyText ?? text} />
      </div>
      <p className="whitespace-pre-wrap text-sm text-zinc-200">{text}</p>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</span>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-200">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Pagination ----------

function paginate<T>(items: T[], page: number, perPage: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(Math.max(1, page), pageCount);
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

// ---------- Panels ----------

function KitPanel({ kit }: { kit: NonNullable<Doc<"jobs">["kit"]> }) {
  const highlightsText = kit.highlights.map((h) => `- ${h}`).join("\n");
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-zinc-500">
        Use your <span className="font-medium text-zinc-300">{kit.resumeVariant}</span> CV · generated{" "}
        {timeAgo(kit.generatedAt)} · review before sending
      </p>
      <Block title="Summary" text={kit.summary} />
      <Block title="Highlights" text={highlightsText} />
      <Block title="Skills to list first" text={kit.skills.join(" · ")} copyText={kit.skills.join(", ")} />
      <Block title="Cover letter" text={kit.coverLetter} />
      <Block
        title={`Email — ${kit.emailSubject}`}
        text={kit.emailBody}
        copyText={`Subject: ${kit.emailSubject}\n\n${kit.emailBody}`}
      />
    </div>
  );
}

function solutionAsMarkdown(p: Doc<"problems">) {
  const s = p.solution!;
  const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  return `# ${s.name}

**Problem:** ${p.title}
**Target user:** ${s.targetUser}

## Concept
${s.concept}

## MVP features
${bullets(s.mvpFeatures)}

## Stack
${bullets(s.stack)}

**Build effort:** ${s.buildEffort}

## Pricing
${s.pricing}

## Why it wins
${s.differentiation}

## Where the users are
${bullets(s.channels)}

## Content angles
${bullets(s.contentAngles)}

## Validate before building
${bullets(s.validationSteps)}

## Risks
${bullets(s.risks)}
`;
}

function SolutionPanel({ problem }: { problem: Doc<"problems"> }) {
  const s = problem.solution!;
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="text-lg font-semibold">{s.name}</span>
          <span className="ml-2 text-xs text-zinc-500">
            designed {timeAgo(s.generatedAt)} · {s.buildEffort}
          </span>
        </p>
        <CopyButton text={solutionAsMarkdown(problem)} label="Copy as doc" />
      </div>
      <Block title="Concept" text={s.concept} />
      <Block title="Target user" text={s.targetUser} />
      <div className="grid gap-3 md:grid-cols-2">
        <ListBlock title="MVP features" items={s.mvpFeatures} />
        <ListBlock title="Stack" items={s.stack} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Block title="Pricing" text={s.pricing} />
        <Block title="Why it wins" text={s.differentiation} />
      </div>
      <ListBlock title="Validate before building" items={s.validationSteps} />
      <div className="grid gap-3 md:grid-cols-2">
        <ListBlock title="Where the users are" items={s.channels} />
        <ListBlock title="Content angles" items={s.contentAngles} />
      </div>
      <ListBlock title="Risks" items={s.risks} />
    </div>
  );
}

function EvidenceList({ problem }: { problem: Doc<"problems"> }) {
  return (
    <div className="mt-3 space-y-2">
      {problem.evidence.map((e, i) => (
        <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <p className="flex gap-2 text-sm text-zinc-200">
            <Quote className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500" />
            <span>{e.quote}</span>
          </p>
          <a
            href={e.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200"
          >
            {e.source} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ))}
      {problem.wtpEvidence.length > 0 && (
        <ListBlock title="Willingness to pay" items={problem.wtpEvidence} />
      )}
      {problem.workarounds.length > 0 && <ListBlock title="Current workarounds" items={problem.workarounds} />}
    </div>
  );
}

// ---------- Page ----------

export default function Home() {
  const data = useQuery(api.dashboard.summary);
  const briefing = useQuery(api.briefingAgent.latest);

  const runCareerAgent = useMutation(api.careerAgent.runNow);
  const runPainAgent = useMutation(api.painAgent.runNow);
  const runBriefing = useMutation(api.briefingAgent.runNow);

  const setJobStatus = useMutation(api.jobCrm.setStatus);
  const markApplied = useMutation(api.jobCrm.markApplied);
  const setProblemStatus = useMutation(api.solutionDesigner.setStatus);

  const generateKit = useAction(api.applicationKit.generateKit);
  const designSolution = useAction(api.solutionDesigner.designSolution);

  const [jobPage, setJobPage] = useState(1);
  const [problemTab, setProblemTab] = useState<ProblemStatus>("New");
  const [problemPage, setProblemPage] = useState(1);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [openSolution, setOpenSolution] = useState<string | null>(null);
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  if (data === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </main>
    );
  }

  const agentRunning = (name: string) =>
    data.agents.find((a) => a.name === name)?.status === "running";

  async function runAI(key: string, fn: () => Promise<any>, onDone?: (result: any) => void) {
    setBusy(key);
    setNotice(null);
    try {
      const result = await fn();
      onDone?.(result);
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  function design(problem: Doc<"problems">, force = false) {
    const id = problem._id as Id<"problems">;
    runAI(problem._id, () => designSolution({ id, force }), (r) => {
      if (r?.viable === false) {
        setNotice({ kind: "info", text: `Parked “${problem.title}”: ${r.parkedReason}` });
      } else if (r?.needsMoreEvidence) {
        setNotice({ kind: "info", text: r.message });
      } else {
        // Designing moves New → Exploring; follow it there and open the design
        if (problem.status === "New") setProblemTab("Exploring");
        setOpenSolution(problem._id);
      }
    });
  }

  // Briefing links like "#problem-<id>" jump to the right tab/page and open the problem
  function jumpToProblem(id: string) {
    const p = data!.problems.find((x) => x._id === id);
    if (!p) return;
    const inTab = data!.problems.filter((x) => x.status === p.status);
    const index = inTab.findIndex((x) => x._id === id);
    setProblemTab(p.status);
    setProblemPage(Math.floor(index / PROBLEMS_PER_PAGE) + 1);
    if (p.solution) setOpenSolution(id);
    else setOpenEvidence(id);
    setTimeout(() => document.getElementById(`problem-${id}`)?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  const jobsPaged = paginate(data.matchJobs, jobPage, JOBS_PER_PAGE);
  const tabProblems = data.problems.filter((p) => p.status === problemTab);
  const problemsPaged = paginate(tabProblems, problemPage, PROBLEMS_PER_PAGE);

  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100 md:p-10">
      <h1 className="text-2xl font-semibold">Aadil AI Command Center</h1>
      <p className="mt-1 text-sm text-zinc-400">What needs your attention today</p>

      {notice && (
        <div
          className={`mt-4 flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${
            notice.kind === "error"
              ? "border-red-900 bg-red-950/50 text-red-300"
              : "border-zinc-700 bg-zinc-900 text-zinc-300"
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-xs opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

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
              {briefing.actions.map((a, i) => {
                const badge = kindBadge[a.kind] ?? kindBadge.system;
                const isProblemLink = a.url?.startsWith("#problem-");
                return (
                  <li key={i} className="flex gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs text-zinc-400">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${badge.cls}`}>{badge.label}</span>
                        {a.url && isProblemLink ? (
                          <button
                            onClick={() => jumpToProblem(a.url!.replace("#problem-", ""))}
                            className="text-left text-sm hover:underline"
                          >
                            {a.title}
                          </button>
                        ) : a.url ? (
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
                );
              })}
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
              <Radar className="h-4 w-4" /> Opportunity Radar
            </span>
            <RunButton running={agentRunning("Pain Agent")} onRun={() => runPainAgent()} />
          </div>
          <p className="mt-3 text-3xl font-semibold">{data.activeProblems}</p>
          <p className="text-sm text-zinc-400">
            problems · {data.readyToDesign} ready to design · {data.pendingSignals} signals queued
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
                {!a.lastError &&
                  a.lastNote &&
                  a.lastNoteAt &&
                  Date.now() - a.lastNoteAt < 12 * 60 * 60 * 1000 && (
                    <p className="mt-1 truncate text-xs text-zinc-500" title={a.lastNote}>
                      {a.lastNote} · {timeAgo(a.lastNoteAt)}
                    </p>
                  )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ---------- Opportunity Radar ---------- */}
      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Opportunity Radar</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Real business pain, grouped and scored. Problems need {data.minEvidenceToDesign}+ pieces of
              evidence before designing a solution.
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {PROBLEM_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setProblemTab(tab);
                  setProblemPage(1);
                }}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  problemTab === tab
                    ? "bg-zinc-100 text-zinc-900"
                    : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {tab} ({data.problemCounts[tab] ?? 0})
              </button>
            ))}
          </div>
        </div>

        {tabProblems.length === 0 && (
          <p className="mt-4 text-sm text-zinc-500">
            {problemTab === "New" && data.pendingSignals > 0
              ? `Nothing here yet — ${data.pendingSignals} signals are queued for analysis.`
              : `No problems with status “${problemTab}”.`}
          </p>
        )}

        <ul className="mt-4 divide-y divide-zinc-800">
          {problemsPaged.pageItems.map((p) => {
            const id = p._id as Id<"problems">;
            const isBusy = busy === p._id;
            const solutionOpen = openSolution === p._id && !!p.solution;
            const evidenceOpen = openEvidence === p._id;
            const ready = p.signalCount >= data.minEvidenceToDesign;

            return (
              <li key={p._id} id={`problem-${p._id}`} className="scroll-mt-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{p.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {p.persona}
                      {p.industries.length ? ` · ${p.industries.join(", ")}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">{p.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                        {p.signalCount} evidence
                      </span>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                        {p.sources.join(" · ")}
                      </span>
                      {p.wtpCount > 0 && (
                        <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-green-400">
                          {p.wtpCount} would pay
                        </span>
                      )}
                      {p.solution && (
                        <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-purple-400">
                          {p.solution.name}
                        </span>
                      )}
                    </div>
                    {p.status === "Parked" && p.parkedReason && (
                      <p className="mt-2 text-xs text-zinc-500">Parked: {p.parkedReason}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`text-lg font-semibold ${scoreColor(p.score)}`}>{p.score}</span>
                    <select
                      value={p.status}
                      onChange={(e) => setProblemStatus({ id, status: e.target.value as ProblemStatus })}
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
                    >
                      {PROBLEM_TABS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setOpenEvidence(evidenceOpen ? null : p._id)}
                    className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800"
                  >
                    {evidenceOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    Evidence ({p.evidence.length})
                  </button>

                  {p.solution ? (
                    <>
                      <button
                        onClick={() => setOpenSolution(solutionOpen ? null : p._id)}
                        className="flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-white"
                      >
                        <Lightbulb className="h-3 w-3" />
                        {solutionOpen ? "Hide solution" : "View solution"}
                      </button>
                      <button
                        onClick={() => design(p, true)}
                        disabled={isBusy}
                        className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        {isBusy ? "Designing…" : "Redesign"}
                      </button>
                    </>
                  ) : p.status !== "Parked" && ready ? (
                    <button
                      onClick={() => design(p)}
                      disabled={isBusy}
                      className="flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
                    >
                      {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lightbulb className="h-3 w-3" />}
                      {isBusy ? "Designing…" : "Design solution"}
                    </button>
                  ) : p.status !== "Parked" ? (
                    <>
                      <span className="rounded-md border border-dashed border-zinc-700 px-2 py-1 text-xs text-zinc-500">
                        Needs more evidence ({p.signalCount}/{data.minEvidenceToDesign})
                      </span>
                      <button
                        onClick={() => design(p, true)}
                        disabled={isBusy}
                        className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline disabled:opacity-50"
                      >
                        {isBusy ? "Designing…" : "design anyway"}
                      </button>
                    </>
                  ) : null}
                </div>

                {evidenceOpen && <EvidenceList problem={p} />}
                {solutionOpen && p.solution && <SolutionPanel problem={p} />}
              </li>
            );
          })}
        </ul>
        <Pagination
          current={problemsPaged.current}
          pageCount={problemsPaged.pageCount}
          from={problemsPaged.from}
          to={problemsPaged.to}
          total={tabProblems.length}
          onChange={setProblemPage}
        />
      </section>

      {/* ---------- Job matches ---------- */}
      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="font-medium">Job matches</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Jobs you haven&apos;t acted on, best first. “Prepare application” writes a tailored kit;
          “Apply ↗” opens the posting and marks it Applied.
        </p>
        {data.matchJobs.length === 0 && (
          <p className="mt-4 text-sm text-zinc-500">Nothing new — you&apos;re caught up.</p>
        )}
        <ul className="mt-4 divide-y divide-zinc-800">
          {jobsPaged.pageItems.map((j) => {
            const id = j._id as Id<"jobs">;
            const isOpen = openJob === j._id && !!j.kit;
            const isBusy = busy === j._id;
            return (
              <li key={j._id} className="py-4">
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

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() =>
                      j.kit && !isOpen
                        ? setOpenJob(j._id)
                        : isOpen
                          ? setOpenJob(null)
                          : runAI(j._id, () => generateKit({ id }), () => setOpenJob(j._id))
                    }
                    disabled={isBusy}
                    className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {isBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : isOpen ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <FileText className="h-3 w-3" />
                    )}
                    {isBusy
                      ? "Writing…"
                      : isOpen
                        ? "Hide kit"
                        : j.kit
                          ? "View application kit"
                          : "Prepare application"}
                  </button>
                  {j.kit && (
                    <button
                      onClick={() => runAI(j._id, () => generateKit({ id }), () => setOpenJob(j._id))}
                      disabled={isBusy}
                      className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      <RefreshCw className="h-3 w-3" /> Regenerate
                    </button>
                  )}
                  <a
                    href={j.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => markApplied({ id })}
                    className="flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-white"
                  >
                    Apply <ExternalLink className="h-3 w-3" />
                  </a>
                  <select
                    value={j.status}
                    onChange={(e) => setJobStatus({ id, status: e.target.value as JobStatus })}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
                  >
                    {JOB_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                {isOpen && j.kit && <KitPanel kit={j.kit} />}
              </li>
            );
          })}
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
    </main>
  );
}
