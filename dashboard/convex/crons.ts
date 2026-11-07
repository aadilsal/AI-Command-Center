import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every 30 min — un-stick any agent whose run died (e.g. computer slept mid-run)
crons.interval("reset stuck agents", { minutes: 30 }, internal.agentStatus.resetStuck, {});

// Every 6 hours — collect pain signals and analyze the backlog
crons.interval("pain agent", { hours: 6 }, internal.painAgent.run, {});

// 02:30 UTC = 07:30 PKT — archive stale items before the agents run
crons.daily(
  "archive stale jobs and leads",
  { hourUTC: 2, minuteUTC: 30 },
  internal.cleanup.archiveStale,
  {}
);

// Job hunt twice a day
// 03:00 UTC = 08:00 PKT
crons.daily("career agent morning run", { hourUTC: 3, minuteUTC: 0 }, internal.careerAgent.run, {});
// 15:00 UTC = 20:00 PKT
crons.daily("career agent evening run", { hourUTC: 15, minuteUTC: 0 }, internal.careerAgent.run, {});

// 04:00 UTC = 09:00 PKT — daily briefing (sees both job runs)
crons.daily("daily briefing", { hourUTC: 4, minuteUTC: 0 }, internal.briefingAgent.run, {});

// Sundays 04:30 UTC = 09:30 PKT — weekly Coach report
crons.weekly("coach agent", { dayOfWeek: "sunday", hourUTC: 4, minuteUTC: 30 }, internal.coachAgent.run, {});

// Mondays 04:45 UTC = 09:45 PKT — weekly Trend Scout
crons.weekly("trend scout", { dayOfWeek: "monday", hourUTC: 4, minuteUTC: 45 }, internal.trendAgent.run, {});

// 05:00 UTC = 10:00 PKT — find + research agencies, draft emails
crons.daily("prospect agent", { hourUTC: 5, minuteUTC: 0 }, internal.prospectAgent.run, {});

export default crons;
