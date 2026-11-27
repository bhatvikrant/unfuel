/**
 * Fuel stations from Google: Places API (New), plain REST. The key stays on the server, so there
 * is no Google script in the app. What may be kept is narrow (Places policy): a place ID for good,
 * a name only as a copy that is refetched (stations.googleFetchedAt), coordinates not at all, so
 * a station's position is always the rider's own GPS fix.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, env, internalAction, internalMutation, type ActionCtx } from "./_generated/server";
import { enforceLimit, withinLimit } from "./lib/rateLimit";
import { GOOGLE_NAME_TTL_MS, SAME_STATION_M, haversineM, nearestOwn, pickByText, pickStation, type Candidate, type LatLng } from "./lib/stations";

const BASE = "https://places.googleapis.com/v1";
const FIELDS = "id,displayName,shortFormattedAddress,location";
const LIST_FIELDS = FIELDS.split(",").map((f) => `places.${f}`).join(",");
/** Type-ahead results lean towards stations this near the fill-up. */
const SEARCH_BIAS_M = 20_000;

type GooglePlace = { id?: string; displayName?: { text?: string }; shortFormattedAddress?: string; location?: { latitude?: number; longitude?: number } };

const isPlaceId = (s: string) => /^[A-Za-z0-9_-]{10,300}$/.test(s);
const point = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });
function checkPoint(lat?: number, lng?: number): LatLng | null {
  if (lat === undefined || lng === undefined) return null;
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) throw new ConvexError("That location does not look right");
  return { lat, lng };
}

function toCandidate(p: GooglePlace, from: LatLng | null): Candidate | null {
  if (!p.id || !p.displayName?.text) return null;
  const at = p.location?.latitude !== undefined && p.location.longitude !== undefined ? { lat: p.location.latitude, lng: p.location.longitude } : null;
  return { placeId: p.id, name: p.displayName.text, address: p.shortFormattedAddress, distanceM: from && at ? Math.round(haversineM(from, at)) : undefined };
}

/** One call to Google: counted and limited first. Answers null when the app is over its limits or Google says no. */
export const spend = internalMutation({
  args: { userId: v.id("users"), sku: v.string(), limit: v.union(v.literal("placesSearch"), v.literal("placesDetect")), strict: v.boolean() },
  handler: async (ctx, { userId, sku, limit, strict }): Promise<boolean> => {
    if (strict) {
      await enforceLimit(ctx, limit, userId, "Station search");
      await enforceLimit(ctx, "placesDaily", undefined, "Station search");
    } else if (!(await withinLimit(ctx, limit, userId)) || !(await withinLimit(ctx, "placesDaily"))) return false;
    await ctx.runMutation(internal.usage.countPlaces, { userId, sku });
    return true;
  },
});

async function google<T>(ctx: ActionCtx, userId: Id<"users">, sku: string, limit: "placesSearch" | "placesDetect", strict: boolean, path: string, init: { body?: unknown; mask?: string }): Promise<T | null> {
  const key = env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  if (!(await ctx.runMutation(internal.places.spend, { userId, sku, limit, strict }))) return null;
  const res = await fetch(`${BASE}${path}`, {
    method: init.body ? "POST" : "GET",
    headers: { "X-Goog-Api-Key": key, "Content-Type": "application/json", ...(init.mask ? { "X-Goog-FieldMask": init.mask } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    console.error("places failed", sku, res.status, (await res.text()).slice(0, 300));
    if (strict) throw new ConvexError("Station search is not available right now");
    return null;
  }
  return (await res.json()) as T;
}

async function nearbyOf(ctx: ActionCtx, userId: Id<"users">, at: LatLng, radius: number, limit: "placesSearch" | "placesDetect", strict: boolean): Promise<Candidate[]> {
  const data = await google<{ places?: GooglePlace[] }>(ctx, userId, "nearby", limit, strict, "/places:searchNearby", {
    mask: LIST_FIELDS,
    body: { includedTypes: ["gas_station"], maxResultCount: 5, rankPreference: "DISTANCE", locationRestriction: { circle: { center: point(at), radius } } },
  });
  return (data?.places ?? []).map((p) => toCandidate(p, at)).filter((c): c is Candidate => !!c);
}

async function requireUserId(ctx: ActionCtx): Promise<Id<"users">> {
  const id = await getAuthUserId(ctx);
  if (!id) throw new ConvexError("You need to be signed in");
  return id;
}

/** Fuel stations around a point, nearest first: the drop-down's "Nearby" list. */
export const nearby = action({
  args: { lat: v.number(), lng: v.number() },
  handler: async (ctx, { lat, lng }): Promise<Candidate[]> => {
    const userId = await requireUserId(ctx);
    return await nearbyOf(ctx, userId, checkPoint(lat, lng)!, 1000, "placesSearch", true);
  },
});

type Suggestion = { placePrediction?: { placeId?: string; distanceMeters?: number; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } };

/** Fuel stations by name as the rider types, leaning towards the fill-up's location. */
export const search = action({
  args: { text: v.string(), lat: v.optional(v.number()), lng: v.optional(v.number()), sessionToken: v.string() },
  handler: async (ctx, { text, lat, lng, sessionToken }): Promise<Candidate[]> => {
    const userId = await requireUserId(ctx);
    const input = text.trim().slice(0, 80);
    if (input.length < 3 || !/^[A-Za-z0-9_-]{8,64}$/.test(sessionToken)) return [];
    const at = checkPoint(lat, lng);
    const data = await google<{ suggestions?: Suggestion[] }>(ctx, userId, "autocomplete", "placesSearch", true, "/places:autocomplete", {
      body: { input, includedPrimaryTypes: ["gas_station"], sessionToken, ...(at ? { locationBias: { circle: { center: point(at), radius: SEARCH_BIAS_M } }, origin: point(at) } : {}) },
    });
    return (data?.suggestions ?? []).flatMap((s) => {
      const p = s.placePrediction;
      const name = p?.structuredFormat?.mainText?.text ?? p?.text?.text;
      return p?.placeId && name ? [{ placeId: p.placeId, name, address: p.structuredFormat?.secondaryText?.text, distanceM: p.distanceMeters }] : [];
    });
  },
});

/** The rider picked a Google place in the drop-down: make it the fill-up's station (or just one of theirs). */
export const choose = action({
  args: { fillUpId: v.optional(v.id("fillUps")), placeId: v.string(), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { fillUpId, placeId, sessionToken }): Promise<Id<"stations"> | null> => {
    const userId = await requireUserId(ctx);
    if (!isPlaceId(placeId)) throw new ConvexError("That station could not be found");
    const session = sessionToken && /^[A-Za-z0-9_-]{8,64}$/.test(sessionToken) ? `?sessionToken=${sessionToken}` : "";
    const p = await google<GooglePlace>(ctx, userId, "details", "placesSearch", true, `/places/${placeId}${session}`, { mask: FIELDS });
    const c = p && toCandidate(p, null);
    if (!c) throw new ConvexError("That station could not be found");
    return await ctx.runMutation(internal.stations.attach, { userId, fillUpId, by: "user", place: { placeId: c.placeId, name: c.name, address: c.address } });
  },
});

/**
 * Find the station of a saved fill-up without asking (scheduled by convex/fillUps.ts, so it also
 * covers fill-ups that were captured offline). One of the rider's own stations nearby wins with no
 * call to Google; otherwise Google's results are taken only when it is clear which one it was.
 */
export const detect = internalAction({
  args: { fillUpId: v.id("fillUps") },
  handler: async (ctx, { fillUpId }): Promise<null> => {
    const job = await ctx.runQuery(internal.stations.forDetect, { fillUpId });
    if (!job) return null;
    const at = checkPoint(job.lat, job.lng);
    const attach = (to: { stationId?: Id<"stations">; place?: { placeId: string; name: string; address?: string } }) =>
      ctx.runMutation(internal.stations.attach, { userId: job.userId, fillUpId, by: "auto", ...to });
    const mine = at && nearestOwn(job.stations, at);
    if (mine) { await attach({ stationId: mine.id }); return null; }

    let picked: Candidate | null = null;
    if (at) {
      const radius = Math.min(500, Math.max(SAME_STATION_M, job.accuracyM ?? 0));
      picked = pickStation(await nearbyOf(ctx, job.userId, at, radius, "placesDetect", false), job.bill);
    } else if (job.bill.name) {
      const data = await google<{ places?: GooglePlace[] }>(ctx, job.userId, "text", "placesDetect", false, "/places:searchText", {
        mask: LIST_FIELDS,
        body: { textQuery: [job.bill.brand, job.bill.name, job.bill.address].filter(Boolean).join(" "), includedType: "gas_station", pageSize: 5 },
      });
      picked = pickByText((data?.places ?? []).map((p) => toCandidate(p, null)).filter((c): c is Candidate => !!c), job.bill);
    }
    // Google had nothing clear: the bill's own name still makes a station, so the fill-up is not left nameless
    await attach(picked ? { place: { placeId: picked.placeId, name: picked.name, address: picked.address } } : {});
    return null;
  },
});

/** Refetch Google's name for a station whose copy is older than 30 days. Called when a station is shown. */
export const refresh = action({
  args: { id: v.id("stations") },
  handler: async (ctx, { id }): Promise<null> => {
    const userId = await requireUserId(ctx);
    const s = await ctx.runQuery(internal.stations.forRefresh, { userId, id });
    if (!s || Date.now() - s.googleFetchedAt < GOOGLE_NAME_TTL_MS) return null;
    const p = await google<GooglePlace>(ctx, userId, "details", "placesDetect", false, `/places/${s.placeId}`, { mask: FIELDS });
    if (p) await ctx.runMutation(internal.stations.saveRefresh, { id, name: p.displayName?.text, address: p.shortFormattedAddress });
    return null;
  },
});
