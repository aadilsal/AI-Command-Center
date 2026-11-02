import { internalMutation } from "./_generated/server";

const DAY = 24 * 60 * 60 * 1000;

// Tune these to taste
const JOB_SAVED_MAX_AGE = 14 * DAY; // untouched job postings go stale
const LEAD_NEW_MAX_AGE = 21 * DAY; // leads you never got to
const CLOSED_MAX_AGE = 30 * DAY; // Lost / Not a fit / Rejected

// Archives (never deletes) — archived items stay in the DB so agents won't re-add them.
// Never touches anything you've acted on (Applied, Interview, Offer, Contacted, Replied, Won).
export const archiveStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let jobsArchived = 0;
    let leadsArchived = 0;

    for (const j of await ctx.db.query("jobs").collect()) {
      const age = now - (j.statusChangedAt ?? j.foundAt ?? j._creationTime);
      const stale =
        (j.status === "Saved" && age > JOB_SAVED_MAX_AGE) ||
        (j.status === "Rejected" && age > CLOSED_MAX_AGE);
      if (stale) {
        await ctx.db.patch(j._id, { status: "Archived", statusChangedAt: now });
        jobsArchived++;
      }
    }

    for (const l of await ctx.db.query("leads").collect()) {
      const status = l.status ?? "New";
      const age = now - (l.statusChangedAt ?? l.foundAt ?? l._creationTime);
      const stale =
        (status === "New" && age > LEAD_NEW_MAX_AGE) ||
        ((status === "Lost" || status === "Not a fit") && age > CLOSED_MAX_AGE);
      if (stale) {
        await ctx.db.patch(l._id, { status: "Archived", statusChangedAt: now });
        leadsArchived++;
      }
    }

    return { jobsArchived, leadsArchived };
  },
});
