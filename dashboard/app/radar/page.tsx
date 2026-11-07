"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink, Lightbulb, Loader2, Play, RefreshCw, Search } from "lucide-react";
import { EvidenceView, Pager, Select, SolutionView, scoreColor, timeAgo } from "../ui";

const PAGE_SIZE = 10;
const STATUSES = ["New", "Exploring", "Building", "Launched", "Parked"] as const;
type ProblemStatus = (typeof STATUSES)[number];

export default function RadarPage() {
  const [tab, setTab] = useState<"problems" | "signals">("problems");
  const runAgent = useMutation(api.painAgent.runNow);

  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100 md:p-10">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Opportunity Radar</h1>
          <p className="mt-1 text-sm text-zinc-400">Real business pain, grouped into problems and scored.</p>
        </div>
        <button
          onClick={() => runAgent()}
          className="flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
        >
          <Play className="h-4 w-4" /> Run Pain Agent
        </button>
      </div>

      <div className="mt-6 flex gap-1">
        {(["problems", "signals"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm capitalize ${
              tab === t ? "bg-zinc-100 text-zinc-900" : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "problems" ? <ProblemsView /> : <SignalsView />}
    </main>
  );
}

// ---------------------------------------------------------------- Problems

function ProblemsView() {
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("");
  const [minEvidence, setMinEvidence] = useState("1");
  const [wtpOnly, setWtpOnly] = useState(false);
  const [designedOnly, setDesignedOnly] = useState(false);
  const [sort, setSort] = useState<"score" | "evidence" | "newest">("score");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);
  const [openSolution, setOpenSolution] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const data = useQuery(api.views.problemsPage, {
    status,
    source: source || undefined,
    minEvidence: Number(minEvidence) > 1 ? Number(minEvidence) : undefined,
    wtpOnly: wtpOnly || undefined,
    designedOnly: designedOnly || undefined,
    search: search || undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  const setProblemStatus = useMutation(api.solutionDesigner.setStatus);
  const designSolution = useAction(api.solutionDesigner.designSolution);

  async function design(p: Doc<"problems">, force: boolean) {
    setBusy(p._id);
    setNotice(null);
    try {
      const r: any = await designSolution({ id: p._id as Id<"problems">, force });
      if (r?.viable === false) setNotice(`Parked “${p.title}”: ${r.parkedReason}`);
      else if (r?.needsMoreEvidence) setNotice(r.message);
      else setOpenSolution(p._id);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };
  const f = data?.facets;

  return (
    <>
      {f && (
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Problems", f.total],
            ["Designed", f.designed],
            ["Would pay", f.withWtp],
            ["Exploring", f.statusCounts.Exploring ?? 0],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <p className="text-xs text-zinc-500">{label}</p>
              <p className="mt-1 text-xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Status tabs */}
      <div className="mt-6 flex flex-wrap gap-1">
        {["all", ...STATUSES].map((s) => (
          <button
            key={s}
            onClick={() => reset(setStatus)(s)}
            className={`rounded-md px-2.5 py-1 text-xs ${
              status === s ? "bg-zinc-100 text-zinc-900" : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {s === "all" ? `All (${f?.total ?? 0})` : `${s} (${f?.statusCounts[s] ?? 0})`}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <label className="flex flex-1 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1">
          <Search className="h-4 w-4 text-zinc-500" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search problems, personas, industries…"
            className="w-full min-w-40 bg-transparent text-sm outline-none placeholder:text-zinc-600"
          />
        </label>
        <Select
          label="Source"
          value={source}
          onChange={reset(setSource)}
          options={[{ value: "", label: "All" }, ...(f?.sources ?? []).map((s) => ({ value: s, label: s }))]}
        />
        <Select
          label="Evidence"
          value={minEvidence}
          onChange={reset(setMinEvidence)}
          options={["1", "2", "3", "5"].map((n) => ({ value: n, label: n === "1" ? "Any" : `${n}+` }))}
        />
        <Select
          label="Sort"
          value={sort}
          onChange={(v) => reset(setSort)(v as "score" | "evidence" | "newest")}
          options={[
            { value: "score", label: "Opportunity score" },
            { value: "evidence", label: "Most evidence" },
            { value: "newest", label: "Newest" },
          ]}
        />
        <label className="flex items-center gap-1 text-xs text-zinc-400">
          <input type="checkbox" checked={wtpOnly} onChange={(e) => reset(setWtpOnly)(e.target.checked)} />
          Would pay
        </label>
        <label className="flex items-center gap-1 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={designedOnly}
            onChange={(e) => reset(setDesignedOnly)(e.target.checked)}
          />
          Designed
        </label>
      </div>

      {notice && <p className="mt-4 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-300">{notice}</p>}

      <section className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        {!data ? (
          <div className="flex justify-center py-10 text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : data.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No problems match these filters.</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {data.items.map((p) => {
              const id = p._id as Id<"problems">;
              const ready = p.signalCount >= 2;
              const isBusy = busy === p._id;
              return (
                <li key={p._id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{p.title}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {p.persona}
                        {p.industries.length ? ` · ${p.industries.join(", ")}` : ""} · first seen {timeAgo(p.firstSeenAt)}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">{p.summary}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">{p.signalCount} evidence</span>
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">{p.sources.join(" · ")}</span>
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                          pain {p.avgIntensity.toFixed(1)}/5 · buildable {p.avgBuildability.toFixed(1)}/5
                        </span>
                        {p.wtpCount > 0 && (
                          <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-green-400">{p.wtpCount} would pay</span>
                        )}
                        {p.solution && (
                          <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-purple-400">{p.solution.name}</span>
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
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setOpenEvidence(openEvidence === p._id ? null : p._id)}
                      className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800"
                    >
                      {openEvidence === p._id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      Evidence ({p.evidence.length})
                    </button>
                    {p.solution ? (
                      <>
                        <button
                          onClick={() => setOpenSolution(openSolution === p._id ? null : p._id)}
                          className="flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-white"
                        >
                          <Lightbulb className="h-3 w-3" /> {openSolution === p._id ? "Hide solution" : "View solution"}
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
                    ) : p.status !== "Parked" ? (
                      <>
                        <button
                          onClick={() => design(p, !ready)}
                          disabled={isBusy}
                          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs disabled:opacity-50 ${
                            ready
                              ? "bg-zinc-100 font-medium text-zinc-900 hover:bg-white"
                              : "border border-dashed border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                          }`}
                        >
                          {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lightbulb className="h-3 w-3" />}
                          {isBusy ? "Designing…" : ready ? "Design solution" : `Design anyway (${p.signalCount}/2 evidence)`}
                        </button>
                      </>
                    ) : null}
                  </div>

                  {openEvidence === p._id && <EvidenceView problem={p} />}
                  {openSolution === p._id && p.solution && <SolutionView problem={p} />}
                </li>
              );
            })}
          </ul>
        )}

        {data && <Pager page={data.page} pageCount={data.pageCount} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Signals (raw posts)

function SignalsView() {
  const [status, setStatus] = useState<"pending" | "analyzed" | "noise">("analyzed");
  const { results, status: loadStatus, loadMore } = usePaginatedQuery(
    api.views.signalsPage,
    { status },
    { initialNumItems: 20 }
  );

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {(
          [
            ["analyzed", "Real pains"],
            ["noise", "Noise (filtered out)"],
            ["pending", "Queued"],
          ] as const
        ).map(([s, label]) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-md px-2.5 py-1 text-xs ${
              status === s ? "bg-zinc-100 text-zinc-900" : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="text-xs text-zinc-500">Newest first — see exactly what the Pain Agent read and how it judged it.</span>
      </div>

      <section className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        {loadStatus === "LoadingFirstPage" ? (
          <div className="flex justify-center py-10 text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {results.map((s) => (
              <li key={s._id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-sm">{s.title}</p>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200"
                  >
                    {s.source} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                {s.pain && (
                  <p className="mt-1 text-xs text-green-400">
                    → {s.pain}
                    {s.persona ? <span className="text-zinc-500"> · {s.persona}</span> : null}
                  </p>
                )}
                <p className="mt-1 text-xs text-zinc-500">{s.snippet}…</p>
                <p className="mt-1 text-xs text-zinc-600">collected {timeAgo(s.fetchedAt)}</p>
              </li>
            ))}
          </ul>
        )}

        {loadStatus === "CanLoadMore" && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => loadMore(20)}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800"
            >
              Load more
            </button>
          </div>
        )}
        {loadStatus === "LoadingMore" && (
          <div className="mt-4 flex justify-center text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
      </section>
    </>
  );
}
