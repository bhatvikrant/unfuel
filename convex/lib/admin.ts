/**
 * The superadmin dashboard (/admin, src/pages/admin) and the usage counts behind it (convex/usage.ts,
 * convex/admin.ts). Only this address can open the page or call its functions; for everyone else the
 * page's code is never downloaded. A constant, not an environment variable: the app needs it too,
 * to decide whether to load the page. Same scheme and address as UnMoney.
 */
export const SUPERADMIN_EMAIL = "vik.bhat223@gmail.com";

export const isSuperadmin = (email: string | null | undefined) => !!email && email.toLowerCase() === SUPERADMIN_EMAIL;

/**
 * A screen's name for the usage counts: its path with ids and other values taken out, so every entry
 * counts as "fill/:id" and the counts stay a short list. "/" is home.
 */
export function screenKey(pathname: string): string {
  // no screen's own name has a digit: Convex ids, tmp ids, period keys like 2026-10 all do
  const parts = pathname.split("/").filter(Boolean).map((p) => (/\d/.test(p) ? ":id" : p));
  return parts.length ? parts.join("/").slice(0, 60) : "home";
}

/** Session length buckets, by time the app was on screen. Labels are what the dashboard shows. */
export const LENGTH_BUCKETS = [
  { key: "lt10s", label: "< 10s", upTo: 10_000 },
  { key: "lt30s", label: "10–30s", upTo: 30_000 },
  { key: "lt1m", label: "30s–1m", upTo: 60_000 },
  { key: "lt3m", label: "1–3m", upTo: 180_000 },
  { key: "lt10m", label: "3–10m", upTo: 600_000 },
  { key: "lt30m", label: "10–30m", upTo: 1_800_000 },
  { key: "gte30m", label: "30m+", upTo: Infinity },
] as const;

export function lengthBucket(activeMs: number): string {
  return LENGTH_BUCKETS.find((b) => activeMs < b.upTo)!.key;
}

/** YYYY-MM-DD of an instant, at a UTC offset in minutes (east positive). */
export function dayAt(ms: number, offsetMin: number): string {
  return new Date(ms + offsetMin * 60_000).toISOString().slice(0, 10);
}

/** The hour 0–23 of an instant, at a UTC offset in minutes. */
export function hourAt(ms: number, offsetMin: number): number {
  return new Date(ms + offsetMin * 60_000).getUTCHours();
}

/**
 * The running totals a session reports (src/lib/usage.ts) and a day sums up (convex/usage.ts ping).
 * A new count is added here and nowhere else.
 */
export const COUNT_KEYS = [
  "activeMs", "bytesDown", "bytesUp", "photoFetches", "opsSent",
  // offline: changes made with no connection, how long the oldest waited, and any the server refused
  "opsQueuedOffline", "queueWaitMs", "opsRejected",
  // photos read on the device (src/lib/ocr.ts): reads, fields it filled, and fields the rider kept as filled
  "deviceReads", "deviceFieldsFound", "deviceFieldsKept",
  // photo sizes before and after optimising (src/lib/image.ts), and how many
  "photos", "photoBytesBefore", "photoBytesAfter",
] as const;
export type CountKey = (typeof COUNT_KEYS)[number];
export type Counts = Record<CountKey, number>;
export const zeroCounts = (): Counts => Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])) as Counts;
