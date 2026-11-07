"use client";

import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Quote } from "lucide-react";
import type { Doc } from "../convex/_generated/dataModel";

export function timeAgo(ts?: number) {
  if (!ts) return "never";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

export function scoreColor(score: number) {
  if (score >= 60) return "text-green-400";
  if (score >= 40) return "text-yellow-400";
  return "text-zinc-400";
}

export const recBadge: Record<string, string> = {
  Apply: "bg-green-500/15 text-green-400",
  Maybe: "bg-yellow-500/15 text-yellow-400",
  Skip: "bg-zinc-500/15 text-zinc-400",
};

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
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

export function Block({ title, text, copyText }: { title: string; text: string; copyText?: string }) {
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

export function ListBlock({ title, items }: { title: string; items: string[] }) {
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

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-400">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
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

export function Pager({
  page,
  pageCount,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4">
      <span className="text-xs text-zinc-500">
        {from}–{to} of {total}
      </span>
      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onChange(page - 1)}
            disabled={page === 1}
            className="rounded-md border border-zinc-700 p-1 text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {pageNumbers(page, pageCount).map((p, i) =>
            p === "…" ? (
              <span key={`g${i}`} className="px-1 text-xs text-zinc-600">
                …
              </span>
            ) : (
              <button
                key={p}
                onClick={() => onChange(p)}
                className={`min-w-7 rounded-md px-2 py-1 text-xs ${
                  p === page ? "bg-zinc-100 text-zinc-900" : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {p}
              </button>
            )
          )}
          <button
            onClick={() => onChange(page + 1)}
            disabled={page === pageCount}
            className="rounded-md border border-zinc-700 p-1 text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

export function KitView({ kit }: { kit: NonNullable<Doc<"jobs">["kit"]> }) {
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-zinc-500">
        Use your <span className="font-medium text-zinc-300">{kit.resumeVariant}</span> CV · generated{" "}
        {timeAgo(kit.generatedAt)} · review before sending
      </p>
      <Block title="Summary" text={kit.summary} />
      <Block title="Highlights" text={kit.highlights.map((h) => `- ${h}`).join("\n")} />
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

export function EvidenceView({ problem }: { problem: Doc<"problems"> }) {
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
      <ListBlock title="Willingness to pay" items={problem.wtpEvidence} />
      <ListBlock title="Current workarounds" items={problem.workarounds} />
    </div>
  );
}

export function solutionMarkdown(p: Doc<"problems">) {
  const s = p.solution!;
  const b = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  return `# ${s.name}\n\n**Problem:** ${p.title}\n**Target user:** ${s.targetUser}\n\n## Concept\n${s.concept}\n\n## MVP features\n${b(s.mvpFeatures)}\n\n## Stack\n${b(s.stack)}\n\n**Build effort:** ${s.buildEffort}\n\n## Pricing\n${s.pricing}\n\n## Why it wins\n${s.differentiation}\n\n## Where the users are\n${b(s.channels)}\n\n## Content angles\n${b(s.contentAngles)}\n\n## Validate before building\n${b(s.validationSteps)}\n\n## Risks\n${b(s.risks)}\n`;
}

export function SolutionView({ problem }: { problem: Doc<"problems"> }) {
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
        <CopyButton text={solutionMarkdown(problem)} label="Copy as doc" />
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
