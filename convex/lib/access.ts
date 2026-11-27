import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isSuperadmin } from "./admin";

export type Ctx = QueryCtx | MutationCtx;

/**
 * The signed-in user, or null. A token outlives its user for up to its expiry, so a user deleted
 * (Delete account) counts as signed out at once.
 */
export async function currentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const id = await getAuthUserId(ctx);
  return id ? await ctx.db.get(id) : null;
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await currentUser(ctx);
  if (!user) throw new ConvexError("You need to be signed in");
  return user;
}

export async function requireUserId(ctx: Ctx): Promise<Id<"users">> {
  return (await requireUser(ctx))._id;
}

/** Whether a user may have photos read by AI: off until the superadmin turns it on (admin.setAi); the superadmin always may. */
export const aiAllowed = (user: Doc<"users"> | null): boolean => !!user && (!!user.aiEnabled || isSuperadmin(user.email));

export async function requireSuperadmin(ctx: Ctx): Promise<Id<"users">> {
  const user = await currentUser(ctx);
  if (!user || !isSuperadmin(user.email)) throw new ConvexError("Not allowed");
  return user._id;
}

/** A document of the caller's, or an error: nobody reads or writes another account's rows. */
export async function own<T extends "vehicles" | "fillUps" | "stations">(ctx: Ctx, userId: Id<"users">, id: Id<T>): Promise<Doc<T>> {
  const doc = (await ctx.db.get(id)) as Doc<"vehicles" | "fillUps" | "stations"> | null;
  if (!doc || doc.userId !== userId) throw new ConvexError("Not found");
  return doc as unknown as Doc<T>;
}
