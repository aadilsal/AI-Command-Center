"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Download, ExternalLink, FileText, GitBranch, Loader2, Pencil, Save, X } from "lucide-react";
import { timeAgo } from "../ui";

const INCLUDE = [
  ["auto", "Auto"],
  ["always", "Always"],
  ["never", "Never"],
] as const;

export default function CvPage() {
  const data = useQuery(api.cvProjects.list);
  const files = useQuery(api.cvBuilder.recentFiles);
  const syncNow = useMutation(api.cvProjects.syncNow);
  const setInclude = useMutation(api.cvProjects.setInclude);
  const make = useAction(api.cvBuilder.make);
  const [building, setBuilding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function buildGeneral() {
    setBuilding(true);
    setNotice(null);
    try {
      const r = await make({});
      if (r.cvUrl) window.open(r.cvUrl, "_blank");
      setNotice(`Built with: ${r.projects.join(" · ")}`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }

  return (
    <main className="px-4 pt-7 pb-14 md:px-9">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 font-mono text-xs tracking-[0.14em] text-[#5eead4]">CV BUILDER · ONE PAGE · ATS-FRIENDLY</p>
            <h1 className="flex items-center gap-2 font-display text-[32px] font-semibold tracking-tight">
              <FileText className="h-7 w-7 text-[#5eead4]" /> CV Builder
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-hud-muted">
              Every application gets its own one-page CV: your real experience, skills reordered for the job, and the 3-4 most
              relevant projects from your CV and GitHub. Choose which projects can appear: <b className="text-hud-text">Auto</b>{" "}
              (when relevant), <b className="text-hud-text">Always</b> or <b className="text-hud-text">Never</b>.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => syncNow()}
              disabled={data?.status === "running"}
              className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-hud-line px-4 text-sm hover:border-[#5eead4] disabled:opacity-50"
            >
              {data?.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
              {data?.status === "running" ? "Reading GitHub…" : "Sync GitHub now"}
            </button>
            <button
              type="button"
              onClick={buildGeneral}
              disabled={building}
              className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-[#5eead4] px-4 text-sm font-semibold text-zinc-950 hover:bg-[#99f6e4] disabled:opacity-50"
            >
              {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} General CV
            </button>
          </div>
        </header>

        <p className="text-xs text-hud-dim">
          GitHub last read {data?.lastSync ? timeAgo(data.lastSync) : "never"} · refreshes every Sunday
          {data?.lastError ? ` · ${data.lastError}` : ""}
        </p>
        {notice && <p className="rounded-lg border border-hud-line bg-hud-panel p-3 text-sm text-hud-muted">{notice}</p>}

        {/* Projects */}
        <section aria-labelledby="proj-h" className="flex flex-col gap-3">
          <h2 id="proj-h" className="hud-label text-xs">
            // Projects ({data?.projects.length ?? 0})
          </h2>
          {!data ? (
            <div className="flex justify-center py-8 text-hud-dim">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : data.projects.length === 0 ? (
            <p className="rounded-2xl border border-hud-line bg-hud-panel px-5 py-6 text-sm text-hud-dim">
              No projects yet. Press <b>Sync GitHub now</b>; it adds the projects from your CV and reads your repos.
            </p>
          ) : (
            data.projects.map((p) => (
              <ProjectCard key={p._id} p={p} onInclude={(include) => setInclude({ id: p._id as Id<"cvProjects">, include })} />
            ))
          )}
        </section>

        {/* Generated files */}
        <section aria-labelledby="files-h" className="rounded-2xl border border-hud-line bg-hud-panel">
          <div className="border-b border-hud-soft px-5 py-4">
            <h2 id="files-h" className="hud-label text-xs">
              // Generated CVs and cover letters
            </h2>
          </div>
          {!files || files.length === 0 ? (
            <p className="px-5 py-6 text-sm text-hud-dim">
              Nothing yet. Use <b>Tailored CV</b> on a job in Career, or let Autopilot apply by email.
            </p>
          ) : (
            <ul className="divide-y divide-hud-soft">
              {files.map((f) => (
                <li key={f._id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <span className="hud-label w-14 shrink-0">{f.kind === "cv" ? "CV" : "Letter"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{f.filename}</span>
                    <span className="block text-xs text-hud-dim">
                      {f.job ? `${f.job.title} @ ${f.job.company} · ` : "General · "}
                      {timeAgo(f.createdAt)}
                      {f.sentTo ? ` · sent to ${f.sentTo}` : ""}
                    </span>
                  </span>
                  {f.url && (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-hud-line px-3 text-xs text-hud-muted hover:text-hud-text"
                    >
                      Open <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

type ProjectRow = {
  _id: string;
  name: string;
  context?: string;
  url?: string;
  stack: string[];
  bullets: string[];
  tags: string[];
  source: "cv" | "github";
  include: "auto" | "always" | "never";
  repoPushedAt?: number;
};

function ProjectCard({ p, onInclude }: { p: ProjectRow; onInclude: (i: "auto" | "always" | "never") => void }) {
  const update = useMutation(api.cvProjects.updateProject);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [url, setUrl] = useState(p.url ?? "");
  const [stack, setStack] = useState(p.stack.join(", "));
  const [bullets, setBullets] = useState(p.bullets.join("\n"));

  return (
    <article className={`rounded-2xl border bg-hud-panel p-5 ${p.include === "never" ? "border-hud-soft opacity-60" : "border-hud-line"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{p.name}</span>
            <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-hud-dim">
              {p.source === "cv" ? "from your CV" : "from GitHub"}
            </span>
          </p>
          <p className="mt-0.5 text-xs italic text-hud-muted">{p.stack.join(", ")}</p>
          {p.url && <p className="mt-0.5 text-xs text-hud-dim">{p.url}</p>}
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-hud-line" role="group" aria-label={`When to include ${p.name}`}>
            {INCLUDE.map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={p.include === k}
                onClick={() => onInclude(k)}
                className={`min-h-9 px-3 text-xs ${
                  p.include === k
                    ? k === "always"
                      ? "bg-[#5eead4] font-semibold text-zinc-950"
                      : k === "never"
                        ? "bg-zinc-800 text-zinc-300"
                        : "bg-zinc-100 font-medium text-zinc-900"
                    : "text-hud-muted hover:bg-white/[0.04]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label={editing ? "Cancel editing" : `Edit ${p.name}`}
            onClick={() => setEditing(!editing)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-hud-line text-hud-muted hover:text-hud-text"
          >
            {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {!editing ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[#d7dee5]">
          {p.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-hud-dim">
            Title
            <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-md border border-hud-line bg-transparent px-3 py-2 text-sm text-hud-text" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-hud-dim">
            Link shown on the CV
            <input value={url} onChange={(e) => setUrl(e.target.value)} className="rounded-md border border-hud-line bg-transparent px-3 py-2 text-sm text-hud-text" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-hud-dim">
            Stack (comma separated)
            <input value={stack} onChange={(e) => setStack(e.target.value)} className="rounded-md border border-hud-line bg-transparent px-3 py-2 text-sm text-hud-text" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-hud-dim">
            Bullets (one per line, max 4; only true facts)
            <textarea
              value={bullets}
              onChange={(e) => setBullets(e.target.value)}
              rows={5}
              className="rounded-md border border-hud-line bg-transparent px-3 py-2 text-sm leading-relaxed text-hud-text"
            />
          </label>
          <button
            type="button"
            onClick={async () => {
              await update({
                id: p._id as Id<"cvProjects">,
                name,
                url: url || undefined,
                stack: stack.split(","),
                bullets: bullets.split("\n"),
              });
              setEditing(false);
            }}
            className="inline-flex min-h-10 w-fit items-center gap-1.5 rounded-lg bg-[#5eead4] px-4 text-sm font-semibold text-zinc-950"
          >
            <Save className="h-4 w-4" /> Save
          </button>
        </div>
      )}
    </article>
  );
}
