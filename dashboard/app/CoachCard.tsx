"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { GraduationCap, Loader2, RefreshCw, Target, ChevronDown, ChevronUp } from "lucide-react";

function timeAgo(ts?: number) {
  if (!ts) return "never";
  const hrs = Math.floor((Date.now() - ts) / 3600000);
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

export default function CoachCard() {
  const report = useQuery(api.coachAgent.latest);
  const runNow = useMutation(api.coachAgent.runNow);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);

  return (
    <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-zinc-300">
          <GraduationCap className="h-4 w-4" /> Coach — your weak spots
          {report && <span className="text-xs text-zinc-500">· {timeAgo(report.createdAt)}</span>}
          {open ? <ChevronUp className="h-3 w-3 text-zinc-500" /> : <ChevronDown className="h-3 w-3 text-zinc-500" />}
        </button>
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
          <p className="mt-4 text-sm text-zinc-500">No report yet — press Run now (takes ~30 seconds).</p>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-base font-medium">{report.headline}</p>

            {report.focusThisWeek && (
              <div className="flex gap-2 rounded-lg border border-purple-900/60 bg-purple-950/30 p-3 text-sm text-purple-200">
                <Target className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="font-medium">Focus this week:</span> {report.focusThisWeek}
                </span>
              </div>
            )}

            <ol className="space-y-3">
              {report.weakSpots.map((w, i) => (
                <li key={i} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <p className="text-sm font-medium">
                    {i + 1}. {w.area}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">{w.evidence}</p>
                  {w.whyItMatters && <p className="mt-1 text-xs text-zinc-500">{w.whyItMatters}</p>}
                  <p className="mt-2 text-sm text-zinc-200">→ {w.action}</p>
                  {w.resource && <p className="mt-1 text-xs text-zinc-500">Resource: {w.resource}</p>}
                </li>
              ))}
            </ol>

            {report.strengths.length > 0 && (
              <p className="text-xs text-zinc-500">
                <span className="text-zinc-400">Strengths:</span> {report.strengths.join(" · ")}
              </p>
            )}
          </div>
        ))}
    </section>
  );
}
