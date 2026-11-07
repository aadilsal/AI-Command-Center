"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConvexConnectionState, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Bot, Briefcase, GraduationCap, LayoutGrid, Mail, Radar, TrendingUp } from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  color?: string;
};

export default function Sidebar() {
  const pathname = usePathname();
  const data = useQuery(api.home.overview);
  const connection = useConvexConnectionState();
  const online = connection.isWebSocketConnected;

  const items: NavItem[] = [
    { href: "/", label: "Overview", icon: LayoutGrid },
    { href: "/career", label: "Career", icon: Briefcase, count: data?.career.open, color: "text-[#5eead4]" },
    { href: "/radar", label: "Radar", icon: Radar, count: data?.radar.readyToDesign, color: "text-[#fbbf24]" },
    { href: "/prospects", label: "Prospects", icon: Mail, count: data?.prospects.ready, color: "text-[#a78bfa]" },
    { href: "/trends", label: "Trend Scout", icon: TrendingUp },
    { href: "/coach", label: "Coach", icon: GraduationCap },
    { href: "/agents", label: "AI Workers", icon: Bot },
  ];

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav
      aria-label="Main"
      className="sticky top-0 z-20 flex shrink-0 items-center gap-2 overflow-x-auto border-b border-hud-soft bg-[#05080c]/90 px-3 py-2 backdrop-blur md:h-screen md:w-[220px] md:flex-col md:items-stretch md:gap-0.5 md:overflow-visible md:border-r md:border-b-0 md:px-3.5 md:py-6"
    >
      {/* Logo */}
      <Link href="/" className="mr-2 flex shrink-0 items-center gap-2.5 px-2 md:mr-0 md:mb-7">
        <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#5eead4" strokeWidth="1.6">
          <path d="M14 2l11 6v12l-11 6-11-6V8z" />
          <path d="M14 9l5 3v5l-5 3-5-3v-5z" />
        </svg>
        <span className="hidden md:block">
          <span className="block font-display text-[15px] font-bold tracking-[0.04em]">COMMAND</span>
          <span className="block font-mono text-[11px] tracking-[0.12em] text-hud-dim">CENTER · v2</span>
        </span>
      </Link>

      {items.map(({ href, label, icon: Icon, count, color }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-3 rounded-lg border px-3 text-sm transition-colors ${
              active
                ? "border-[#5eead4]/25 bg-[#5eead4]/[0.08] font-medium text-hud-text"
                : "border-transparent text-hud-muted hover:bg-white/[0.03] hover:text-hud-text"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" />
            <span className="whitespace-nowrap">{label}</span>
            {count ? <span className={`ml-auto font-mono text-xs ${color}`}>{count}</span> : null}
          </Link>
        );
      })}

      {/* System status */}
      <div className="mt-auto hidden flex-col gap-1.5 rounded-lg border border-hud-soft p-3 font-mono text-[11px] tracking-[0.06em] text-hud-dim md:flex">
        <span className="flex justify-between">
          DB
          <span className={online ? "text-hud-accent" : "text-red-400"}>{online ? "CONVEX · LIVE" : "OFFLINE"}</span>
        </span>
        <span className="flex justify-between">
          RUNS / 24H<span className="text-hud-text">{data?.runs24h ?? "–"}</span>
        </span>
        <span className="flex justify-between">
          ERRORS
          <span className={data?.agentErrors ? "text-red-400" : "text-hud-accent"}>{data?.agentErrors ?? "–"}</span>
        </span>
      </div>
    </nav>
  );
}
