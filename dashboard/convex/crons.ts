import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every 30 min — un-stick any agent whose run died (e.g. computer slept mid-run)
crons.interval("reset stuck agents", { minutes: 30 }, internal.agentStatus.resetStuck, {});

// 02:30 UTC = 07:30 PKT — archive stale items before the agents run
crons.daily(
  "archive stale jobs and leads",
  { hourUTC: 2, minuteUTC: 30 },
  internal.cleanup.archiveStale,
  {}
);

// 03:00 UTC = 08:00 PKT
crons.daily(
  "career agent morning run",
  { hourUTC: 3, minuteUTC: 0 },
  internal.careerAgent.run,
  {}
);

// 03:30 UTC = 08:30 PKT
crons.daily(
  "lead agent morning run",
  { hourUTC: 3, minuteUTC: 30 },
  internal.leadAgent.run,
  {}
);

// 04:00 UTC = 09:00 PKT — after both agents, so the briefing sees fresh results
crons.daily(
  "daily briefing",
  { hourUTC: 4, minuteUTC: 0 },
  internal.briefingAgent.run,
  {}
);

export default crons;
