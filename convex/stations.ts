/**
 * The rider's fuel stations. Each is tied to a Google place where one was found (convex/places.ts);
 * the place ID is kept for good, Google's name only as a copy that is refetched (Places policy),
 * and what the bill itself said as the rider's own record. Stations are private to the account.
 */
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { own, requireUserId } from "./lib/access";
import { idempotent } from "./lib/idempotency";

/** Far more than a rider refuels at. */
const MAX_STATIONS = 500;

const cut = (s: string | undefined, max: number) => s?.replace(/\s+/g, " ").trim().slice(0, max) || undefined;

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db.query("stations").withIndex("by_userId", (q) => q.eq("userId", userId)).take(MAX_STATIONS);
    return rows.filter((s) => !s.deletedAt);
  },
});

/** The rider's own name for a station; empty goes back to Google's or the bill's. */
export const rename = mutation({
  args: { id: v.id("stations"), name: v.string(), clientKey: v.optional(v.string()) },
  handler: async (ctx, { id, name }) => {
    const userId = await requireUserId(ctx);
    await own(ctx, userId, id);
    await ctx.db.patch("stations", id, { customName: cut(name, 80) });
    return null;
  },
});

/** Two rows that are one station: every fill-up of `from` moves to `into`. */
export const merge = mutation({
  args: { from: v.id("stations"), into: v.id("stations") },
  handler: async (ctx, { from, into }) => {
    const userId = await requireUserId(ctx);
    if (from === into) return null;
    await own(ctx, userId, from);
    await own(ctx, userId, into);
    for await (const f of ctx.db.query("fillUps").withIndex("by_stationId", (q) => q.eq("stationId", from))) {
      await ctx.db.patch("fillUps", f._id, { stationId: into });
    }
    await ctx.db.patch("stations", from, { deletedAt: Date.now() });
    return null;
  },
});

/** A station Google does not have, by the name the rider typed, set on a fill-up. */
export const chooseCustom = mutation({
  args: { fillUpId: v.optional(v.id("fillUps")), name: v.string(), clientKey: v.optional(v.string()) },
  handler: async (ctx, { fillUpId, name, clientKey }) => {
    const userId = await requireUserId(ctx);
    return await idempotent(ctx, userId, clientKey, async () => {
      const customName = cut(name, 80);
      if (!customName) throw new ConvexError("Type the station's name");
      const fill = fillUpId ? await own(ctx, userId, fillUpId) : null;
      const id = await ctx.db.insert("stations", { userId, customName, lat: fill?.lat, lng: fill?.lng });
      if (fill) await ctx.db.patch("fillUps", fill._id, { stationId: id, stationSetBy: "user" });
      return id;
    });
  },
});

// ---- for convex/places.ts ----

export const forDetect = internalQuery({
  args: { fillUpId: v.id("fillUps") },
  handler: async (ctx, { fillUpId }) => {
    const f = await ctx.db.get(fillUpId);
    if (!f || f.deletedAt || f.stationId || f.stationSetBy === "user") return null;
    const stations = (await ctx.db.query("stations").withIndex("by_userId", (q) => q.eq("userId", f.userId)).take(MAX_STATIONS)).filter((s) => !s.deletedAt);
    return {
      userId: f.userId, lat: f.lat, lng: f.lng, accuracyM: f.accuracyM, bill: f.billStation ?? {},
      stations: stations.map((s) => ({ id: s._id, lat: s.lat, lng: s.lng })),
    };
  },
});

/** A Google place as it is handed over: its coordinates are never stored (Places policy), only the rider's own fix is. */
export const place = v.object({ placeId: v.string(), name: v.string(), address: v.optional(v.string()) });

/** The rider's station for a Google place: the one they have, or a new one. Its coordinates are the rider's own fix when there is one. */
async function stationForPlace(ctx: MutationCtx, userId: Id<"users">, p: { placeId: string; name: string; address?: string }, at: { lat?: number; lng?: number }, bill: { name?: string; brand?: string; address?: string }) {
  const have = await ctx.db.query("stations").withIndex("by_userId_and_placeId", (q) => q.eq("userId", userId).eq("placeId", p.placeId)).first();
  const google = { googleName: cut(p.name, 120), googleAddress: cut(p.address, 200), googleFetchedAt: Date.now() };
  if (have) {
    await ctx.db.patch("stations", have._id, { ...google, deletedAt: undefined, lat: have.lat ?? at.lat, lng: have.lng ?? at.lng, billName: have.billName ?? bill.name, billBrand: have.billBrand ?? bill.brand, billAddress: have.billAddress ?? bill.address });
    return have._id;
  }
  return await ctx.db.insert("stations", { userId, placeId: p.placeId, lat: at.lat, lng: at.lng, billName: bill.name, billBrand: bill.brand, billAddress: bill.address, ...google });
}

/**
 * Set a fill-up's station: one of the rider's own, a Google place, or (when Google had nothing but
 * the bill gave a name) a station by the bill's name. Detection (`by: "auto"`) never replaces a
 * station the rider chose.
 */
export const attach = internalMutation({
  args: {
    userId: v.id("users"),
    fillUpId: v.optional(v.id("fillUps")),
    by: v.union(v.literal("auto"), v.literal("user")),
    stationId: v.optional(v.id("stations")),
    place: v.optional(place),
  },
  handler: async (ctx, { userId, fillUpId, by, stationId, place: p }): Promise<Id<"stations"> | null> => {
    const fill = fillUpId ? await ctx.db.get(fillUpId) : null;
    if (fillUpId && (!fill || fill.userId !== userId || fill.deletedAt)) return null;
    if (fill && by === "auto" && (fill.stationId || fill.stationSetBy === "user")) return null;
    const bill = fill?.billStation ?? {};
    let id = stationId ?? null;
    if (id) {
      const s = await ctx.db.get(id);
      if (!s || s.userId !== userId) return null;
    } else if (p) {
      id = await stationForPlace(ctx, userId, p, { lat: fill?.lat, lng: fill?.lng }, bill);
    } else if (bill.name || bill.brand) {
      id = await ctx.db.insert("stations", { userId, lat: fill?.lat, lng: fill?.lng, billName: bill.name, billBrand: bill.brand, billAddress: bill.address });
    }
    if (id && fill) await ctx.db.patch("fillUps", fill._id, { stationId: id, stationSetBy: by });
    return id;
  },
});

export const forRefresh = internalQuery({
  args: { userId: v.id("users"), id: v.id("stations") },
  handler: async (ctx, { userId, id }) => {
    const s = await ctx.db.get(id);
    return s && s.userId === userId && s.placeId ? { placeId: s.placeId, googleFetchedAt: s.googleFetchedAt ?? 0 } : null;
  },
});

/** Google's current name for a station, or the news that the place is gone (its copy is dropped, the bill's name stays). */
export const saveRefresh = internalMutation({
  args: { id: v.id("stations"), name: v.optional(v.string()), address: v.optional(v.string()) },
  handler: async (ctx, { id, name, address }) => {
    if (!(await ctx.db.get(id))) return null;
    await ctx.db.patch("stations", id, { googleName: cut(name, 120), googleAddress: cut(address, 200), googleFetchedAt: Date.now() });
    return null;
  },
});
