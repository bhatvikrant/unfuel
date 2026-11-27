/**
 * Delete my account: every document, stored photo and sign-in record of the user, removed in
 * scheduled batches so even a long log stays within Convex's per-function limits. (UnMoney's scheme.)
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { requireUserId } from "./lib/access";

const BATCH = 500;
type Row = { _id: string; storageId?: Id<"_storage"> };

/** Each step: up to BATCH of the user's documents, and what else to remove with each. */
const STEPS: { take: (ctx: MutationCtx, userId: Id<"users">) => Promise<Row[]>; also?: (ctx: MutationCtx, doc: Row) => Promise<void> }[] = [
  ...(["fillUps", "vehicles", "stations", "settings", "adminStats"] as const).map((t) => ({
    take: (ctx: MutationCtx, u: Id<"users">) => ctx.db.query(t).withIndex("by_userId", (q) => q.eq("userId", u)).take(BATCH),
  })),
  { take: (ctx, u) => ctx.db.query("fileOwners").withIndex("by_userId", (q) => q.eq("userId", u)).take(BATCH),
    also: async (ctx, d) => { try { if (d.storageId) await ctx.storage.delete(d.storageId); } catch { /* already gone */ } } },
  { take: (ctx, u) => ctx.db.query("idempotencyKeys").withIndex("by_user_key", (q) => q.eq("userId", u)).take(BATCH) },
  ...(["aiReads", "placesCalls", "usageDaily"] as const).map((t) => ({
    take: (ctx: MutationCtx, u: Id<"users">) => ctx.db.query(t).withIndex("by_userId_and_day", (q) => q.eq("userId", u)).take(BATCH),
  })),
  { take: (ctx, u) => ctx.db.query("usageSessions").withIndex("by_userId_and_startedAt", (q) => q.eq("userId", u)).take(BATCH) },
  { take: (ctx, u) => ctx.db.query("usageDevices").withIndex("by_userId_and_deviceId", (q) => q.eq("userId", u)).take(BATCH) },
  { take: (ctx, u) => ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", u)).take(BATCH),
    also: async (ctx, d) => {
      for (const c of await ctx.db.query("authVerificationCodes").withIndex("accountId", (q) => q.eq("accountId", d._id as Id<"authAccounts">)).take(BATCH)) await ctx.db.delete(c._id);
    } },
  { take: (ctx, u) => ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", u)).take(BATCH),
    also: async (ctx, d) => {
      for (const t of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", d._id as Id<"authSessions">)).take(BATCH)) await ctx.db.delete(t._id);
    } },
];

export const remove = mutation({
  args: { confirm: v.literal("DELETE") },
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    // gone at once: from now every call with this user's token is refused (lib/access currentUser)
    await ctx.db.delete(userId);
    await ctx.scheduler.runAfter(0, internal.account.purge, { userId, step: 0 });
    return null;
  },
});

export const purge = internalMutation({
  args: { userId: v.id("users"), step: v.number() },
  handler: async (ctx, { userId, step }) => {
    if (step >= STEPS.length) return null;
    const { take, also } = STEPS[step];
    const docs = await take(ctx, userId);
    for (const d of docs) {
      if (also) await also(ctx, d);
      await ctx.db.delete(d._id as Id<"fillUps">);
    }
    await ctx.scheduler.runAfter(0, internal.account.purge, { userId, step: docs.length === BATCH ? step : step + 1 });
    return null;
  },
});
