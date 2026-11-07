// Agent schedules, mirrored from convex/crons.ts (times in PKT = UTC+5).
// Used by the home HUD to show "next run". Keep in sync if you change crons.ts.

const HOUR = 3600000;

function pktNow() {
  return new Date(Date.now() + 5 * HOUR); // shift so getUTC* reads PKT
}

function nextDailyPKT(hours: number[]): number {
  const now = pktNow();
  const sorted = [...hours].sort((a, b) => a - b);
  for (let add = 0; add < 2; add++) {
    for (const h of sorted) {
      const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + add, h, 0) - 5 * HOUR;
      if (t > Date.now()) return t;
    }
  }
  return Date.now();
}

function nextWeeklyPKT(dayOfWeek: number, hour: number, minute: number): number {
  const now = pktNow();
  for (let add = 0; add < 8; add++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + add, hour, minute));
    const t = d.getTime() - 5 * HOUR;
    if (d.getUTCDay() === dayOfWeek && t > Date.now()) return t;
  }
  return Date.now();
}

export const SCHEDULES: Record<string, { label: string; next: (lastRun?: number) => number | null }> = {
  "Career Agent": { label: "8:00 & 20:00", next: () => nextDailyPKT([8, 20]) },
  "Pain Agent": { label: "Every 6 h", next: (last) => (last ? last + 6 * HOUR : null) },
  "Briefing Agent": { label: "Daily 9:00", next: () => nextDailyPKT([9]) },
  "Coach Agent": { label: "Sun 9:30", next: () => nextWeeklyPKT(0, 9, 30) },
  "Trend Scout": { label: "Mon 9:45", next: () => nextWeeklyPKT(1, 9, 45) },
  "Prospect Agent": { label: "Daily 10:00", next: () => nextDailyPKT([10]) },
};

export function formatNext(ts: number | null) {
  if (!ts) return "—";
  const mins = Math.round((ts - Date.now()) / 60000);
  if (mins <= 0) return "due now";
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs} h`;
  return `in ${Math.floor(hrs / 24)} d`;
}

// Short, uppercase "3H AGO" style for the HUD
export function shortAgo(ts?: number) {
  if (!ts) return "NEVER";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "NOW";
  if (mins < 60) return `${mins}M AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}H AGO`;
  return `${Math.floor(hrs / 24)}D AGO`;
}
