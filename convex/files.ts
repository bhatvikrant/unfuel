/**
 * Photo uploads. Convex cannot look at an upload before it lands, so the check is here: every
 * upload must be claimed before a fill-up may point at it, and a claim deletes anything that is
 * not an optimised image (src/lib/image.ts shrinks every photo on the device first).
 */
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";
import { requireUserId } from "./lib/access";
import { PHOTO_MAX_BYTES, isPhotoMediaType } from "./lib/fuelRead";
import { enforceLimit } from "./lib/rateLimit";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    await enforceLimit(ctx, "upload", userId, "Upload");
    return await ctx.storage.generateUploadUrl();
  },
});

/** How soon after an upload it must be claimed: nobody can take over an older file whose id they learnt. */
const CLAIM_WINDOW_MS = 60 * 60 * 1000;

/**
 * Called right after an upload: checks it is an image of the allowed size and records who owns it.
 * A file that is not is deleted and "refused" is answered, not thrown: an error would roll the
 * delete back with the rest of the transaction and leave the file where it is.
 */
export const claim = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<"ok" | "refused"> => {
    const userId = await requireUserId(ctx);
    const owner = await ctx.db.query("fileOwners").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).unique();
    if (owner) {
      if (owner.userId !== userId) throw new ConvexError("That file belongs to someone else");
      return "ok";
    }
    const file = await ctx.db.system.get("_storage", storageId);
    if (!file) throw new ConvexError("File not found");
    if (Date.now() - file._creationTime > CLAIM_WINDOW_MS) throw new ConvexError("That file can no longer be claimed");
    if (!isPhotoMediaType(file.contentType ?? "") || file.size > PHOTO_MAX_BYTES) {
      await ctx.storage.delete(storageId);
      return "refused";
    }
    await ctx.db.insert("fileOwners", { storageId, userId });
    return "ok";
  },
});

const SWEEP_AFTER_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 200;

/** Daily cron: an upload nobody claimed within a day is deleted, oldest first. */
export const sweepUnclaimed = internalMutation({
  args: { after: v.optional(v.number()) },
  handler: async (ctx, { after }) => {
    const cutoff = Date.now() - SWEEP_AFTER_MS;
    // the walk goes up from `after`, so files that have an owner are passed once, not on every batch
    const files = await ctx.db.system.query("_storage").withIndex("by_creation_time", (q) => q.gt("_creationTime", after ?? 0).lt("_creationTime", cutoff)).take(SWEEP_BATCH);
    for (const f of files) {
      const owner = await ctx.db.query("fileOwners").withIndex("by_storageId", (q) => q.eq("storageId", f._id)).unique();
      if (!owner) await ctx.storage.delete(f._id);
    }
    if (files.length === SWEEP_BATCH) await ctx.scheduler.runAfter(0, internal.files.sweepUnclaimed, { after: files[files.length - 1]._creationTime });
    return null;
  },
});
