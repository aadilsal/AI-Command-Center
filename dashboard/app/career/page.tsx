"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink, FileText, Loader2, Play, RefreshCw, Search } from "lucide-react";
import { KitView, Pager, Select, recBadge, timeAgo } from "../ui";

const PAGE_SIZE = 15;
const STATUSES = ["Saved", "Applied", "Interview", "Rejected", "Offer"] as const;
type JobStatus = (typeof STATUSES)[number];

export default function CareerPage() {
  const [status, setStatus] = useState("active");
  const [recommendation, setRecommendation] = useState("");
  const [source, setSource] = useState("");
  const [minScore, setMinScore] = useState("0");
  const [sort, setSort] = useState<"score" | "newest">("score");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce search typing
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const data = useQuery(api.views.jobsPage, {
    status,
    recommendation: recommendation || undefined,
    source: source || undefined,
    minScore: Number(minScore) || undefined,
    search: search || undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  const setJobStatus = useMutation(api.jobCrm.setStatus);
  const markApplied = useMutation(api.jobCrm.markApplied);
  const runAgent = useMutation(api.careerAgent.runNow);
  const generateKit = useAction(api.applicationKit.generateKit);

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  async function makeKit(id: string) {
    setBusy(id);
    setError(null);
    try {
      await generateKit({ id: id as Id<"jobs"> });
      setOpen(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const f = data?.facets;

  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100 md:p-10">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Career Agent</h1>
          <p className="mt-1 text-sm text-zinc-400">Every job the agent found, scored against your profile.</p>
        </div>
        <button
          onClick={() => runAgent()}
          className="flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
        >
          <Play className="h-4 w-4" /> Run now
        </button>
      </div>

      {/* Stats */}
      {f && (
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-6">
          {[
            ["Active", f.activeCount],
            ["Saved", f.statusCounts.Saved ?? 0],
            ["Applied", f.statusCounts.Applied ?? 0],
            ["Interview", f.statusCounts.Interview ?? 0],
            ["Kits", f.kits],
            ["Avg score", `${f.avgScore}%`],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <p className="text-xs text-zinc-500">{label}</p>
              <p className="mt-1 text-xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <label className="flex flex-1 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1">
          <Search className="h-4 w-4 text-zinc-500" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search title, company, location…"
            className="w-full min-w-40 bg-transparent text-sm outline-none placeholder:text-zinc-600"
          />
        </label>
        <Select
          label="Status"
          value={status}
          onChange={resetPage(setStatus)}
          options={[
            { value: "active", label: "All active" },
            ...STATUSES.map((s) => ({ value: s, label: `${s} (${f?.statusCounts[s] ?? 0})` })),
            { value: "Archived", label: `Archived (${f?.statusCounts.Archived ?? 0})` },
            { value: "all", label: "Everything" },
          ]}
        />
        <Select
          label="Verdict"
          value={recommendation}
          onChange={resetPage(setRecommendation)}
          options={[
            { value: "", label: "Any" },
            { value: "Apply", label: "Apply" },
            { value: "Maybe", label: "Maybe" },
            { value: "Skip", label: "Skip" },
          ]}
        />
        <Select
          label="Source"
          value={source}
          onChange={resetPage(setSource)}
          options={[{ value: "", label: "All" }, ...(f?.sources ?? []).map((s) => ({ value: s, label: s }))]}
        />
        <Select
          label="Min score"
          value={minScore}
          onChange={resetPage(setMinScore)}
          options={["0", "50", "60", "70", "80"].map((s) => ({ value: s, label: s === "0" ? "Any" : `${s}+` }))}
        />
        <Select
          label="Sort"
          value={sort}
          onChange={(v) => resetPage(setSort)(v as "score" | "newest")}
          options={[
            { value: "score", label: "Best match" },
            { value: "newest", label: "Newest" },
          ]}
        />
      </div>

      {error && <p className="mt-4 rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}

      {/* Results */}
      <section className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        {!data ? (
          <div className="flex justify-center py-10 text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : data.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No jobs match these filters.</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {data.items.map((j) => {
              const id = j._id as Id<"jobs">;
              const isOpen = open === j._id;
              return (
                <li key={j._id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{j.title}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {j.company} · {j.location ?? "—"} · {j.source} · found {timeAgo(j.foundAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {j.recommendation && (
                        <span className={`rounded px-1.5 py-0.5 text-xs ${recBadge[j.recommendation]}`}>
                          {j.recommendation}
                        </span>
                      )}
                      <span className="text-sm font-semibold text-green-400">{j.matchScore}%</span>
                      {j.status === "Archived" ? (
                        <span className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-500">Archived</span>
                      ) : (
                        <select
                          value={j.status}
                          onChange={(e) => setJobStatus({ id, status: e.target.value as JobStatus })}
                          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setOpen(isOpen ? null : j._id)}
                      className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800"
                    >
                      {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Details
                    </button>
                    <button
                      onClick={() => makeKit(j._id)}
                      disabled={busy === j._id}
                      className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
                    >
                      {busy === j._id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : j.kit ? (
                        <RefreshCw className="h-3 w-3" />
                      ) : (
                        <FileText className="h-3 w-3" />
                      )}
                      {busy === j._id ? "Writing…" : j.kit ? "Regenerate kit" : "Prepare application"}
                    </button>
                    <a
                      href={j.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => markApplied({ id })}
                      className="flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-white"
                    >
                      Apply <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  {isOpen && (
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Why it fits</p>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-200">
                            {(j.reasons ?? []).map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Missing</p>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-200">
                            {(j.missing ?? []).map((m, i) => (
                              <li key={i}>{m}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      {j.kit ? (
                        <KitView kit={j.kit} />
                      ) : (
                        <p className="text-xs text-zinc-500">No application kit yet — press “Prepare application”.</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {data && (
          <Pager page={data.page} pageCount={data.pageCount} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
        )}
      </section>
    </main>
  );
}
