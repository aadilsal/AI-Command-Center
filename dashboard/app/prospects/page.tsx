"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink, Loader2, Mail, Play, RefreshCw, Search, Send } from "lucide-react";
import { CopyButton, Pager, Select, timeAgo } from "../ui";

const PAGE_SIZE = 12;
const TABS = [
  ["Ready", "Ready to send"],
  ["Contacted", "Contacted"],
  ["Replied", "Replied"],
  ["Meeting", "Meeting"],
  ["Won", "Won"],
  ["Lost", "Lost"],
  ["NoEmail", "No email (use form)"],
  ["New", "Not researched yet"],
  ["NotAFit", "Not a fit"],
] as const;
const STATUSES = ["Ready", "NoEmail", "Contacted", "Replied", "Meeting", "Won", "Lost", "NotAFit"] as const;
type ProspectStatus = (typeof STATUSES)[number];

function gmailUrl(to: string, subject: string, body: string) {
  const p = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body });
  return `https://mail.google.com/mail/?${p.toString()}`;
}

export default function ProspectsPage() {
  const [status, setStatus] = useState<string>("Ready");
  const [source, setSource] = useState("");
  const [country, setCountry] = useState("");
  const [minFit, setMinFit] = useState("0");
  const [dueOnly, setDueOnly] = useState(false);
  const [sort, setSort] = useState<"fit" | "newest" | "lastContact">("fit");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const data = useQuery(api.views.prospectsPage, {
    status: dueOnly ? "Contacted" : status,
    source: source || undefined,
    country: country || undefined,
    minFit: Number(minFit) || undefined,
    dueOnly: dueOnly || undefined,
    search: search || undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  const runAgent = useMutation(api.prospectAgent.runNow);
  const markSent = useMutation(api.prospectCrm.markSent);
  const setProspectStatus = useMutation(api.prospectCrm.setStatus);
  const redraft = useAction(api.prospectAgent.redraft);
  const draftFollowUp = useAction(api.prospectAgent.draftFollowUp);

  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  async function runAI(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setNotice(null);
    try {
      await fn();
      setOpen(id);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
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
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Send className="h-6 w-6" /> Prospect Engine</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Small US/UK agencies, researched from their own websites. You review, click “Open in Gmail”, and send.
          </p>
        </div>
        <button onClick={() => runAgent()} className="flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800">
          <Play className="h-4 w-4" /> Find & research more
        </button>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex flex-wrap gap-1">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setDueOnly(false);
              reset(setStatus)(key);
            }}
            className={`rounded-md px-2.5 py-1 text-xs ${
              status === key && !dueOnly ? "bg-zinc-100 text-zinc-900" : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {label} ({f?.counts[key] ?? 0})
          </button>
        ))}
        <button
          onClick={() => {
            setDueOnly(true);
            setPage(1);
          }}
          className={`rounded-md px-2.5 py-1 text-xs ${
            dueOnly ? "bg-orange-400 text-zinc-900" : "border border-orange-900 text-orange-400 hover:bg-orange-950/40"
          }`}
        >
          Follow-ups due ({f?.followUpsDue ?? 0})
        </button>
      </div>

      {/* Filters */}
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <label className="flex flex-1 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1">
          <Search className="h-4 w-4 text-zinc-500" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search agency, city, services…"
            className="w-full min-w-40 bg-transparent text-sm outline-none placeholder:text-zinc-600"
          />
        </label>
        <Select label="Country" value={country} onChange={reset(setCountry)} options={[{ value: "", label: "All" }, { value: "UK", label: "UK" }, { value: "US", label: "US" }]} />
        <Select label="Source" value={source} onChange={reset(setSource)} options={[{ value: "", label: "All" }, ...(f?.sources ?? []).map((s) => ({ value: s, label: s }))]} />
        <Select label="Min fit" value={minFit} onChange={reset(setMinFit)} options={["0", "50", "60", "70", "80"].map((s) => ({ value: s, label: s === "0" ? "Any" : `${s}+` }))} />
        <Select
          label="Sort"
          value={sort}
          onChange={(v) => reset(setSort)(v as "fit" | "newest" | "lastContact")}
          options={[
            { value: "fit", label: "Best fit" },
            { value: "newest", label: "Newest" },
            { value: "lastContact", label: "Last contacted" },
          ]}
        />
      </div>

      {notice && <p className="mt-4 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-300">{notice}</p>}

      <section className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        {!data ? (
          <div className="flex justify-center py-10 text-zinc-500"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : data.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            {status === "Ready" && !dueOnly ? "No drafts ready yet — press “Find & research more” (takes ~2–4 minutes)." : "Nothing here."}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {data.items.map((p) => {
              const id = p._id as Id<"prospects">;
              const isOpen = open === p._id;
              const isBusy = busy === p._id;
              const d = p.draft;
              return (
                <li key={p._id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {p.name}
                        {p.followUpDue && <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-xs font-normal text-orange-400">follow-up due</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {p.agencyType ?? "agency"} · {[p.city, p.country].filter(Boolean).join(", ") || "—"} · {p.source} · found {timeAgo(p.foundAt)}
                        {p.lastContactAt ? ` · last emailed ${timeAgo(p.lastContactAt)}` : ""}
                      </p>
                      <a href={p.website} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100">
                        {p.domain} <ExternalLink className="h-3 w-3" />
                      </a>
                      {p.status === "NotAFit" && p.notFitReason && <p className="mt-1 text-xs text-zinc-500">Not a fit: {p.notFitReason}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {p.fitScore !== undefined && <span className="text-lg font-semibold text-green-400">{p.fitScore}</span>}
                      {p.status !== "New" && (
                        <select
                          value={p.status}
                          onChange={(e) => setProspectStatus({ id, status: e.target.value as ProspectStatus })}
                          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
                        >
                          {STATUSES.map((s) => <option key={s} value={s}>{s === "NotAFit" ? "Not a fit" : s === "NoEmail" ? "No email" : s}</option>)}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {p.status !== "New" && p.status !== "NotAFit" && (
                      <button onClick={() => setOpen(isOpen ? null : p._id)} className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800">
                        {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} {d ? "Email & research" : "Research"}
                      </button>
                    )}
                    {d && p.contactEmail && (
                      <a
                        href={gmailUrl(p.contactEmail, d.subject, d.body)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => markSent({ id })}
                        className="flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-white"
                      >
                        <Mail className="h-3 w-3" /> Open in Gmail
                      </a>
                    )}
                    {d && !p.contactEmail && (
                      <>
                        {p.contactPage && (
                          <a href={p.contactPage} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800">
                            Their contact form <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <button onClick={() => markSent({ id })} className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800">
                          Mark as sent
                        </button>
                      </>
                    )}
                    {(p.status === "Ready" || p.status === "NoEmail") && (
                      <button
                        onClick={() => runAI(p._id, () => redraft({ id }))}
                        disabled={isBusy}
                        className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} {isBusy ? "Rewriting…" : "Rewrite"}
                      </button>
                    )}
                    {p.status === "Contacted" && !d && (p.followUpsSent ?? 0) < 2 && (
                      <button
                        onClick={() => runAI(p._id, () => draftFollowUp({ id }))}
                        disabled={isBusy}
                        className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs disabled:opacity-50 ${
                          p.followUpDue ? "bg-orange-400 font-medium text-zinc-900" : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                        }`}
                      >
                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        {isBusy ? "Writing…" : `Draft follow-up ${(p.followUpsSent ?? 0) + 1}`}
                      </button>
                    )}
                    {p.status === "Contacted" && (
                      <button onClick={() => setProspectStatus({ id, status: "Replied" })} className="rounded-md border border-purple-900 px-2 py-1 text-xs text-purple-300 hover:bg-purple-950/40">
                        They replied
                      </button>
                    )}
                  </div>

                  {/* Detail */}
                  {isOpen && (
                    <div className="mt-3 space-y-3">
                      {d && (
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs text-zinc-500">
                              {d.kind === "intro" ? "First email" : `Follow-up ${d.kind === "followup1" ? 1 : 2}`} · to{" "}
                              <span className="text-zinc-300">{p.contactEmail ?? "their contact form"}</span> · written {timeAgo(d.generatedAt)}
                            </span>
                            <CopyButton text={`Subject: ${d.subject}\n\n${d.body}`} />
                          </div>
                          <p className="text-sm font-medium">{d.subject}</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">{d.body}</p>
                        </div>
                      )}
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
                          <p className="font-medium uppercase tracking-wide text-zinc-500">Why they fit</p>
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-zinc-300">
                            {(p.fitReasons ?? []).map((r, i) => <li key={i}>{r}</li>)}
                          </ul>
                          {p.hook && <p className="mt-2 text-zinc-500">Opening detail: {p.hook}</p>}
                          {p.sizeSignal && <p className="mt-1 text-zinc-500">Size: {p.sizeSignal}</p>}
                        </div>
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
                          <p className="font-medium uppercase tracking-wide text-zinc-500">What they sell</p>
                          <p className="mt-2 text-zinc-300">{(p.services ?? []).join(" · ") || "—"}</p>
                          <p className="mt-2 text-zinc-500">Emails on their site: {(p.emailsFound ?? []).join(", ") || "none"}</p>
                          {p.sourceContext && <p className="mt-1 text-zinc-500">{p.sourceContext}</p>}
                        </div>
                      </div>
                      {(p.sentEmails ?? []).length > 0 && (
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
                          <p className="font-medium uppercase tracking-wide text-zinc-500">Sent</p>
                          <ul className="mt-2 space-y-1 text-zinc-400">
                            {p.sentEmails!.map((s, i) => (
                              <li key={i}>{s.kind === "intro" ? "First email" : s.kind} · “{s.subject}” · {timeAgo(s.sentAt)}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {data && <Pager page={data.page} pageCount={data.pageCount} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />}
      </section>
    </main>
  );
}
