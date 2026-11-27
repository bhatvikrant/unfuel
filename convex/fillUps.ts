/**
 * Fill-ups: the one table everything else is worked out from. Mileage, cost per km, charts and
 * station figures are never stored: the app computes them from `list` (convex/lib/mileage.ts).
 */
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { env, internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { aiAllowed, own, requireUser, requireUserId, type Ctx } from "./lib/access";
import { PHOTO_MAX_COUNT, isRealDate, type ReadContext } from "./lib/fuelRead";
import { idempotent } from "./lib/idempotency";
import { fillSource, locationSource } from "./schema";
import { ensureSettings, settingsOf } from "./settings";
import { vehicleFor } from "./vehicles";

/**
 * shortcut: one query returns every fill-up of the account (about 1 KB each), so the app can work
 * out everything offline. Page it by vehicle when an account passes this many.
 */
const MAX_FILLS = 3000;

const place = {
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  accuracyM: v.optional(v.number()),
  locationSource: v.optional(locationSource),
};
const billStation = v.object({ name: v.optional(v.string()), brand: v.optional(v.string()), address: v.optional(v.string()) });

const cut = (s: string | undefined, max: number) => s?.replace(/\s+/g, " ").trim().slice(0, max) || undefined;
function checkDate(date: string, time?: string) {
  if (!isRealDate(date)) throw new ConvexError("That date does not look right");
  if (time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ConvexError("That time does not look right");
}
function whole(n: number | undefined, max: number, what: string): number | undefined {
  if (n === undefined) return undefined;
  if (!Number.isInteger(n) || n <= 0 || n > max) throw new ConvexError(`That ${what} does not look right`);
  return n;
}
function checkPlace(p: { lat?: number; lng?: number; accuracyM?: number; locationSource?: Doc<"fillUps">["locationSource"] }) {
  if (p.lat === undefined || p.lng === undefined) return {};
  if (!(Math.abs(p.lat) <= 90) || !(Math.abs(p.lng) <= 180)) throw new ConvexError("That location does not look right");
  return { lat: p.lat, lng: p.lng, accuracyM: p.accuracyM !== undefined && p.accuracyM >= 0 ? Math.round(p.accuracyM) : undefined, locationSource: p.locationSource ?? "device" };
}

/** Each photo must be one the caller uploaded and claimed (convex/files.ts). */
async function checkPhotos(ctx: Ctx, userId: Id<"users">, photoIds: Id<"_storage">[]) {
  if (photoIds.length > PHOTO_MAX_COUNT) throw new ConvexError(`A fill-up takes at most ${PHOTO_MAX_COUNT} photos`);
  for (const id of photoIds) {
    const owner = await ctx.db.query("fileOwners").withIndex("by_storageId", (q) => q.eq("storageId", id)).unique();
    if (!owner || owner.userId !== userId) throw new ConvexError("That photo is not yours");
  }
}

/** The odometer of the vehicle's fill-ups on the days before and after `date`. Same-day fill-ups are not compared. */
async function neighbours(ctx: Ctx, userId: Id<"users">, vehicleId: Id<"vehicles">, date: string, except?: Id<"fillUps">) {
  const usable = (f: Doc<"fillUps">) => f._id !== except && !f.deletedAt && f.status === "done" && f.odometerM !== undefined;
  const index = () => ctx.db.query("fillUps").withIndex("by_userId_and_vehicleId_and_date", (q) => q.eq("userId", userId).eq("vehicleId", vehicleId));
  let prev: number | undefined, next: number | undefined;
  for await (const f of ctx.db.query("fillUps").withIndex("by_userId_and_vehicleId_and_date", (q) => q.eq("userId", userId).eq("vehicleId", vehicleId).lt("date", date)).order("desc")) {
    if (usable(f)) { prev = f.odometerM; break; }
  }
  for await (const f of index().order("asc")) {
    if (f.date > date && usable(f)) { next = f.odometerM; break; }
  }
  return { prevOdometerM: prev, nextOdometerM: next };
}

async function checkOdometer(ctx: Ctx, userId: Id<"users">, vehicleId: Id<"vehicles">, date: string, odometerM: number | undefined, except?: Id<"fillUps">) {
  if (odometerM === undefined) return;
  const { prevOdometerM, nextOdometerM } = await neighbours(ctx, userId, vehicleId, date, except);
  if (prevOdometerM !== undefined && odometerM <= prevOdometerM) throw new ConvexError(`The odometer was already at ${Math.round(prevOdometerM / 1000)} km at the fill-up before this one`);
  if (nextOdometerM !== undefined && odometerM >= nextOdometerM) throw new ConvexError(`The odometer is at ${Math.round(nextOdometerM / 1000)} km at the fill-up after this one`);
}

/** Once a fill-up is complete: find its station, and send it to UnMoney when the rider asked for every one. */
async function afterDone(ctx: MutationCtx, id: Id<"fillUps">) {
  const f = await ctx.db.get(id);
  if (!f || f.status !== "done" || f.deletedAt) return;
  if (!f.stationId && f.stationSetBy !== "user" && (f.lat !== undefined || f.billStation?.name)) {
    await ctx.scheduler.runAfter(0, internal.places.detect, { fillUpId: id });
  }
  if (!f.unmoneySentAt && (await settingsOf(ctx, f.userId))?.unmoney?.auto) {
    await ctx.scheduler.runAfter(0, internal.unmoney.send, { fillUpId: id, attempt: 0 });
  }
}

/** Every fill-up of the account that is not deleted, in no particular order. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db.query("fillUps").withIndex("by_userId", (q) => q.eq("userId", userId)).take(MAX_FILLS);
    return rows.filter((f) => !f.deletedAt);
  },
});

/** One fill-up with the addresses of its photos, or null when it is not the caller's. */
export const get = query({
  args: { id: v.id("fillUps") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const f = await ctx.db.get(id);
    if (!f || f.userId !== userId) return null;
    const photoUrls = await Promise.all(f.photoIds.map((p) => ctx.storage.getUrl(p)));
    return { ...f, photoUrls };
  },
});

/**
 * A fill-up from photos, for an account whose photos are read by AI: stored as "reading" and read
 * by a scheduled action, so the read does not depend on the app staying open. An account without
 * AI saves through `createManual` after the device has read what it can; one that lands here
 * anyway (an old copy of the app) gets a fill-up to complete by hand.
 */
export const createFromPhotos = mutation({
  args: {
    clientKey: v.optional(v.string()),
    vehicleId: v.optional(v.id("vehicles")),
    photoIds: v.array(v.id("_storage")),
    date: v.string(),
    time: v.optional(v.string()),
    fullTank: v.optional(v.boolean()),
    ...place,
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await idempotent(ctx, user._id, args.clientKey, async () => {
      checkDate(args.date, args.time);
      if (!args.photoIds.length) throw new ConvexError("Add a photo first");
      await checkPhotos(ctx, user._id, args.photoIds);
      const vehicleId = await vehicleFor(ctx, user._id, args.vehicleId);
      const settings = await ensureSettings(ctx, user._id);
      const reads = aiAllowed(user) && !!env.ANTHROPIC_API_KEY;
      const id = await ctx.db.insert("fillUps", {
        userId: user._id, vehicleId, status: reads ? "reading" : "review", source: "photo",
        date: args.date, time: args.time, currency: settings.currency,
        fullTank: args.fullTank ?? settings.fullTankDefault, missedBefore: false,
        photoIds: args.photoIds, ...checkPlace(args),
        read: reads ? undefined : { kinds: {}, printed: {}, issues: ["aiOff"] },
      });
      if (reads) await ctx.scheduler.runAfter(0, internal.ai.readFillUp, { fillUpId: id });
      return id;
    });
  },
});

/** A complete fill-up: typed, or filled in by the device from photos and checked by the rider. */
export const createManual = mutation({
  args: {
    clientKey: v.optional(v.string()),
    vehicleId: v.optional(v.id("vehicles")),
    source: v.optional(fillSource),
    date: v.string(),
    time: v.optional(v.string()),
    odometerM: v.optional(v.number()),
    quantityMilli: v.number(),
    amountMinor: v.number(),
    fullTank: v.boolean(),
    missedBefore: v.optional(v.boolean()),
    note: v.optional(v.string()),
    photoIds: v.optional(v.array(v.id("_storage"))),
    stationId: v.optional(v.id("stations")),
    billStation: v.optional(billStation),
    /** What the device read off the photos, as text, for a later look. */
    printed: v.optional(v.record(v.string(), v.string())),
    ...place,
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await idempotent(ctx, userId, args.clientKey, async () => {
      checkDate(args.date, args.time);
      const photoIds = args.photoIds ?? [];
      await checkPhotos(ctx, userId, photoIds);
      const vehicleId = await vehicleFor(ctx, userId, args.vehicleId);
      const settings = await ensureSettings(ctx, userId);
      const odometerM = whole(args.odometerM, 2_000_000_000, "odometer reading");
      await checkOdometer(ctx, userId, vehicleId, args.date, odometerM);
      if (args.stationId) await own(ctx, userId, args.stationId);
      const source = args.source === "device" && photoIds.length ? "device" : "manual";
      const id = await ctx.db.insert("fillUps", {
        userId, vehicleId, status: "done", source,
        date: args.date, time: args.time, odometerM,
        quantityMilli: whole(args.quantityMilli, 1_000_000, "fuel quantity")!,
        amountMinor: whole(args.amountMinor, 1_000_000_000, "amount")!,
        currency: settings.currency, fullTank: args.fullTank, missedBefore: args.missedBefore ?? false,
        note: cut(args.note, 500), photoIds, ...checkPlace(args),
        stationId: args.stationId, stationSetBy: args.stationId ? "user" : undefined,
        billStation: args.billStation && { name: cut(args.billStation.name, 80), brand: cut(args.billStation.brand, 40), address: cut(args.billStation.address, 160) },
        read: source === "device" ? { kinds: {}, printed: args.printed ?? {}, issues: [] } : undefined,
      });
      await afterDone(ctx, id);
      return id;
    });
  },
});

/** The fields a read fills and a rider may then change: what the dashboard counts as a correction. */
const READ_FIELDS = ["amountMinor", "quantityMilli", "odometerM", "date", "stationId"] as const;

/** Edit any field. A fill-up waiting for a look becomes complete once it has an amount and a quantity. */
export const update = mutation({
  args: {
    id: v.id("fillUps"),
    clientKey: v.optional(v.string()),
    vehicleId: v.optional(v.id("vehicles")),
    date: v.optional(v.string()),
    time: v.optional(v.union(v.string(), v.null())),
    odometerM: v.optional(v.union(v.number(), v.null())),
    quantityMilli: v.optional(v.number()),
    amountMinor: v.optional(v.number()),
    fullTank: v.optional(v.boolean()),
    missedBefore: v.optional(v.boolean()),
    note: v.optional(v.union(v.string(), v.null())),
    stationId: v.optional(v.union(v.id("stations"), v.null())),
  },
  handler: async (ctx, { id, clientKey: _clientKey, ...args }) => {
    const userId = await requireUserId(ctx);
    const before = await own(ctx, userId, id);
    const vehicleId = args.vehicleId ? (await own(ctx, userId, args.vehicleId))._id : before.vehicleId;
    const date = args.date ?? before.date;
    const time = args.time === undefined ? before.time : args.time ?? undefined;
    checkDate(date, time);
    const odometerM = args.odometerM === undefined ? before.odometerM : whole(args.odometerM ?? undefined, 2_000_000_000, "odometer reading");
    if (odometerM !== before.odometerM || date !== before.date || vehicleId !== before.vehicleId) await checkOdometer(ctx, userId, vehicleId, date, odometerM, id);
    const quantityMilli = args.quantityMilli === undefined ? before.quantityMilli : whole(args.quantityMilli, 1_000_000, "fuel quantity");
    const amountMinor = args.amountMinor === undefined ? before.amountMinor : whole(args.amountMinor, 1_000_000_000, "amount");
    if (args.stationId) await own(ctx, userId, args.stationId);
    const station = args.stationId === undefined ? {} : { stationId: args.stationId ?? undefined, stationSetBy: "user" as const };
    const complete = !!quantityMilli && !!amountMinor;
    if (before.status === "done" && !complete) throw new ConvexError("A fill-up needs an amount and a quantity");
    const after = {
      vehicleId, date, time, odometerM, quantityMilli, amountMinor,
      fullTank: args.fullTank ?? before.fullTank,
      missedBefore: args.missedBefore ?? before.missedBefore,
      note: args.note === undefined ? before.note : cut(args.note ?? undefined, 500),
      ...station,
      status: complete ? ("done" as const) : before.status === "reading" ? ("review" as const) : before.status,
    };
    await ctx.db.patch("fillUps", id, after);

    // what the rider changed after an AI read, by field name only (the dashboard's read quality)
    if (before.source === "photo" && before.read) {
      const now = { ...before, ...after };
      const changed = READ_FIELDS.filter((k) => before[k] !== undefined && before[k] !== now[k]);
      const row = changed.length ? await ctx.db.query("aiReads").withIndex("by_fillUpId", (q) => q.eq("fillUpId", id)).first() : null;
      if (row) await ctx.db.patch("aiReads", row._id, { corrected: [...new Set([...row.corrected, ...changed])] });
    }
    await afterDone(ctx, id);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("fillUps"), clientKey: v.optional(v.string()) },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    await own(ctx, userId, id);
    await ctx.db.patch("fillUps", id, { deletedAt: Date.now() });
    return null;
  },
});

/** Undo a delete. */
export const restore = mutation({
  args: { id: v.id("fillUps"), clientKey: v.optional(v.string()) },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    await own(ctx, userId, id);
    await ctx.db.patch("fillUps", id, { deletedAt: undefined });
    return null;
  },
});

/** Have AI read the photos of a fill-up again: one that failed, or one added before AI was turned on. */
export const retryRead = mutation({
  args: { id: v.id("fillUps") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const f = await own(ctx, user._id, id);
    if (!aiAllowed(user) || !env.ANTHROPIC_API_KEY) throw new ConvexError("AI reading is not on for this account");
    if (!f.photoIds.length) throw new ConvexError("This fill-up has no photos");
    if (f.status === "done") throw new ConvexError("This fill-up is already complete");
    await ctx.db.patch("fillUps", id, { status: "reading", source: "photo", readAttempts: 0 });
    await ctx.scheduler.runAfter(0, internal.ai.readFillUp, { fillUpId: id });
    return null;
  },
});

/** The "Send to UnMoney" button (convex/unmoney.ts). */
export const sendToUnmoney = mutation({
  args: { id: v.id("fillUps") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const f = await own(ctx, userId, id);
    if (f.status !== "done") throw new ConvexError("Finish the fill-up first");
    if (f.unmoneySentAt) throw new ConvexError("This fill-up is already in UnMoney");
    if (!(await settingsOf(ctx, userId))?.unmoney) throw new ConvexError("Connect UnMoney first, under More");
    await ctx.db.patch("fillUps", id, { unmoneyError: undefined });
    await ctx.scheduler.runAfter(0, internal.unmoney.send, { fillUpId: id, attempt: 0 });
    return null;
  },
});

/** A deleted fill-up can be brought back for this long; after it, the fill-up and its photos are gone for good. */
const KEEP_DELETED_MS = 30 * 24 * 60 * 60 * 1000;
const PURGE_BATCH = 100;

/** Daily cron: fill-ups deleted over 30 days ago are removed, with their photos. */
export const purgeDeleted = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - KEEP_DELETED_MS;
    // rows never deleted have no deletedAt and sort before every number, so the range skips them
    const old = await ctx.db.query("fillUps").withIndex("by_deletedAt", (q) => q.gt("deletedAt", 0).lt("deletedAt", cutoff)).take(PURGE_BATCH);
    for (const f of old) {
      for (const p of f.photoIds) {
        const owner = await ctx.db.query("fileOwners").withIndex("by_storageId", (q) => q.eq("storageId", p)).unique();
        if (owner?.userId !== f.userId) continue;
        await ctx.db.delete(owner._id);
        try { await ctx.storage.delete(p); } catch { /* already gone */ }
      }
      await ctx.db.delete(f._id);
    }
    if (old.length === PURGE_BATCH) await ctx.scheduler.runAfter(0, internal.fillUps.purgeDeleted, {});
    return null;
  },
});

// ---- for the AI read (convex/ai.ts) ----

/** What the read needs to know, or null when there is nothing to read any more (deleted, or typed in meanwhile). */
export const readContext = internalQuery({
  args: { fillUpId: v.id("fillUps"), today: v.string() },
  handler: async (ctx, { fillUpId, today }) => {
    const f = await ctx.db.get(fillUpId);
    if (!f || f.deletedAt || f.status !== "reading") return null;
    const [user, vehicle] = [await ctx.db.get(f.userId), await ctx.db.get(f.vehicleId)];
    if (!user || !vehicle) return null;
    const context: ReadContext = {
      today, captureDate: f.date, captureTime: f.time, currency: f.currency, fuelType: vehicle.fuelType, tankMilli: vehicle.tankMilli,
      ...(await neighbours(ctx, f.userId, f.vehicleId, f.date, f._id)),
    };
    return { userId: f.userId, allowed: aiAllowed(user), photoIds: f.photoIds, attempts: f.readAttempts ?? 0, context };
  },
});

export const bumpAttempts = internalMutation({
  args: { fillUpId: v.id("fillUps") },
  handler: async (ctx, { fillUpId }) => {
    const f = await ctx.db.get(fillUpId);
    if (f) await ctx.db.patch("fillUps", fillUpId, { readAttempts: (f.readAttempts ?? 0) + 1 });
    return null;
  },
});

/**
 * Write what a read made of the photos. Saved as complete when nothing needs a look; otherwise left
 * for the rider with the reasons. A fill-up the rider completed while it was being read is left alone.
 */
export const applyRead = internalMutation({
  args: {
    fillUpId: v.id("fillUps"),
    model: v.optional(v.string()),
    fields: v.object({
      amountMinor: v.optional(v.number()), quantityMilli: v.optional(v.number()), date: v.optional(v.string()), time: v.optional(v.string()),
      odometerM: v.optional(v.number()), currency: v.optional(v.string()),
      stationName: v.optional(v.string()), stationBrand: v.optional(v.string()), stationAddress: v.optional(v.string()),
    }),
    kinds: v.record(v.string(), v.number()),
    printed: v.record(v.string(), v.string()),
    issues: v.array(v.string()),
  },
  handler: async (ctx, { fillUpId, model, fields, kinds, printed, issues }): Promise<"done" | "review" | null> => {
    const f = await ctx.db.get(fillUpId);
    if (!f || f.deletedAt || f.status !== "reading") return null;
    const { stationName, stationBrand, stationAddress, currency, ...values } = fields;
    const done = issues.length === 0 && !!values.amountMinor && !!values.quantityMilli;
    // the first bill sets the account's currency: nobody is asked for it up front
    let cur = f.currency;
    if (currency && currency !== f.currency) {
      const others = await ctx.db.query("fillUps").withIndex("by_userId_and_status", (q) => q.eq("userId", f.userId).eq("status", "done")).first();
      const settings = await ensureSettings(ctx, f.userId);
      if (!others) { cur = currency; await ctx.db.patch("settings", settings._id, { currency }); }
    }
    await ctx.db.patch("fillUps", fillUpId, {
      ...values, currency: cur, status: done ? "done" : "review",
      billStation: stationName || stationBrand ? { name: stationName, brand: stationBrand, address: stationAddress } : f.billStation,
      read: { model, kinds, printed, issues },
    });
    await afterDone(ctx, fillUpId);
    return done ? "done" : "review";
  },
});
