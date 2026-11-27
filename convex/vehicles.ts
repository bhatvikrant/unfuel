import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { own, requireUserId } from "./lib/access";
import { idempotent } from "./lib/idempotency";
import { fuelType, vehicleKind } from "./schema";
import { ensureSettings } from "./settings";

/** A rider has a handful of vehicles; this is far more than anyone keeps. */
const MAX_VEHICLES = 50;

const cleanName = (name: string) => {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!n) throw new ConvexError("Give the vehicle a name");
  return n;
};
const cleanTank = (tankMilli: number | undefined | null) => {
  if (tankMilli === undefined || tankMilli === null) return undefined;
  if (!Number.isInteger(tankMilli) || tankMilli <= 0 || tankMilli > 1_000_000) throw new ConvexError("That tank size does not look right");
  return tankMilli;
};

/**
 * The vehicle a new fill-up goes to: the one named, else the current one, else the first, else a
 * new "My vehicle". The first session is photos only, so nobody is asked to set a vehicle up first.
 */
export async function vehicleFor(ctx: MutationCtx, userId: Id<"users">, vehicleId?: Id<"vehicles">): Promise<Id<"vehicles">> {
  if (vehicleId) return (await own(ctx, userId, vehicleId))._id;
  const settings = await ensureSettings(ctx, userId);
  const current = settings.currentVehicleId && (await ctx.db.get(settings.currentVehicleId));
  if (current && !current.deletedAt) return current._id;
  const first = (await ctx.db.query("vehicles").withIndex("by_userId", (q) => q.eq("userId", userId)).take(MAX_VEHICLES)).find((x) => !x.deletedAt);
  const id = first?._id ?? (await ctx.db.insert("vehicles", { userId, name: "My vehicle", kind: "bike", fuelType: "petrol", order: 0 }));
  await ctx.db.patch("settings", settings._id, { currentVehicleId: id });
  return id;
}

/** Every vehicle of the user, archived ones included (they still own fill-ups), in their order. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db.query("vehicles").withIndex("by_userId", (q) => q.eq("userId", userId)).take(MAX_VEHICLES);
    return rows.sort((a, b) => a.order - b.order || a._creationTime - b._creationTime);
  },
});

export const create = mutation({
  args: { name: v.string(), kind: vehicleKind, fuelType, tankMilli: v.optional(v.number()), clientKey: v.optional(v.string()) },
  handler: async (ctx, { clientKey, ...args }) => {
    const userId = await requireUserId(ctx);
    return await idempotent(ctx, userId, clientKey, async () => {
      const rows = await ctx.db.query("vehicles").withIndex("by_userId", (q) => q.eq("userId", userId)).take(MAX_VEHICLES);
      if (rows.length >= MAX_VEHICLES) throw new ConvexError("That is the most vehicles an account can have");
      const id = await ctx.db.insert("vehicles", { userId, name: cleanName(args.name), kind: args.kind, fuelType: args.fuelType, tankMilli: cleanTank(args.tankMilli), order: rows.length });
      const settings = await ensureSettings(ctx, userId);
      await ctx.db.patch("settings", settings._id, { currentVehicleId: id });
      return id;
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("vehicles"),
    name: v.optional(v.string()),
    kind: v.optional(vehicleKind),
    fuelType: v.optional(fuelType),
    tankMilli: v.optional(v.union(v.number(), v.null())),
    clientKey: v.optional(v.string()),
  },
  handler: async (ctx, { id, clientKey: _clientKey, name, tankMilli, ...rest }) => {
    const userId = await requireUserId(ctx);
    await own(ctx, userId, id);
    await ctx.db.patch("vehicles", id, {
      ...rest,
      ...(name !== undefined ? { name: cleanName(name) } : {}),
      ...(tankMilli !== undefined ? { tankMilli: cleanTank(tankMilli) } : {}),
    });
    return null;
  },
});

/** Archive (its fill-ups stay) or bring back. The current vehicle moves on when it is archived. */
export const setArchived = mutation({
  args: { id: v.id("vehicles"), archived: v.boolean(), clientKey: v.optional(v.string()) },
  handler: async (ctx, { id, archived }) => {
    const userId = await requireUserId(ctx);
    await own(ctx, userId, id);
    await ctx.db.patch("vehicles", id, { deletedAt: archived ? Date.now() : undefined });
    const settings = await ensureSettings(ctx, userId);
    if (archived && settings.currentVehicleId === id) {
      await ctx.db.patch("settings", settings._id, { currentVehicleId: undefined });
      await vehicleFor(ctx, userId);
    }
    return null;
  },
});

/** Called once after sign-in: a new account gets "My vehicle" straight away, so a fill-up made offline later has somewhere to go. */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    return await vehicleFor(ctx, await requireUserId(ctx));
  },
});
