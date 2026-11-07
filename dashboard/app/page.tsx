"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import {
  ArrowUpRight,
  Briefcase,
  GraduationCap,
  Lightbulb,
  Loader2,
  Mail,
  Play,
  Radar,
  RefreshCw,
  Settings2,
  TrendingUp,
} from "lucide-react";
import { SCHEDULES, formatNext, shortAgo } from "./schedules";

// Each agent's colour on the HUD
const C = {
  career: "#5eead4",
  radar: "#fbbf24",
  prospects: "#a78bfa",
  trends: "#38bdf8",
  coach: "#f472b6",
  designer: "#93a1ad",
};

const runColor: Record<string, string> = {
  success: "bg-[#5eead4]",
  note: "bg-[#64748b]",
  error: "bg-[#f87171]",
  interrupted: "bg-[#fbbf24]",
};

const kindStyle: Record<string, { color: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  job: { color: C.career, icon: Briefcase, label: "Career" },
  followup: { color: C.coach, icon: Briefcase, label: "Follow up" },
  opportunity: { color: C.radar, icon: Radar, label: "Radar" },
  lead: { color: C.prospects, icon: Mail, label: "Lead" },
  system: { color: C.designer, icon: Settings2, label: "System" },
};

type Overview = NonNullable<ReturnType<typeof useOverview>>;
function useOverview() {
  return useQuery(api.home.overview);
}

// ---------- Small pieces ----------

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-hud-line bg-hud-panel ${className}`}>{children}</section>;
}

function Dot({ worker }: { worker?: Overview["workers"][number] }) {
  if (!worker) return <span className="hud-dot hud-dot-off" />;
  if (worker.status === "running") return <span className="hud-dot hud-dot-run" />;
  if (worker.lastError) return <span className="hud-dot hud-dot-err" />;
  return <span className="hud-dot hud-dot-live" />;
}

function RunIcon({ running, onRun, label }: { running: boolean; onRun: () => Promise<unknown>; label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={busy || running}
      onClick={async () => {
        setBusy(true);
        try {
          await onRun();
        } finally {
          setBusy(false);
        }
      }}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-hud-line text-hud-muted transition-colors hover:border-hud-accent hover:text-hud-accent disabled:opacity-40"
    >
      {busy || running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
    </button>
  );
}

function AgentTile({
  index,
  name,
  color,
  href,
  worker,
  when,
  run,
  children,
}: {
  index: string;
  name: string;
  color: string;
  href: string;
  worker?: Overview["workers"][number];
  when: string;
  run?: { running: boolean; onRun: () => Promise<unknown> };
  children: React.ReactNode;
}) {
  return (
    <div
      className="group flex flex-col gap-3 rounded-xl border border-hud-line bg-hud-panel p-[18px] transition-colors hover:border-[color:var(--tile)]"
      style={{ borderTop: `2px solid ${color}`, ["--tile" as string]: color }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="hud-label">
          {index} · {name}
        </span>
        <span className="flex items-center gap-2">
          <span className="hud-label flex items-center gap-1.5">
            <Dot worker={worker} />
            {when}
          </span>
          {run && <RunIcon running={run.running} onRun={run.onRun} label={`Run ${name.toLowerCase()} now`} />}
        </span>
      </div>
      {children}
      <Link
        href={href}
        className="mt-auto inline-flex items-center gap-1 self-start text-[13px] text-hud-muted no-underline hover:text-hud-text"
      >
        Open <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function Metric({ value, unit }: { value: React.ReactNode; unit: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="font-display text-[34px] font-semibold leading-none">{value}</span>
      <span className="text-sm text-hud-dim">{unit}</span>
    </span>
  );
}

// ---------- Page ----------

export default function Home() {
  const data = useOverview();
  const runCareer = useMutation(api.careerAgent.runNow);
  const runPain = useMutation(api.painAgent.runNow);
  const runProspects = useMutation(api.prospectAgent.runNow);
  const runTrends = useMutation(api.trendAgent.runNow);
  const runCoach = useMutation(api.coachAgent.runNow);
  const runBriefing = useMutation(api.briefingAgent.runNow);

  // Re-render every 30s so "3H AGO" / clock stay fresh
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  if (data === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center text-hud-dim">
        <Loader2 className="h-6 w-6 animate-spin" />
      </main>
    );
  }

  const worker = (name: string) => data.workers.find((w) => w.name === name);
  const running = (name: string) => worker(name)?.status === "running";
  const when = (name: string) => {
    const w = worker(name);
    return w?.status === "running" ? "RUNNING" : shortAgo(w?.lastRun);
  };

  const clock = new Date(now).toLocaleString("en-GB", {
    timeZone: "Asia/Karachi",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const hour = Number(new Date(now).toLocaleString("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", hour12: false }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const systemLine = data.agentErrors
    ? `${data.agentErrors} WORKER${data.agentErrors > 1 ? "S" : ""} NEED ATTENTION`
    : "ALL SYSTEMS NOMINAL";

  const maxFound = Math.max(1, ...data.career.foundPerDay);
  const prospectPct = data.prospects.total ? Math.round((data.prospects.ready / data.prospects.total) * 100) : 0;
  const sourceLine = Object.entries(data.prospects.sources)
    .map(([s, n]) => `${s.replace("OpenStreetMap", "OSM").replace("HN Who is hiring", "HN")} ${n}`)
    .join(" · ");

  // Action queue: the briefing's prioritised list, or top jobs if there's no briefing yet
  const queue =
    data.briefing?.actions.map((a) => ({
      title: a.title,
      sub: `${(kindStyle[a.kind] ?? kindStyle.system).label} · ${a.why}`,
      kind: a.kind,
      href: a.url?.startsWith("#problem-") ? "/radar" : (a.url ?? null),
      external: !!a.url && !a.url.startsWith("#"),
      badge: null as number | null,
    })) ??
    data.career.topJobs.map((j) => ({
      title: j.title,
      sub: `Career · ${j.company}${j.hasKit ? " · kit ready" : ""}`,
      kind: "job",
      href: "/career",
      external: false,
      badge: j.matchScore,
    }));

  return (
    <main className="px-4 pt-7 pb-14 md:px-9">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6">
        {/* ---------- Header ---------- */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className={`mb-1 font-mono text-xs tracking-[0.14em] ${data.agentErrors ? "text-red-400" : "text-hud-accent"}`}>
              {clock.toUpperCase()} PKT · {systemLine}
            </p>
            <h1 className="font-display text-[34px] font-semibold tracking-tight">{greeting}, Aadil</h1>
          </div>
          <BriefingButton running={running("Briefing Agent")} onRun={() => runBriefing()} />
        </header>

        {/* ---------- Briefing ---------- */}
        <Panel className="grid overflow-hidden md:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
          <div className="border-hud-soft p-7 md:border-r">
            <h2 className="hud-label mb-3">
              // Morning briefing{data.briefing ? ` · ${shortAgo(data.briefing.createdAt)}` : ""}
            </h2>
            <p className="text-[19px] leading-relaxed text-[#d7dee5]">
              {data.briefing?.headline ?? "No briefing yet. Press Refresh briefing to generate one."}
            </p>
          </div>
          <div className="grid grid-cols-2 content-center gap-x-5 gap-y-4 border-t border-hud-soft p-6 md:border-t-0">
            <Stat label="Open jobs" value={data.career.open} color={C.career} />
            <Stat label="Problems" value={data.radar.active} color={C.radar} />
            <Stat label="Prospects" value={data.prospects.total} color={C.prospects} />
            <Stat label="Runs / 24h" value={data.runs24h} />
          </div>
        </Panel>

        <div className="grid items-start gap-5 lg:grid-cols-3">
          {/* ---------- Action queue ---------- */}
          <Panel>
            <div className="flex items-center justify-between border-b border-hud-soft px-5 py-4">
              <h2 className="font-display text-lg font-semibold">Action queue</h2>
              <span className="font-mono text-xs text-hud-accent">{String(queue.length).padStart(2, "0")} PENDING</span>
            </div>
            {queue.length === 0 ? (
              <p className="px-5 py-6 text-sm text-hud-dim">Nothing waiting. You&apos;re caught up.</p>
            ) : (
              <ul className="p-1.5">
                {queue.map((q, i) => {
                  const style = kindStyle[q.kind] ?? kindStyle.system;
                  const Icon = style.icon;
                  const inner = (
                    <>
                      <span
                        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border font-mono text-[13px]"
                        style={{ borderColor: `${style.color}66`, color: style.color }}
                      >
                        {q.badge ?? <Icon className="h-[18px] w-[18px]" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{q.title}</span>
                        <span className="block truncate text-[13px] text-hud-dim">{q.sub}</span>
                      </span>
                      {q.external && <ArrowUpRight className="h-4 w-4 shrink-0 text-hud-dim" />}
                    </>
                  );
                  const cls =
                    "flex items-center gap-3 rounded-lg px-3.5 py-3 text-hud-text no-underline transition-colors hover:bg-white/[0.03]";
                  return (
                    <li key={i}>
                      {q.href ? (
                        q.external ? (
                          <a href={q.href} target="_blank" rel="noreferrer" className={cls}>
                            {inner}
                          </a>
                        ) : (
                          <Link href={q.href} className={cls}>
                            {inner}
                          </Link>
                        )
                      ) : (
                        <div className={cls}>{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {/* ---------- Agent tiles ---------- */}
          <section aria-labelledby="agents-h" className="flex flex-col gap-3.5 lg:col-span-2">
            <h2 id="agents-h" className="hud-label text-xs">
              // Agents
            </h2>
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
              <AgentTile
                index="01"
                name="Career"
                color={C.career}
                href="/career"
                worker={worker("Career Agent")}
                when={when("Career Agent")}
                run={{ running: running("Career Agent"), onRun: () => runCareer() }}
              >
                <Metric value={data.career.open} unit="open matches" />
                <span className="flex h-7 items-end gap-1" aria-hidden="true">
                  {data.career.foundPerDay.map((n, i) => (
                    <span
                      key={i}
                      className="flex-1 rounded-[2px]"
                      style={{
                        height: `${Math.max(8, (n / maxFound) * 100)}%`,
                        background: i >= 5 ? C.career : "#134e4a",
                      }}
                    />
                  ))}
                </span>
                <span className="truncate text-[13px] text-hud-muted">
                  {data.career.topJobs[0]
                    ? `Top: ${data.career.topJobs[0].title} · ${data.career.topJobs[0].matchScore}`
                    : `${data.career.applied} applied · ${data.career.interview} interviewing`}
                </span>
              </AgentTile>

              <AgentTile
                index="02"
                name="Radar"
                color={C.radar}
                href="/radar"
                worker={worker("Pain Agent")}
                when={when("Pain Agent")}
                run={{ running: running("Pain Agent"), onRun: () => runPain() }}
              >
                <Metric value={data.radar.active} unit="problems tracked" />
                <span className="flex flex-wrap gap-1.5">
                  <Chip color={C.radar}>{data.radar.withSolution} solved</Chip>
                  <Chip>{data.radar.readyToDesign} ready</Chip>
                  <Chip>{data.radar.pendingSignals} signals</Chip>
                </span>
                <span className="truncate text-[13px] text-hud-muted">
                  {data.radar.top ? `Top: ${data.radar.top.title} · ${data.radar.top.score}` : "No problems yet"}
                </span>
              </AgentTile>

              <AgentTile
                index="03"
                name="Prospects"
                color={C.prospects}
                href="/prospects"
                worker={worker("Prospect Agent")}
                when={when("Prospect Agent")}
                run={{ running: running("Prospect Agent"), onRun: () => runProspects() }}
              >
                <Metric value={data.prospects.ready} unit={`ready of ${data.prospects.total}`} />
                <span className="block h-1.5 overflow-hidden rounded-full bg-hud-line" aria-hidden="true">
                  <span className="block h-full" style={{ width: `${prospectPct}%`, background: C.prospects }} />
                </span>
                <span className="truncate text-[13px] text-hud-muted">
                  {sourceLine || "No sources yet"} · sent {data.prospects.contacted}
                  {data.prospects.replied ? ` · replied ${data.prospects.replied}` : ""}
                </span>
              </AgentTile>

              <AgentTile
                index="04"
                name="Trend Scout"
                color={C.trends}
                href="/trends"
                worker={worker("Trend Scout")}
                when={when("Trend Scout")}
                run={{ running: running("Trend Scout"), onRun: () => runTrends() }}
              >
                {data.trend ? (
                  <>
                    <span className="flex flex-wrap gap-1.5">
                      {data.trend.trends.map((t) => (
                        <span key={t} className="rounded-full border border-[#38bdf8]/35 px-2.5 py-1 text-xs text-[#7dd3fc]">
                          {t}
                        </span>
                      ))}
                    </span>
                    {data.trend.idea && (
                      <span className="flex gap-1.5 text-[13px] text-hud-muted">
                        <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="line-clamp-2">Idea: {data.trend.idea}</span>
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-[13px] text-hud-dim">No report yet. Runs Mondays.</span>
                )}
              </AgentTile>

              <AgentTile
                index="05"
                name="Coach"
                color={C.coach}
                href="/coach"
                worker={worker("Coach Agent")}
                when={when("Coach Agent")}
                run={{ running: running("Coach Agent"), onRun: () => runCoach() }}
              >
                {data.coach ? (
                  <>
                    <span className="flex gap-2 font-display text-lg font-semibold leading-snug">
                      <GraduationCap className="mt-1 h-4 w-4 shrink-0" style={{ color: C.coach }} />
                      <span className="line-clamp-3">{data.coach.focus}</span>
                    </span>
                    <span className="line-clamp-2 text-[13px] text-hud-muted">{data.coach.headline}</span>
                  </>
                ) : (
                  <span className="text-[13px] text-hud-dim">No report yet. Runs Sundays.</span>
                )}
              </AgentTile>

              <AgentTile index="06" name="Solution Designer" color={C.designer} href="/radar" when="ON DEMAND">
                <Metric value={data.designer.designsThisWeek} unit="designs this week" />
                <span className="flex gap-1.5 text-[13px] text-hud-muted">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {data.designer.latest ? `Latest: ${data.designer.latest.name}` : "No designs yet"}
                  </span>
                </span>
                <span className="text-[13px] text-hud-dim">{data.designer.parked} parked by viability gate</span>
              </AgentTile>
            </div>
          </section>
        </div>

        {/* ---------- Worker telemetry ---------- */}
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hud-soft px-5 py-4">
            <h2 className="hud-label text-xs">// Worker telemetry</h2>
            <Link href="/agents" className="text-sm text-hud-accent no-underline hover:text-[#99f6e4]">
              Full run history
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="text-left">
                  {["Worker", "Status", "Last run", "Next", "Last 7 runs"].map((h) => (
                    <th key={h} scope="col" className="hud-label px-5 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.workers.map((w) => {
                  const schedule = SCHEDULES[w.name];
                  const status = w.status === "running" ? "RUNNING" : w.lastError ? "ERROR" : "IDLE";
                  const statusCls =
                    status === "RUNNING" ? "text-[#fbbf24]" : status === "ERROR" ? "text-red-400" : "text-hud-accent";
                  const blanks = Math.max(0, 7 - w.lastRuns.length);
                  return (
                    <tr key={w._id} className="border-t border-hud-soft">
                      <td className="px-5 py-3">{w.name}</td>
                      <td className={`px-5 py-3 font-mono text-xs ${statusCls}`} title={w.lastError ?? undefined}>
                        {status}
                      </td>
                      <td className="px-5 py-3 text-hud-muted">{shortAgo(w.lastRun).toLowerCase()}</td>
                      <td className="px-5 py-3 text-hud-muted">
                        {schedule ? `${formatNext(schedule.next(w.lastRun))} · ${schedule.label}` : "manual"}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className="inline-flex gap-[3px]"
                          aria-label={`${w.lastRuns.filter((r) => r === "success").length} of ${w.lastRuns.length} recent runs succeeded`}
                        >
                          {Array.from({ length: blanks }).map((_, i) => (
                            <span key={`b${i}`} className="h-3.5 w-2.5 bg-hud-line" />
                          ))}
                          {w.lastRuns.map((r, i) => (
                            <span key={i} title={r} className={`h-3.5 w-2.5 ${runColor[r] ?? "bg-hud-line"}`} />
                          ))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </main>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <p className="hud-label">{label}</p>
      <p className="mt-0.5 font-display text-[30px] font-semibold" style={color ? { color } : undefined}>
        {value}
      </p>
    </div>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="rounded px-2 py-0.5 font-mono text-[11px] uppercase"
      style={color ? { background: `${color}1a`, color } : { background: "rgba(255,255,255,0.05)", color: "#93a1ad" }}
    >
      {children}
    </span>
  );
}

function BriefingButton({ running, onRun }: { running: boolean; onRun: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy || running}
      onClick={async () => {
        setBusy(true);
        try {
          await onRun();
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-hud-accent bg-[#5eead4]/10 px-[18px] font-semibold text-hud-accent transition-colors hover:bg-[#5eead4]/20 disabled:opacity-50"
    >
      {busy || running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      {running ? "Briefing…" : "Refresh briefing"}
    </button>
  );
}
