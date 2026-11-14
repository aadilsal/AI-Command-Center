"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ChevronDown, ChevronUp, ExternalLink, Inbox, Loader2, Play, Send, UserCheck } from "lucide-react";
import { timeAgo } from "../ui";

const TABS = [
  ["new", "Needs an answer"],
  ["handled", "Answered / closed"],
  ["ignored", "Handled by you"],
  ["", "All"],
] as const;

const CATEGORY: Record<string, { label: string; cls: string }> = {
  interested: { label: "Interested", cls: "bg-[#5eead4]/15 text-[#5eead4]" },
  meeting: { label: "Meeting", cls: "bg-[#5eead4]/15 text-[#5eead4]" },
  question: { label: "Question", cls: "bg-sky-400/15 text-sky-300" },
  pricing: { label: "Pricing", cls: "bg-[#fbbf24]/15 text-[#fbbf24]" },
  not_interested: { label: "Not interested", cls: "bg-zinc-500/15 text-zinc-400" },
  unsubscribe: { label: "Unsubscribe", cls: "bg-zinc-500/15 text-zinc-400" },
  out_of_office: { label: "Out of office", cls: "bg-zinc-500/15 text-zinc-400" },
  bounce: { label: "Bounced", cls: "bg-red-500/15 text-red-300" },
  other: { label: "Other", cls: "bg-fuchsia-400/15 text-fuchsia-300" },
};

export default function RepliesPage() {
  const [tab, setTab] = useState<string>("new");
  const gmail = useQuery(api.gmail.status);
  const runNow = useMutation(api.replies.runNow);
  const { results, status, loadMore } = usePaginatedQuery(
    api.replies.page,
    { filter: tab || undefined },
    { initialNumItems: 15 }
  );

  return (
    <main className="px-4 pt-7 pb-14 md:px-9">
      <div className="mx-auto flex max-w-[1000px] flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 font-mono text-xs tracking-[0.14em] text-[#e879f9]">REPLY AGENT · CHECKS GMAIL EVERY 30 MIN</p>
            <h1 className="flex items-center gap-2 font-display text-[32px] font-semibold tracking-tight">
              <Inbox className="h-7 w-7 text-[#e879f9]" /> Replies
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-hud-muted">
              Answers from agencies you emailed. Each one is sorted, the prospect&apos;s status updates (so follow-ups stop), and a
              reply is drafted for you. Edit it if you like, then send. Pricing questions always wait for you.
            </p>
          </div>
          <button
            type="button"
            onClick={() => runNow()}
            disabled={gmail?.status !== "connected"}
            className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-hud-line px-4 text-sm hover:border-[#e879f9] disabled:opacity-40"
          >
            <Play className="h-4 w-4" /> Check inbox now
          </button>
        </header>

        {gmail && gmail.status !== "connected" && (
          <p className="rounded-xl border border-red-500/40 bg-red-500/[0.06] p-4 text-sm">
            {gmail.status === "error" ? "Gmail needs you to sign in again. " : "Gmail isn't connected yet. "}
            Run <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs">node scripts/gmail-login.mjs</code> in the
            dashboard folder.
          </p>
        )}

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter replies">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
              className={`min-h-9 rounded-full px-3 text-xs ${
                tab === key ? "bg-zinc-100 font-medium text-zinc-900" : "border border-hud-line text-hud-muted hover:text-hud-text"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="flex flex-col gap-3">
          {status === "LoadingFirstPage" ? (
            <div className="flex justify-center py-10 text-hud-dim">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : results.length === 0 ? (
            <p className="rounded-2xl border border-hud-line bg-hud-panel px-5 py-8 text-center text-sm text-hud-dim">
              {tab === "new" ? "No replies waiting. When an agency answers, it shows up here." : "Nothing here yet."}
            </p>
          ) : (
            results.map((m) => <ReplyCard key={m._id} m={m} />)
          )}
          {status === "CanLoadMore" && (
            <button
              type="button"
              onClick={() => loadMore(15)}
              className="mx-auto min-h-9 rounded-lg border border-hud-line px-4 text-xs text-hud-muted hover:text-hud-text"
            >
              Load more
            </button>
          )}
        </section>
      </div>
    </main>
  );
}

type Reply = {
  _id: string;
  threadId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  body: string;
  receivedAt: number;
  category: string;
  summary: string;
  status: "new" | "handled" | "ignored";
  replyDraft?: { subject: string; body: string };
  sentReplyAt?: number;
  prospect: { name: string; website: string; status: string } | null;
  action: { _id: string; status: string; result?: string } | null;
};

function ReplyCard({ m }: { m: Reply }) {
  const [showOriginal, setShowOriginal] = useState(m.status === "new");
  const [subject, setSubject] = useState(m.replyDraft?.subject ?? "");
  const [body, setBody] = useState(m.replyDraft?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const approveSend = useMutation(api.replies.approveSend);
  const markHandled = useMutation(api.replies.markHandled);
  const cat = CATEGORY[m.category] ?? CATEGORY.other;
  const sending = m.action && (m.action.status === "queued" || m.action.status === "running");

  async function send() {
    setBusy(true);
    setNotice(null);
    try {
      await approveSend({ id: m._id as Id<"inboundEmails">, subject, body });
      setNotice("Queued — it sends within a minute.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`rounded-2xl border bg-hud-panel p-5 ${m.status === "new" ? "border-[#e879f9]/40" : "border-hud-line"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${cat.cls}`}>{cat.label}</span>
            <span className="font-medium">{m.fromName}</span>
            <span className="text-xs text-hud-dim">{m.fromEmail}</span>
          </p>
          <p className="mt-1 text-sm text-hud-muted">{m.summary}</p>
          <p className="mt-1 text-xs text-hud-dim">
            {m.prospect ? `${m.prospect.name} · now “${m.prospect.status}” · ` : ""}
            {timeAgo(m.receivedAt)}
            {m.sentReplyAt ? ` · you answered ${timeAgo(m.sentReplyAt)}` : ""}
          </p>
        </div>
        <a
          href={`https://mail.google.com/mail/u/0/#all/${m.threadId}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-hud-line px-3 text-xs text-hud-muted hover:text-hud-text"
        >
          Open in Gmail <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <button
        type="button"
        onClick={() => setShowOriginal(!showOriginal)}
        className="mt-3 inline-flex items-center gap-1 text-xs text-hud-muted hover:text-hud-text"
        aria-expanded={showOriginal}
      >
        {showOriginal ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} Their message
      </button>
      {showOriginal && (
        <div className="mt-2 rounded-lg border border-hud-soft bg-black/30 p-3">
          <p className="text-xs text-hud-dim">{m.subject}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-[#d7dee5]">{m.body || "(empty)"}</p>
        </div>
      )}

      {m.status === "new" && m.replyDraft && (
        <div className="mt-4 flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-hud-dim">
            Subject
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="rounded-md border border-hud-line bg-transparent px-3 py-2 text-sm text-hud-text"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-hud-dim">
            Our answer (sign-off with TechVersa and your postal address is added when it sends)
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              className="rounded-md border border-hud-line bg-transparent px-3 py-2 text-sm leading-relaxed text-hud-text"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={send}
              disabled={busy || !!sending}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#e879f9] px-4 text-sm font-semibold text-zinc-950 hover:bg-[#f0abfc] disabled:opacity-50"
            >
              {busy || sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? "Sending…" : "Send answer"}
            </button>
            <button
              type="button"
              onClick={() => markHandled({ id: m._id as Id<"inboundEmails"> })}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-hud-line px-4 text-sm text-hud-muted hover:text-hud-text"
            >
              <UserCheck className="h-4 w-4" /> I&apos;ll handle it myself
            </button>
            {m.action?.status === "pending" && <span className="text-xs text-[#fb923c]">Waiting for your approval</span>}
            {m.action?.status === "failed" && <span className="text-xs text-red-400">Last try failed: {m.action.result}</span>}
          </div>
          {notice && <p className="text-xs text-hud-muted">{notice}</p>}
        </div>
      )}
    </article>
  );
}
