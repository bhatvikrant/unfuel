/**
 * Reading a fill-up's photos with Claude. Scheduled by fillUps.createFromPhotos, so the read happens
 * on the server whether or not the app is still open. The rules (prompt, answer shape, checks) are
 * in convex/lib/fuelRead.ts; this file only fetches the photos, makes the call, counts it and
 * writes the result. Only for accounts the superadmin turned AI on for, at most READ_MONTHLY_CAP
 * fill-ups a month each.
 */
import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalAction } from "./_generated/server";
import { AI_MODEL, READ_MONTHLY_CAP, isPhotoMediaType, readRequest, validateRead, type PhotoMediaType } from "./lib/fuelRead";

/** A failed call is tried again after these waits, then the fill-up is left to be typed. */
const RETRY_AFTER_MS = [60_000, 600_000, 3_600_000];

function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const NO_TOKENS = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

export const readFillUp = internalAction({
  args: { fillUpId: v.id("fillUps") },
  handler: async (ctx, { fillUpId }): Promise<null> => {
    const today = new Date().toISOString().slice(0, 10);
    const job = await ctx.runQuery(internal.fillUps.readContext, { fillUpId, today });
    if (!job) return null;
    const fail = (issue: string) => ctx.runMutation(internal.fillUps.applyRead, { fillUpId, fields: {}, kinds: {}, printed: {}, issues: [issue] });
    const key = env.ANTHROPIC_API_KEY;
    if (!job.allowed || !key) { await fail("aiOff"); return null; }
    const model = env.ANTHROPIC_MODEL ?? AI_MODEL;
    const readId: Id<"aiReads"> | null = await ctx.runMutation(internal.usage.claimAi, { userId: job.userId, fillUpId, model, cap: READ_MONTHLY_CAP });
    if (!readId) { await fail("capReached"); return null; }
    const record = (outcome: "saved" | "review" | "unreadable" | "error" | "refused", more: { issues?: string[]; kinds?: Record<string, number>; res?: Anthropic.Message; latencyMs?: number } = {}) =>
      ctx.runMutation(internal.usage.recordAi, {
        readId, model: more.res?.model ?? model, outcome, issues: more.issues ?? [], kinds: more.kinds ?? {}, latencyMs: more.latencyMs ?? 0,
        tokens: more.res ? { input: more.res.usage.input_tokens, output: more.res.usage.output_tokens, cacheWrite: more.res.usage.cache_creation_input_tokens ?? 0, cacheRead: more.res.usage.cache_read_input_tokens ?? 0 } : NO_TOKENS,
      });

    const photos: { mediaType: PhotoMediaType; base64: string }[] = [];
    for (const id of job.photoIds) {
      const blob = await ctx.storage.get(id);
      if (blob && isPhotoMediaType(blob.type)) photos.push({ mediaType: blob.type, base64: toB64(new Uint8Array(await blob.arrayBuffer())) });
    }
    if (!photos.length) { await record("unreadable", { issues: ["unreadable"] }); await fail("unreadable"); return null; }

    const started = Date.now();
    let res: Anthropic.Message;
    try {
      res = await new Anthropic({ apiKey: key }).messages.create(readRequest(model, job.context, photos));
    } catch (e) {
      // a request the API will never accept (bad key, bad request) is not tried again; anything else is
      const final = e instanceof Anthropic.APIError && e.status !== undefined && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 409 && e.status !== 429;
      console.error("read-ai failed", e instanceof Error ? e.message : e);
      await record("error", { issues: ["error"], latencyMs: Date.now() - started });
      const wait = RETRY_AFTER_MS[job.attempts];
      if (final || wait === undefined) { await fail("error"); return null; }
      await ctx.runMutation(internal.fillUps.bumpAttempts, { fillUpId });
      await ctx.scheduler.runAfter(wait, internal.ai.readFillUp, { fillUpId });
      return null;
    }
    const latencyMs = Date.now() - started;
    console.log("read-ai", { userId: job.userId, stop: res.stop_reason, input: res.usage.input_tokens, output: res.usage.output_tokens, ms: latencyMs });

    // a refused or cut-off answer is billed too, so it is recorded before it is checked
    if (res.stop_reason === "refusal") { await record("refused", { issues: ["refused"], res, latencyMs }); await fail("refused"); return null; }
    let raw: unknown = null;
    if (res.stop_reason !== "max_tokens") {
      try {
        const text = res.content.find((b) => b.type === "text");
        raw = text ? JSON.parse(text.text) : null;
      } catch {
        raw = null;
      }
    }
    const result = validateRead(raw, job.context);
    const status = await ctx.runMutation(internal.fillUps.applyRead, { fillUpId, model: res.model, ...result });
    await record(result.issues.includes("unreadable") ? "unreadable" : status === "done" ? "saved" : "review", { issues: result.issues, kinds: result.kinds, res, latencyMs });
    return null;
  },
});
