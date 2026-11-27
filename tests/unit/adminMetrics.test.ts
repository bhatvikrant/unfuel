import { expect, test } from "vitest";
import { aiByModel, aiTotals, applyFilters, cohorts, count, daySeries, fmtUsd, monthProjection, placesTotals, readQuality, streaks, sumOf, usageGap, userRows, type Ai, type Daily, type Overview } from "@/pages/admin/metrics";

const day = (userId: string, d: string, totals: Record<string, number> = {}, opens = 1): Daily => ({ userId, deviceId: "d1", day: d, opens, totals, hours: { h9: opens }, screens: { home: opens }, lengths: {} } as unknown as Daily);
const read = (userId: string, d: string, more: Partial<Ai> = {}): Ai => ({
  id: `${userId}-${d}-${Math.random()}`, _creationTime: 0, userId, day: d, feature: "read", model: "claude-haiku-5-5", attempts: 1, outcome: "saved", issues: [], corrected: [], kinds: { bill: 1, odometer: 1 },
  inputTokens: 4000, outputTokens: 500, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0.001, latencyMs: 2000, ...more,
} as unknown as Ai);
const user = (id: string, joinedAt: number, ai = false) => ({ id, name: id, email: `${id}@x`, image: null, joinedAt, lastSyncAt: null, ai });
const device = (userId: string, os = "Android", standalone = true) => ({ userId, deviceId: "d1", os, browser: "Chrome", formFactor: "phone", standalone, appVersion: "v1", tzOffset: 330, sessions: 1, firstSeenAt: 0, lastSeenAt: 1000 });

test("a day's counts read as zero when an older build never sent them", () => {
  const rows = [day("a", "2026-11-01", { activeMs: 60_000, opsSent: 2 }), day("a", "2026-11-02", { activeMs: 30_000 })];
  expect(count(rows[1], "opsSent")).toBe(0);
  expect(sumOf(rows, "activeMs")).toBe(90_000);
  expect(sumOf(rows, "photoBytesBefore")).toBe(0);
});

test("filters narrow usage by device and everything else by user", () => {
  const o = {
    users: [user("a", 0), user("b", 0), user("me", 0)], devices: [device("a"), device("b", "iOS", false), device("me")],
    daily: [day("a", "2026-11-01"), day("b", "2026-11-01"), day("me", "2026-11-01")], stats: [], ai: [read("a", "2026-11-01"), read("b", "2026-11-01")], places: [{ userId: "b", day: "2026-11-01", sku: "nearby", calls: 3 }],
    truncated: false, now: 0,
  } as unknown as Overview;
  const all = applyFilters(o, { days: 30, userId: "all", os: "all", mode: "all", includeMe: false }, "me");
  expect(all.users.map((u) => u.id)).toEqual(["a", "b"]);
  const ios = applyFilters(o, { days: 30, userId: "all", os: "iOS", mode: "all", includeMe: true }, "me");
  expect(ios.users.map((u) => u.id)).toEqual(["b"]);
  expect(ios.daily).toHaveLength(1);
  expect(ios.ai.map((r) => r.userId)).toEqual(["b"]);
  expect(ios.places).toHaveLength(1);
});

test("one point per day, zeros where nothing happened", () => {
  const v = { users: [user("a", new Date(2026, 10, 2).getTime())], devices: [], daily: [day("a", "2026-11-01", { activeMs: 120_000, bytesDown: 10 }, 2)], stats: [], ai: [], places: [] } as never;
  const s = daySeries(v, "2026-11-01", "2026-11-03");
  expect(s.map((p) => [p.day, p.activeUsers, p.opens, p.activeMin, p.signups])).toEqual([["2026-11-01", 1, 2, 2, 0], ["2026-11-02", 0, 0, 0, 1], ["2026-11-03", 0, 0, 0, 0]]);
});

test("what reads cost, by user and by model", () => {
  const rows = [read("a", "2026-11-01", { costUsd: 0.002 }), read("a", "2026-11-03", { costUsd: 0.004, model: "claude-sonnet-5-5" }), read("b", "2026-11-02", { costUsd: 0.001 })];
  expect(aiTotals(rows)).toMatchObject({ calls: 3, users: 2, lastDay: "2026-11-03", readCalls: 3 });
  expect(aiTotals(rows).costUsd).toBeCloseTo(0.007, 10);
  expect(aiByModel(rows).map((m) => [m.model, m.calls])).toEqual([["claude-sonnet-5-5", 1], ["claude-haiku-5-5", 2]]);
});

test("read quality: untouched, corrected, needing a look, failed, and why", () => {
  const rows = [
    read("a", "2026-11-01"), read("a", "2026-11-02"), read("a", "2026-11-03", { corrected: ["odometerM"] }),
    read("a", "2026-11-04", { outcome: "review", issues: ["mismatch", "odometer"] }), read("a", "2026-11-05", { outcome: "unreadable", issues: ["unreadable"], kinds: { other: 1 } }),
    read("a", "2026-11-06", { outcome: "error", issues: ["error"], attempts: 3, latencyMs: 9000, kinds: {} }), read("a", "2026-11-07", { outcome: "started", attempts: 0, latencyMs: 0 }),
  ];
  const q = readQuality(rows);
  // a read still under way is not counted
  expect(q.reads).toBe(6);
  expect(q.outcomes).toEqual({ untouched: 2, corrected: 1, review: 1, unreadable: 1, failed: 1 });
  expect(q.untouchedShare).toBeCloseTo(2 / 6, 10);
  expect(q.issues).toEqual({ mismatch: 1, odometer: 1, unreadable: 1, error: 1 });
  expect(q.corrected).toEqual({ odometerM: 1 });
  expect(q.kinds).toEqual({ bill: 4, odometer: 4, other: 1 });
  expect(q.retried).toBe(1);
  expect(q.typicalMs).toBe(2000);
  expect(q.slowMs).toBe(3000);
  expect(readQuality([])).toMatchObject({ reads: 0, untouchedShare: 0, typicalMs: 0 });
});

test("this month's cost so far and where it is heading", () => {
  const rows = [read("a", "2026-11-03", { costUsd: 1 }), read("a", "2026-11-10", { costUsd: 2 }), read("a", "2026-10-30", { costUsd: 50 })];
  const p = monthProjection(rows, "2026-11-10");
  expect(p.soFar).toBe(3);
  expect(p.projected).toBeCloseTo(9, 10);
});

test("Google Places calls by kind", () => {
  expect(placesTotals([{ userId: "a", day: "2026-11-01", sku: "nearby", calls: 3 }, { userId: "b", day: "2026-11-01", sku: "nearby", calls: 1 }, { userId: "a", day: "2026-11-02", sku: "autocomplete", calls: 7 }] as never)).toEqual({ bySku: { nearby: 4, autocomplete: 7 }, calls: 11 });
});

test("streaks, usage gaps and the users table", () => {
  expect(streaks(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-10"], "2026-11-10")).toEqual({ current: 1, longest: 3 });
  expect(usageGap(null, 5)).toBe("none");
  expect(usageGap(1000, 1000 + 25 * 3600_000)).toBe("stopped");
  expect(usageGap(1000, null)).toBeNull();
  const stats = [{ userId: "a", tables: { fillUps: { count: 12, bytes: 4000 } }, files: { count: 2, bytes: 600_000 } }];
  const v = { users: [user("a", 0, true)], devices: [device("a")], daily: [], stats, ai: [], places: [] } as never;
  const [row] = userRows(v, [day("a", "2026-11-01", { activeMs: 60_000 }, 3)], "2026-11-01", [read("a", "2026-11-01", { costUsd: 0.5 })]);
  expect(row).toMatchObject({ opens: 3, activeDays: 1, activeMs: 60_000, entries: 12, storage: 604_000, installed: true, aiCost: 0.5, aiCalls: 1, ai: true });
});

test("cohorts: who came back in the weeks after they signed up", () => {
  const joined = (d: string) => new Date(`${d}T12:00:00Z`).getTime();
  const users = [user("a", joined("2026-11-02")), user("b", joined("2026-11-03"))];
  const daily = [day("a", "2026-11-02"), day("b", "2026-11-03"), day("a", "2026-11-10")];
  const c = cohorts(users as never, daily, "2026-11-12", 2, (ms) => new Date(ms).toISOString().slice(0, 10));
  expect(c[0]).toEqual({ week: "2026-11-02", size: 2, weeks: [1, 0.5] });
});

test("fractions of a cent are shown, not rounded to nothing", () => {
  expect([fmtUsd(0), fmtUsd(0.0008), fmtUsd(0.042), fmtUsd(3.1)]).toEqual(["$0", "$0.0008", "$0.042", "$3.10"]);
});
