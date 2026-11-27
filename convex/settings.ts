import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { env, mutation, query, type MutationCtx } from "./_generated/server";
import { requireUserId, type Ctx } from "./lib/access";
import { CURRENCY_CODES } from "./lib/currencies";

export const DEFAULTS = { currency: "INR", efficiencyUnit: "km/l", theme: "system", fullTankDefault: false } as const;

export async function settingsOf(ctx: Ctx, userId: Id<"users">): Promise<Doc<"settings"> | null> {
  return await ctx.db.query("settings").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
}

/** The user's settings row, made with the defaults the first time something is written. */
export async function ensureSettings(ctx: MutationCtx, userId: Id<"users">): Promise<Doc<"settings">> {
  const row = await settingsOf(ctx, userId);
  if (row) return row;
  const id = await ctx.db.insert("settings", { userId, ...DEFAULTS });
  return (await ctx.db.get(id))!;
}

/** The hosts an UnMoney link may point at: only UnMoney's own, so the server never posts a rider's fill-ups anywhere else. */
const unmoneyHosts = () => (env.UNMONEY_HOSTS ?? "brilliant-cheetah-609.convex.site").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

/**
 * `https://<an UnMoney host>/unfuel/<token>`, or an error saying what is wrong with it. Plain http is
 * taken only for this machine's own address and only when UNMONEY_HOSTS lists it: that is a local
 * UnMoney beside a local Unfuel, for testing the two together. A cloud deployment never lists one.
 */
export function checkUnmoneyUrl(text: string): string {
  let url: URL;
  try { url = new URL(text.trim()); } catch { throw new ConvexError("That is not a link"); }
  const loopback = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (!(url.protocol === "https:" || loopback) || !unmoneyHosts().includes(url.host.toLowerCase())) throw new ConvexError("That is not an UnMoney link");
  if (!/^\/unfuel\/[A-Za-z0-9_-]{16,128}$/.test(url.pathname) || url.search || url.hash) throw new ConvexError("That UnMoney link is not complete");
  return url.toString();
}

/** Settings as the app sees them: the UnMoney link is a secret, so only its last four characters come back. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const s = await settingsOf(ctx, userId);
    return {
      currency: s?.currency ?? DEFAULTS.currency,
      efficiencyUnit: s?.efficiencyUnit ?? DEFAULTS.efficiencyUnit,
      theme: s?.theme ?? DEFAULTS.theme,
      fullTankDefault: s?.fullTankDefault ?? DEFAULTS.fullTankDefault,
      currentVehicleId: s?.currentVehicleId ?? null,
      unmoney: s?.unmoney ? { tail: s.unmoney.url.slice(-4), auto: s.unmoney.auto } : null,
    };
  },
});

export const update = mutation({
  args: {
    currency: v.optional(v.string()),
    efficiencyUnit: v.optional(v.union(v.literal("km/l"), v.literal("l/100km"))),
    theme: v.optional(v.union(v.literal("system"), v.literal("light"), v.literal("dark"))),
    fullTankDefault: v.optional(v.boolean()),
    currentVehicleId: v.optional(v.id("vehicles")),
    clientKey: v.optional(v.string()),
  },
  handler: async (ctx, { clientKey: _clientKey, ...args }) => {
    const userId = await requireUserId(ctx);
    const row = await ensureSettings(ctx, userId);
    if (args.currency !== undefined && !CURRENCY_CODES.has(args.currency)) throw new ConvexError("Unknown currency");
    if (args.currentVehicleId) {
      const vehicle = await ctx.db.get(args.currentVehicleId);
      if (!vehicle || vehicle.userId !== userId || vehicle.deletedAt) throw new ConvexError("Vehicle not found");
    }
    await ctx.db.patch("settings", row._id, args);
    return null;
  },
});

/** Save or clear the UnMoney link and whether every fill-up is sent (convex/unmoney.ts). */
export const setUnmoney = mutation({
  args: { url: v.optional(v.string()), auto: v.optional(v.boolean()), clear: v.optional(v.boolean()) },
  handler: async (ctx, { url, auto, clear }) => {
    const userId = await requireUserId(ctx);
    const row = await ensureSettings(ctx, userId);
    if (clear) { await ctx.db.patch("settings", row._id, { unmoney: undefined }); return null; }
    const link = url !== undefined ? checkUnmoneyUrl(url) : row.unmoney?.url;
    if (!link) throw new ConvexError("Paste your UnMoney link first");
    await ctx.db.patch("settings", row._id, { unmoney: { url: link, auto: auto ?? row.unmoney?.auto ?? false } });
    return null;
  },
});
