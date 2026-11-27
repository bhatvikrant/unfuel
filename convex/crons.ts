import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const crons = cronJobs();

crons.cron("prune old usage sessions", "30 3 * * *", internal.usage.pruneSessions, {});
crons.cron("count each user's data for the superadmin dashboard", "40 3 * * 1", internal.admin.refreshStats, {});
crons.cron("delete uploads nobody claimed", "0 4 * * *", internal.files.sweepUnclaimed, {});
crons.cron("remove fill-ups deleted over 30 days ago, with their photos", "30 4 * * *", internal.fillUps.purgeDeleted, {});
crons.cron("prune idempotency keys", "15 4 * * *", internal.crons.pruneIdempotencyKeys, {});

/** Idempotency keys only matter for a few hours after the app sent them (src/offline). */
export const pruneIdempotencyKeys = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 14 * 24 * 3600_000;
    const old = await ctx.db.query("idempotencyKeys").withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff)).take(500);
    for (const row of old) await ctx.db.delete(row._id);
    return null;
  },
});

export default crons;
