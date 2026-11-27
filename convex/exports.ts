import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUserId } from "./lib/access";
import { minorToDecimalString } from "./lib/money";
import { stationName } from "./lib/stations";

/** Every complete fill-up as flat rows for a CSV, oldest first: one vehicle's, or all. */
export const rows = query({
  args: { vehicleId: v.optional(v.id("vehicles")) },
  handler: async (ctx, { vehicleId }) => {
    const userId = await requireUserId(ctx);
    const [fills, vehicles, stations] = await Promise.all([
      ctx.db.query("fillUps").withIndex("by_userId", (q) => q.eq("userId", userId)).take(3000),
      ctx.db.query("vehicles").withIndex("by_userId", (q) => q.eq("userId", userId)).take(50),
      ctx.db.query("stations").withIndex("by_userId", (q) => q.eq("userId", userId)).take(500),
    ]);
    const vehicle = new Map(vehicles.map((x) => [x._id, x]));
    const station = new Map(stations.map((x) => [x._id, x]));
    return fills
      .filter((f) => !f.deletedAt && f.status === "done" && (!vehicleId || f.vehicleId === vehicleId))
      .sort((a, b) => a.date.localeCompare(b.date) || a._creationTime - b._creationTime)
      .map((f) => {
        const s = f.stationId && station.get(f.stationId);
        return {
          date: f.date, time: f.time ?? "", vehicle: vehicle.get(f.vehicleId)?.name ?? "", fuel: vehicle.get(f.vehicleId)?.fuelType ?? "",
          odometerKm: f.odometerM === undefined ? "" : String(f.odometerM / 1000),
          quantity: ((f.quantityMilli ?? 0) / 1000).toFixed(3),
          amount: minorToDecimalString(f.amountMinor ?? 0, f.currency), currency: f.currency,
          fullTank: f.fullTank ? "yes" : "no", missedBefore: f.missedBefore ? "yes" : "no",
          station: s ? stationName(s) : "", latitude: f.lat === undefined ? "" : String(f.lat), longitude: f.lng === undefined ? "" : String(f.lng),
          note: f.note ?? "", source: f.source,
        };
      });
  },
});
