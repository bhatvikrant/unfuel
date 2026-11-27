/**
 * Application-level rate limits (the @convex-dev/rate-limiter component): the things any signed-in
 * account can make cost money or storage. AI reads have their own monthly cap (convex/usage.ts claimAi).
 */
import { ConvexError } from "convex/values";
import { DAY, HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Photo uploads, per user.
  upload: { kind: "token bucket", rate: 60, period: HOUR, capacity: 20 },
  // Google Places: the drop-down's searches and the detection after a save, per user.
  placesSearch: { kind: "token bucket", rate: 120, period: HOUR, capacity: 30 },
  placesDetect: { kind: "token bucket", rate: 30, period: HOUR, capacity: 10 },
  // Every Places call the whole app makes in a day (no key): a ceiling on the Google bill.
  placesDaily: { kind: "fixed window", rate: 2000, period: DAY },
});

type Name = "upload" | "placesSearch" | "placesDetect" | "placesDaily";
type Ctx = Parameters<typeof rateLimiter.limit>[0];

function describe(ms: number): string {
  if (ms < MINUTE) return "a minute";
  if (ms < HOUR) return `${Math.ceil(ms / MINUTE)} minutes`;
  const h = Math.ceil(ms / HOUR);
  return h === 1 ? "an hour" : `${h} hours`;
}

/** Consumes one unit of `name` for `key`, or throws a ConvexError with a human message. */
export async function enforceLimit(ctx: Ctx, name: Name, key: string | undefined, what: string): Promise<void> {
  const { ok, retryAfter } = await rateLimiter.limit(ctx, name, key ? { key } : {});
  if (!ok) throw new ConvexError(`${what} limit reached. Try again in ${describe(retryAfter)}.`);
}

/** The same, answering false instead of throwing: for background work that should just skip. */
export async function withinLimit(ctx: Ctx, name: Name, key?: string): Promise<boolean> {
  return (await rateLimiter.limit(ctx, name, key ? { key } : {})).ok;
}
