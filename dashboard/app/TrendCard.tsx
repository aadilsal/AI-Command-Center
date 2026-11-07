"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { ChevronDown, ChevronUp, ExternalLink, Loader2, RefreshCw, Rocket, TrendingUp } from "lucide-react";
import { CopyButton, timeAgo } from "./ui";

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

export default function TrendCard() {
  const report = useQuery(api.trendAgent.latest);
  const runNow = useMutation(api.trendAgent.runNow);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [showSources, setShowSources] = useState(false);

  return (
    <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-zinc-300">
          <TrendingUp className="h-4 w-4" /> Trend Scout — what&apos;s rising
          {report && <span className="text-xs text-zinc-500">· {timeAgo(report.createdAt)}</span>}
          {open ? <ChevronUp className="h-3 w-3 text-zinc-500" /> : <ChevronDown className="h-3 w-3 text-zinc-500" />}
        </button>
        <Link href="/trends" className="ml-auto mr-2 text-xs text-zinc-500 hover:text-zinc-200">Open →</Link>
        <button
          onClick={async () => {
            setBusy(true);
            try {
              await runNow();
            } finally {
              setTimeout(() => setBusy(false), 3000);
            }
          }}
          disabled={busy}
          className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {busy ? "Running" : "Run now"}
        </button>
      </div>

      {open &&
        (!report ? (
          <p className="mt-4 text-sm text-zinc-500">No report yet — press Run now (takes ~1 minute).</p>
        ) : (
          <div className="mt-4 space-y-5">
            <p className="text-base font-medium">{report.headline}</p>

            {/* Trends */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Rising trends</p>
              <div className="grid gap-3 md:grid-cols-2">
                {report.trends.map((t, i) => (
                  <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{t.name}</p>
                      <span className={`rounded px-1.5 py-0.5 text-xs capitalize ${stageStyle[t.stage] ?? stageStyle.growing}`}>
                        {t.stage}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">{t.evidence}</p>
                    {t.whyItMatters && <p className="mt-1 text-xs text-zinc-500">{t.whyItMatters}</p>}
                  </div>
                ))}
              </div>
            </div>

            {/* Ideas */}
            <div>
              <p className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                <Rocket className="h-3 w-3" /> Project ideas
              </p>
              <ol className="space-y-3">
                {report.ideas.map((idea, i) => {
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
                        <CopyButton text={doc} label="Copy" />
                      </div>
                      <p className="mt-2 text-xs text-zinc-400">
                        <span className="text-zinc-500">Why now:</span> {idea.whyNow}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">
                        <span className="text-zinc-500">Fits your stack:</span> {idea.fitsYourStack}
                      </p>
                      <p className="mt-2 text-sm text-zinc-200">→ {idea.firstStep}</p>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* Sources */}
            <div>
              <button
                onClick={() => setShowSources(!showSources)}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
              >
                {showSources ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                What this was based on: {report.sources?.hnStories?.thisMonth ?? 0} HN stories this month ·{" "}
                {report.sources?.githubRepos ?? 0} new GitHub repos · {report.sources?.showHNLaunches ?? 0} Show HN launches
              </button>
              {showSources && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Hottest new repos</p>
                    <ul className="mt-2 space-y-1 text-xs">
                      {(report.sources?.topRepos ?? []).map((r: { name: string; stars: number; url: string }) => (
                        <li key={r.url}>
                          <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-zinc-300 hover:text-white">
                            {r.name} <span className="text-zinc-500">★ {r.stars}</span> <ExternalLink className="h-3 w-3" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Top Show HN launches</p>
                    <ul className="mt-2 space-y-1 text-xs">
                      {(report.sources?.topLaunches ?? []).map((l: { title: string; points: number; url: string }) => (
                        <li key={l.url}>
                          <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-zinc-300 hover:text-white">
                            {l.title} <span className="text-zinc-500">▲ {l.points}</span> <ExternalLink className="h-3 w-3" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
    </section>
  );
}
