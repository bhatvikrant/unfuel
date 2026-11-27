/**
 * Usage counts for the superadmin dashboard (convex/lib/admin.ts). The app reports each session's
 * running totals (src/lib/usage.ts); a ping adds only what grew since the last one, so a retried or
 * repeated ping counts nothing twice. Also the count and cost of every AI read (aiReads), which is
 * what the monthly cap is checked against. Server-only tables.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { currentUser } from "./lib/access";
import { COUNT_KEYS, dayAt, lengthBucket, zeroCounts, type Counts } from "./lib/admin";
import { costOf } from "./lib/aiCost";
import { readOutcome } from "./schema";

/** Sessions are kept this long for the per-user drill-down; the daily sums stay. */
const SESSION_TTL_MS = 120 * 24 * 60 * 60 * 1000;
const PRUNE_BATCH = 500;

const clip = (s: string, n = 40) => s.slice(0, n);
const bump = (r: Record<string, number>, k: string, by = 1) => ({ ...r, [k]: (r[k] ?? 0) + by });
/** Only the counts this build knows, as whole numbers that never go down. */
const known = (totals: Record<string, number>): Counts => {
  const out = zeroCounts();
  for (const k of COUNT_KEYS) if (Number.isFinite(totals[k]) && totals[k] > 0) out[k] = Math.round(totals[k]);
  return out;
};

export const ping = mutation({
  args: {
    sessionId: v.string(),
    deviceId: v.string(),
    /** The device's local day and hour when the session began. */
    day: v.string(),
    hour: v.number(),
    startedAt: v.number(),
    tzOffset: v.number(),
    os: v.string(),
    browser: v.string(),
    formFactor: v.union(v.literal("phone"), v.literal("tablet"), v.literal("desktop")),
    standalone: v.boolean(),
    appVersion: v.string(),
    totals: v.record(v.string(), v.number()),
    screens: v.record(v.string(), v.number()),
  },
  handler: async (ctx, a) => {
    const user = await currentUser(ctx);
    if (!user || !/^\d{4}-\d{2}-\d{2}$/.test(a.day)) return null;
    const userId = user._id;
    const now = Date.now();
    const deviceId = clip(a.deviceId, 64);
    // looked up by the id it is stored under: a longer one would otherwise insert a new row on every ping
    const sessionId = clip(a.sessionId, 64);
    const device = { os: clip(a.os), browser: clip(a.browser), formFactor: a.formFactor, standalone: a.standalone, appVersion: clip(a.appVersion), tzOffset: Math.round(a.tzOffset), lastSeenAt: now };

    let session = await ctx.db.query("usageSessions").withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId)).unique();
    if (session && session.userId !== userId) return null;
    const isNew = !session;
    const before = known(session?.totals ?? {});
    const totals = known(a.totals);
    // a session cannot have been on screen longer than it has existed
    totals.activeMs = Math.min(totals.activeMs, Math.max(0, now - (session?.startedAt ?? a.startedAt)));
    const merged = zeroCounts();
    const delta = zeroCounts();
    for (const k of COUNT_KEYS) { merged[k] = Math.max(before[k], totals[k]); delta[k] = merged[k] - before[k]; }
    const screens: Record<string, number> = {};
    for (const [k, n] of Object.entries(a.screens).slice(0, 100)) {
      const d = Math.round(n - (session?.screens[clip(k, 60)] ?? 0));
      if (d > 0) screens[clip(k, 60)] = d;
    }

    const seenDevice = await ctx.db.query("usageDevices").withIndex("by_userId_and_deviceId", (q) => q.eq("userId", userId).eq("deviceId", deviceId)).unique();
    if (seenDevice) await ctx.db.patch("usageDevices", seenDevice._id, { ...device, sessions: seenDevice.sessions + (isNew ? 1 : 0) });
    else await ctx.db.insert("usageDevices", { userId, deviceId, firstSeenAt: now, sessions: 1, ...device });

    if (session) {
      let seen = session.screens;
      for (const [k, n] of Object.entries(screens)) seen = bump(seen, k, n);
      await ctx.db.patch("usageSessions", session._id, { totals: merged, lastSeenAt: now, appVersion: device.appVersion, screens: seen });
    } else {
      const id = await ctx.db.insert("usageSessions", { userId, deviceId, sessionId, day: a.day, startedAt: Math.min(a.startedAt, now), lastSeenAt: now, totals: merged, screens, appVersion: device.appVersion });
      session = (await ctx.db.get(id))!;
    }

    // everything a session does counts on the day it began
    const day = session.day;
    const rows = await ctx.db.query("usageDaily").withIndex("by_userId_and_day", (q) => q.eq("userId", userId).eq("day", day)).take(50);
    const row = rows.find((r) => r.deviceId === deviceId);
    const oldBucket = isNew ? null : lengthBucket(before.activeMs);
    const newBucket = lengthBucket(merged.activeMs);
    let lengths = row?.lengths ?? {};
    if (oldBucket !== newBucket) {
      if (oldBucket && lengths[oldBucket]) lengths = bump(lengths, oldBucket, -1);
      lengths = bump(lengths, newBucket);
    }
    let rowScreens = row?.screens ?? {};
    for (const [k, n] of Object.entries(screens)) rowScreens = bump(rowScreens, k, n);
    const sums: Record<string, number> = { ...(row?.totals ?? {}) };
    for (const k of COUNT_KEYS) sums[k] = (sums[k] ?? 0) + delta[k];
    const opens = (row?.opens ?? 0) + (isNew ? 1 : 0);
    const hours = isNew ? bump(row?.hours ?? {}, `h${Math.min(23, Math.max(0, Math.floor(a.hour)))}`) : row?.hours ?? {};
    if (row) await ctx.db.patch("usageDaily", row._id, { totals: sums, opens, hours, screens: rowScreens, lengths });
    else await ctx.db.insert("usageDaily", { userId, deviceId, day, totals: sums, opens, hours, screens: rowScreens, lengths });
    return null;
  },
});

/** Today for a user: their own day, by their latest device's clock (India's when none reported one). */
export async function userDay(ctx: MutationCtx, userId: Id<"users">): Promise<string> {
  const devices = await ctx.db.query("usageDevices").withIndex("by_userId_and_deviceId", (q) => q.eq("userId", userId)).take(50);
  const device = devices.sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0];
  return dayAt(Date.now(), device?.tzOffset ?? 330);
}

/**
 * Counts an AI read before it is made: null when the month is used up. In a transaction of its own,
 * so reads started at the same moment cannot all pass. The row is the read's from here on, even if
 * the call then fails; a retry of the same fill-up reuses it and is not counted again.
 */
export const claimAi = internalMutation({
  args: { userId: v.id("users"), fillUpId: v.id("fillUps"), model: v.string(), cap: v.number() },
  handler: async (ctx, { userId, fillUpId, model, cap }): Promise<Id<"aiReads"> | null> => {
    if (!(await ctx.db.get(userId))) return null;
    const open = await ctx.db.query("aiReads").withIndex("by_fillUpId", (q) => q.eq("fillUpId", fillUpId)).order("desc").first();
    if (open && (open.outcome === "started" || open.outcome === "error")) return open._id;
    const day = await userDay(ctx, userId);
    const month = day.slice(0, 7);
    const used = await ctx.db.query("aiReads").withIndex("by_userId_and_day", (q) => q.eq("userId", userId).gte("day", `${month}-01`).lte("day", `${month}-31`)).take(cap);
    if (used.length >= cap) return null;
    return await ctx.db.insert("aiReads", {
      userId, fillUpId, day, feature: "read", model, attempts: 0, outcome: "started", issues: [], corrected: [], kinds: {},
      inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0, latencyMs: 0,
    });
  },
});

/** One Claude call of a read: its tokens and cost are added, its outcome replaces the last. */
export const recordAi = internalMutation({
  args: {
    readId: v.id("aiReads"),
    model: v.string(),
    outcome: readOutcome,
    issues: v.array(v.string()),
    kinds: v.record(v.string(), v.number()),
    tokens: v.object({ input: v.number(), output: v.number(), cacheWrite: v.number(), cacheRead: v.number() }),
    latencyMs: v.number(),
  },
  handler: async (ctx, { readId, model, outcome, issues, kinds, tokens, latencyMs }) => {
    const row = await ctx.db.get(readId);
    if (!row) return null;
    await ctx.db.patch("aiReads", readId, {
      model, outcome, issues, kinds,
      attempts: row.attempts + 1,
      inputTokens: row.inputTokens + tokens.input,
      outputTokens: row.outputTokens + tokens.output,
      cacheWriteTokens: row.cacheWriteTokens + tokens.cacheWrite,
      cacheReadTokens: row.cacheReadTokens + tokens.cacheRead,
      costUsd: row.costUsd + costOf(model, tokens),
      latencyMs: row.latencyMs + latencyMs,
    });
    return null;
  },
});

/** One Google Places call, counted for the dashboard (convex/places.ts). */
export const countPlaces = internalMutation({
  args: { userId: v.id("users"), sku: v.string() },
  handler: async (ctx, { userId, sku }) => {
    if (!(await ctx.db.get(userId))) return null;
    const day = await userDay(ctx, userId);
    const rows = await ctx.db.query("placesCalls").withIndex("by_userId_and_day", (q) => q.eq("userId", userId).eq("day", day)).take(20);
    const row = rows.find((r) => r.sku === sku);
    if (row) await ctx.db.patch("placesCalls", row._id, { calls: row.calls + 1 });
    else await ctx.db.insert("placesCalls", { userId, day, sku, calls: 1 });
    return null;
  },
});

/** Daily cron: drop sessions older than the TTL. */
export const pruneSessions = internalMutation({
  args: { cutoff: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = args.cutoff ?? Date.now() - SESSION_TTL_MS;
    const old = await ctx.db.query("usageSessions").withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff)).take(PRUNE_BATCH);
    for (const row of old) await ctx.db.delete(row._id);
    if (old.length === PRUNE_BATCH) await ctx.scheduler.runAfter(0, internal.usage.pruneSessions, { cutoff });
    return null;
  },
});
