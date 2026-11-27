/**
 * The superadmin dashboard's backend (src/pages/admin, convex/lib/admin.ts). Every public function
 * here answers only the superadmin; everyone else is refused. It counts what users keep and do and
 * never returns amounts, odometer readings, locations, station names or notes, with one exception:
 * `badReads`, the photos and the reading of AI reads that went wrong, so they can be fixed. It
 * changes one thing: who may use AI (setAi).
 */
import { getDocumentSize, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireSuperadmin } from "./lib/access";
import { dayAt, hourAt } from "./lib/admin";

/** Rows read at most by one overview, per table; past it the range is cut short and the page says so. */
const ROW_LIMIT = 15_000;
/** shortcut: the overview reads every user, device and stats row. Fine for hundreds of accounts; page it beyond that. */
const USER_LIMIT = 5000;

/** Everything the dashboard charts for days `from`…`to` (device-local YYYY-MM-DD). The page filters and sums it. */
export const overview = query({
  args: { from: v.string(), to: v.string(), now: v.number() },
  handler: async (ctx, { from, to, now }) => {
    await requireSuperadmin(ctx);
    const users = await Promise.all((await ctx.db.query("users").take(USER_LIMIT)).map(async (u) => {
      // the last fill-up the user's app saved: seen even by a build too old to report usage
      const last = await ctx.db.query("fillUps").withIndex("by_userId", (q) => q.eq("userId", u._id)).order("desc").first();
      return { id: u._id, name: u.name ?? null, email: u.email ?? null, image: u.image ?? null, joinedAt: u._creationTime, lastSyncAt: last?._creationTime ?? null, ai: !!u.aiEnabled };
    }));
    const strip = <T extends { _id: unknown; _creationTime: number }>({ _id, _creationTime, ...rest }: T) => rest;
    const devices = (await ctx.db.query("usageDevices").take(USER_LIMIT * 3)).map(strip);
    const daily = (await ctx.db.query("usageDaily").withIndex("by_day", (q) => q.gte("day", from).lte("day", to)).take(ROW_LIMIT + 1)).map(strip);
    const stats = (await ctx.db.query("adminStats").take(USER_LIMIT)).map(strip);
    const ai = (await ctx.db.query("aiReads").withIndex("by_day", (q) => q.gte("day", from).lte("day", to)).take(ROW_LIMIT)).map(({ _id, fillUpId: _f, ...r }) => ({ id: _id, ...r }));
    const places = (await ctx.db.query("placesCalls").withIndex("by_day", (q) => q.gte("day", from).lte("day", to)).take(ROW_LIMIT)).map(strip);
    return { users, devices, daily: daily.slice(0, ROW_LIMIT), truncated: daily.length > ROW_LIMIT, stats, ai, places, now };
  },
});

/** One user's latest sessions, newest first, for the drill-down. */
export const userSessions = query({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit }) => {
    await requireSuperadmin(ctx);
    const rows = await ctx.db.query("usageSessions").withIndex("by_userId_and_startedAt", (q) => q.eq("userId", userId)).order("desc").take(Math.min(limit ?? 50, 200));
    return rows.map(({ _id, _creationTime, userId: _u, ...s }) => s);
  },
});

/** Turn AI on or off for some users (lib/access.ts aiAllowed). Off is how everyone starts. */
export const setAi = mutation({
  args: { userIds: v.array(v.id("users")), on: v.boolean() },
  handler: async (ctx, { userIds, on }) => {
    await requireSuperadmin(ctx);
    for (const id of userIds.slice(0, 500)) if (await ctx.db.get(id)) await ctx.db.patch("users", id, { aiEnabled: on });
    return null;
  },
});

/** "Refresh now": count everyone's documents again, in the background. */
export const refresh = mutation({
  args: {},
  handler: async (ctx) => {
    await requireSuperadmin(ctx);
    await ctx.scheduler.runAfter(0, internal.admin.refreshStats, {});
    return null;
  },
});

const BAD_SCAN = 400;
const BAD_SHOWN = 40;

/**
 * AI reads that went wrong (needed a look, unreadable, failed) or that the rider corrected, newest
 * first, with the photos and what was read. The one place the dashboard shows a rider's own data.
 */
export const badReads = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperadmin(ctx);
    const recent = await ctx.db.query("aiReads").order("desc").take(BAD_SCAN);
    const bad = recent.filter((r) => r.outcome === "review" || r.outcome === "unreadable" || r.outcome === "error" || r.outcome === "refused" || r.corrected.length).slice(0, BAD_SHOWN);
    return await Promise.all(bad.map(async (r) => {
      const [user, fill] = [await ctx.db.get(r.userId), r.fillUpId ? await ctx.db.get(r.fillUpId) : null];
      return {
        id: r._id, at: r._creationTime, model: r.model, outcome: r.outcome, issues: r.issues, corrected: r.corrected, attempts: r.attempts,
        costUsd: r.costUsd, latencyMs: r.latencyMs,
        user: user ? { name: user.name ?? null, email: user.email ?? null } : null,
        printed: fill?.read?.printed ?? {},
        photoUrls: fill ? await Promise.all(fill.photoIds.map((p) => ctx.storage.getUrl(p))) : [],
      };
    }));
  },
});

// ---- counting what each user keeps (weekly cron, or "Refresh now") ----

/** The tables counted per user, each with an index that starts with userId. Usage tables are the dashboard's own and left out of "storage". */
const COUNTED = {
  settings: "by_userId", vehicles: "by_userId", fillUps: "by_userId", stations: "by_userId", fileOwners: "by_userId",
  idempotencyKeys: "by_user_key", aiReads: "by_userId_and_day", placesCalls: "by_userId_and_day",
} as const satisfies Partial<Record<TableNames, string>>;
type Counted = keyof typeof COUNTED;
const countedArg = v.union(...(Object.keys(COUNTED) as Counted[]).map((t) => v.literal(t)));

const PAGE = 1000;
/** How far back "fill-ups created per day" goes. */
const DAYS_KEPT = 365;

/** One page of a user's documents in one table, counted: how many, their size, and tallies keyed "<what>:<value>". */
export const countPage = internalQuery({
  args: { userId: v.id("users"), table: countedArg, tzOffset: v.number(), since: v.number(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { userId, table, tzOffset, since, paginationOpts }) => {
    // every COUNTED index begins with userId; the table-by-table types are more than this needs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = (ctx.db.query(table) as any).withIndex(COUNTED[table], (q: any) => q.eq("userId", userId));
    const res = (await q.paginate(paginationOpts)) as { page: Doc<Counted>[]; isDone: boolean; continueCursor: string };
    const tally: Record<string, number> = {};
    const add = (k: string, n = 1) => { tally[k] = (tally[k] ?? 0) + n; };
    let bytes = 0;
    let firstFillDate: string | undefined;
    for (const d of res.page) {
      bytes += getDocumentSize(d);
      if (table === "fillUps") {
        const f = d as Doc<"fillUps">;
        if (f.deletedAt) continue;
        if (!firstFillDate || f.date < firstFillDate) firstFillDate = f.date;
        add(`fill:${f.source}`);
        if (f.status === "review") add("fill:review");
        if (f.photoIds.length) add("fill:withPhotos");
        if (f.lat !== undefined) add("fill:withLocation");
        if (f.fullTank) add("fill:fullTank");
        if (f.note) add("fill:withNote");
        if (f.unmoneySentAt) add("fill:handedOff");
        if (f.stationId) add("fill:withStation");
        if (f._creationTime >= since) add(`day:${dayAt(f._creationTime, tzOffset)}`);
        add(`hour:h${hourAt(f._creationTime, tzOffset)}`);
      } else if (table === "vehicles") {
        const x = d as Doc<"vehicles">;
        if (!x.deletedAt) { add(`kind:${x.kind}`); add(`fuel:${x.fuelType}`); }
      } else if (table === "stations") {
        const s = d as Doc<"stations">;
        if (!s.deletedAt) add(s.placeId ? "station:google" : "station:other");
      } else if (table === "aiReads") {
        if ((d as Doc<"aiReads">).corrected.length) add("fill:corrected");
      } else if (table === "fileOwners") {
        const f = await ctx.db.system.get("_storage", (d as Doc<"fileOwners">).storageId);
        if (f) { add("file:count"); add("file:bytes", f.size); }
      }
    }
    return { count: res.page.length, bytes, tally, firstFillDate, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/** What is read once per user, not a page at a time. */
export const userBasics = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const settings = await ctx.db.query("settings").withIndex("by_userId", (q) => q.eq("userId", userId)).first();
    const sessions = await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).take(500);
    const devices = await ctx.db.query("usageDevices").withIndex("by_userId_and_deviceId", (q) => q.eq("userId", userId)).take(50);
    const device = devices.sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0];
    return {
      settings: settings && { currency: settings.currency, theme: settings.theme, efficiencyUnit: settings.efficiencyUnit, unmoney: !!settings.unmoney, unmoneyAuto: !!settings.unmoney?.auto },
      signIns: sessions.length,
      lastSignInAt: sessions.reduce<number | undefined>((m, s) => Math.max(m ?? 0, s._creationTime), undefined),
      // the user's own clock, for "created per day / hour"; India's when they never reported one
      tzOffset: device?.tzOffset ?? 330,
    };
  },
});

export const userIds = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("users").take(USER_LIMIT)).map((u) => u._id),
});

const counts = v.record(v.string(), v.number());
const statsValidator = {
  tables: v.record(v.string(), v.object({ count: v.number(), bytes: v.number() })),
  files: v.object({ count: v.number(), bytes: v.number() }),
  fillUps: counts,
  createdByDay: counts,
  createdByHour: counts,
  firstFillDate: v.optional(v.string()),
  features: v.record(v.string(), v.boolean()),
  prefs: v.record(v.string(), v.string()),
  vehicleKinds: counts,
  fuelTypes: counts,
  signIns: v.number(),
  lastSignInAt: v.optional(v.number()),
};

export const saveStats = internalMutation({
  args: { userId: v.id("users"), stats: v.object(statsValidator) },
  handler: async (ctx, { userId, stats }) => {
    // deleted while being counted: nothing of theirs is written back
    if (!(await ctx.db.get(userId))) return null;
    const row = await ctx.db.query("adminStats").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
    const doc = { userId, computedAt: Date.now(), ...stats };
    if (row) await ctx.db.replace("adminStats", row._id, doc);
    else await ctx.db.insert("adminStats", doc);
    return null;
  },
});

/** Count every user's documents again: each user by an action of their own, a second apart, so no one action runs out of time. */
export const refreshStats = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    const ids: Id<"users">[] = await ctx.runQuery(internal.admin.userIds, {});
    for (const [i, userId] of ids.entries()) await ctx.scheduler.runAfter(i * 1000, internal.admin.refreshUser, { userId });
    return null;
  },
});

/** Count one user's documents and store the result in adminStats. */
export const refreshUser = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<null> => {
    const basics = await ctx.runQuery(internal.admin.userBasics, { userId });
    const tables: Record<string, { count: number; bytes: number }> = {};
    const tally: Record<string, number> = {};
    let firstFillDate: string | undefined;
    const since = Date.now() - DAYS_KEPT * 86_400_000;
    for (const table of Object.keys(COUNTED) as Counted[]) {
      let cursor: string | null = null;
      const sum = { count: 0, bytes: 0 };
      for (;;) {
        const page: { count: number; bytes: number; tally: Record<string, number>; firstFillDate?: string; isDone: boolean; continueCursor: string } =
          await ctx.runQuery(internal.admin.countPage, { userId, table, tzOffset: basics.tzOffset, since, paginationOpts: { numItems: PAGE, cursor } });
        sum.count += page.count;
        sum.bytes += page.bytes;
        for (const [k, n] of Object.entries(page.tally)) tally[k] = (tally[k] ?? 0) + n;
        if (page.firstFillDate && (!firstFillDate || page.firstFillDate < firstFillDate)) firstFillDate = page.firstFillDate;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      tables[table] = sum;
    }
    const pick = (prefix: string) => Object.fromEntries(Object.entries(tally).filter(([k]) => k.startsWith(prefix)).map(([k, n]) => [k.slice(prefix.length), n]));
    const fill = pick("fill:");
    const kinds = pick("kind:");
    const total = (fill.photo ?? 0) + (fill.device ?? 0) + (fill.manual ?? 0);
    const s = basics.settings;
    await ctx.runMutation(internal.admin.saveStats, {
      userId,
      stats: {
        tables,
        files: { count: tally["file:count"] ?? 0, bytes: tally["file:bytes"] ?? 0 },
        fillUps: fill,
        createdByDay: pick("day:"),
        createdByHour: pick("hour:"),
        firstFillDate,
        features: {
          aiReading: (fill.photo ?? 0) > 0,
          deviceReading: (fill.device ?? 0) > 0,
          typedOnly: total > 0 && total === (fill.manual ?? 0),
          photosKept: (fill.withPhotos ?? 0) > 0,
          location: (fill.withLocation ?? 0) > 0,
          stations: (fill.withStation ?? 0) > 0,
          googleStations: !!tally["station:google"],
          fullTankRider: total > 0 && (fill.fullTank ?? 0) * 2 >= total,
          severalVehicles: Object.values(kinds).reduce((a, b) => a + b, 0) > 1,
          notes: (fill.withNote ?? 0) > 0,
          unmoney: !!s?.unmoney,
          unmoneyAuto: !!s?.unmoneyAuto,
        },
        prefs: s ? { currency: s.currency, theme: s.theme, efficiencyUnit: s.efficiencyUnit } : {},
        vehicleKinds: kinds,
        fuelTypes: pick("fuel:"),
        signIns: basics.signIns,
        lastSignInAt: basics.lastSignInAt,
      },
    });
    return null;
  },
});
