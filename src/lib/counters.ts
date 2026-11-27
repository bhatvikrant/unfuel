/**
 * The running totals of this session, for the superadmin dashboard (src/lib/usage.ts sends them,
 * convex/usage.ts adds what grew). Kept apart from usage.ts so the offline layer and the photo
 * code can count without importing React or Convex. Counts and sizes only.
 */
import { zeroCounts, type CountKey, type Counts } from "@convex/lib/admin";

let totals: Counts = zeroCounts();

export function bump(key: CountKey, by = 1): void {
  if (Number.isFinite(by) && by > 0) totals[key] += by;
}
export const counters = (): Counts => totals;
export function resetCounters(): void {
  totals = zeroCounts();
}
