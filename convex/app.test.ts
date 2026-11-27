/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import { beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { SUPERADMIN_EMAIL } from "./lib/admin";
import { READ_MONTHLY_CAP } from "./lib/fuelRead";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.GOOGLE_MAPS_API_KEY;
});

function setup() {
  const t = convexTest({ schema, modules });
  rateLimiter.register(t);
  const user = async (email: string, more: { aiEnabled?: boolean } = {}) => {
    const id = await t.run((ctx) => ctx.db.insert("users", { email, ...more }));
    return { id, as: t.withIdentity({ subject: `${id}|session` }) };
  };
  /**
   * A file as an upload leaves it. The real backend records the upload's Content-Type on the file;
   * convex-test does not, so it is written here the way the backend would have.
   */
  const store = async (type: string, bytes = 10) => {
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)], { type })));
    await t.run((ctx) => ctx.db.patch(storageId as unknown as Id<"fillUps">, { contentType: type } as never));
    return storageId;
  };
  /** A photo as the app uploads it: stored, then claimed by its owner. */
  const photo = async (as: Awaited<ReturnType<typeof user>>["as"], type = "image/webp", bytes = 10) => {
    const storageId = await store(type, bytes);
    expect(await as.mutation(api.files.claim, { storageId })).toBe("ok");
    return storageId;
  };
  return { t, user, photo, store };
}

const typed = { date: "2026-11-01", quantityMilli: 9430, amountMinor: 100_000, fullTank: false };

test("signed out, nothing answers", async () => {
  const { t } = setup();
  await expect(t.query(api.fillUps.list, {})).rejects.toThrow(/signed in/);
  await expect(t.mutation(api.fillUps.createManual, typed)).rejects.toThrow(/signed in/);
  expect(await t.query(api.users.me, {})).toBeNull();
});

test("a typed fill-up gets a vehicle of its own accord, and only its owner sees it", async () => {
  const { user } = setup();
  const a = await user("a@x"), b = await user("b@x");
  const id = await a.as.mutation(api.fillUps.createManual, { ...typed, odometerM: 12_000_000 });
  const mine = await a.as.query(api.fillUps.list, {});
  expect(mine).toHaveLength(1);
  expect(mine[0]).toMatchObject({ status: "done", source: "manual", currency: "INR", odometerM: 12_000_000 });
  expect((await a.as.query(api.vehicles.list, {})).map((v) => v.name)).toEqual(["My vehicle"]);

  expect(await b.as.query(api.fillUps.list, {})).toEqual([]);
  expect(await b.as.query(api.fillUps.get, { id })).toBeNull();
  await expect(b.as.mutation(api.fillUps.update, { id, amountMinor: 1 })).rejects.toThrow(/Not found/);
  await expect(b.as.mutation(api.fillUps.remove, { id })).rejects.toThrow(/Not found/);
});

test("the same queued fill-up sent twice is one fill-up", async () => {
  const { user } = setup();
  const a = await user("a@x");
  const first = await a.as.mutation(api.fillUps.createManual, { ...typed, clientKey: "op_1" });
  const again = await a.as.mutation(api.fillUps.createManual, { ...typed, clientKey: "op_1" });
  expect(again).toBe(first);
  expect(await a.as.query(api.fillUps.list, {})).toHaveLength(1);
});

test("an odometer must sit between the fill-ups around it", async () => {
  const { user } = setup();
  const a = await user("a@x");
  await a.as.mutation(api.fillUps.createManual, { ...typed, date: "2026-11-01", odometerM: 12_000_000 });
  await a.as.mutation(api.fillUps.createManual, { ...typed, date: "2026-11-20", odometerM: 12_800_000 });
  await expect(a.as.mutation(api.fillUps.createManual, { ...typed, date: "2026-11-10", odometerM: 11_900_000 })).rejects.toThrow(/already at 12000 km/);
  await expect(a.as.mutation(api.fillUps.createManual, { ...typed, date: "2026-11-10", odometerM: 12_900_000 })).rejects.toThrow(/12800 km at the fill-up after/);
  await a.as.mutation(api.fillUps.createManual, { ...typed, date: "2026-11-10", odometerM: 12_400_000 });
  expect(await a.as.query(api.fillUps.list, {})).toHaveLength(3);
});

test("numbers that are not numbers are refused", async () => {
  const { user } = setup();
  const a = await user("a@x");
  await expect(a.as.mutation(api.fillUps.createManual, { ...typed, amountMinor: 0 })).rejects.toThrow(/amount/);
  await expect(a.as.mutation(api.fillUps.createManual, { ...typed, quantityMilli: 1.5 })).rejects.toThrow(/quantity/);
  await expect(a.as.mutation(api.fillUps.createManual, { ...typed, date: "2026-02-31" })).rejects.toThrow(/date/);
  await expect(a.as.mutation(api.fillUps.createManual, { ...typed, lat: 200, lng: 0 })).rejects.toThrow(/location/);
});

test("only an optimised image can be claimed, and only its owner may use it", async () => {
  const { t, user, photo, store } = setup();
  const a = await user("a@x"), b = await user("b@x");
  const pdf = await store("application/pdf");
  // refused and gone: the delete is not rolled back by an error
  expect(await a.as.mutation(api.files.claim, { storageId: pdf })).toBe("refused");
  expect(await t.run((ctx) => ctx.db.system.get("_storage", pdf))).toBeNull();
  await expect(a.as.mutation(api.fillUps.createManual, { ...typed, photoIds: [pdf] })).rejects.toThrow(/not yours/);
  const huge = await store("image/webp", 2 * 1024 * 1024 + 1);
  expect(await a.as.mutation(api.files.claim, { storageId: huge })).toBe("refused");
  expect(await t.run((ctx) => ctx.db.system.get("_storage", huge))).toBeNull();

  const mine = await photo(a.as);
  await expect(b.as.mutation(api.files.claim, { storageId: mine })).rejects.toThrow(/someone else/);
  await expect(b.as.mutation(api.fillUps.createManual, { ...typed, photoIds: [mine] })).rejects.toThrow(/not yours/);
  const unclaimed = await store("image/webp");
  await expect(a.as.mutation(api.fillUps.createManual, { ...typed, photoIds: [unclaimed] })).rejects.toThrow(/not yours/);
  const id = await a.as.mutation(api.fillUps.createManual, { ...typed, photoIds: [mine], source: "device" });
  expect((await a.as.query(api.fillUps.get, { id }))?.source).toBe("device");
});

test("uploads nobody claimed are swept after a day; claimed ones stay", async () => {
  vi.useFakeTimers();
  const { t, user, photo, store } = setup();
  const a = await user("a@x");
  const kept = await photo(a.as);
  const stray = await store("image/webp");
  vi.advanceTimersByTime(25 * 60 * 60 * 1000);
  await t.mutation(internal.files.sweepUnclaimed, {});
  expect(await t.run((ctx) => ctx.db.system.get("_storage", stray))).toBeNull();
  expect(await t.run((ctx) => ctx.db.system.get("_storage", kept))).not.toBeNull();
  vi.useRealTimers();
});

test("AI is off until the superadmin turns it on: photos are kept, and nothing is read", async () => {
  const { t, user, photo } = setup();
  const plain = await user("rider@x");
  expect((await plain.as.query(api.users.me, {}))?.ai).toBe(false);
  const id = await plain.as.mutation(api.fillUps.createFromPhotos, { date: "2026-11-01", photoIds: [await photo(plain.as)] });
  const f = await plain.as.query(api.fillUps.get, { id });
  expect(f).toMatchObject({ status: "review", read: { issues: ["aiOff"] } });
  expect(f?.photoIds).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
  await expect(plain.as.mutation(api.fillUps.retryRead, { id })).rejects.toThrow(/not on/);
});

test("the superadmin and accounts switched on get their photos read", async () => {
  const { t, user, photo } = setup();
  const admin = await user(SUPERADMIN_EMAIL), rider = await user("rider@x");
  expect((await admin.as.query(api.users.me, {}))).toMatchObject({ ai: true, superadmin: true });
  await admin.as.mutation(api.admin.setAi, { userIds: [rider.id], on: true });
  expect((await rider.as.query(api.users.me, {}))).toMatchObject({ ai: true, superadmin: false });
  const id = await rider.as.mutation(api.fillUps.createFromPhotos, { date: "2026-11-01", photoIds: [await photo(rider.as)] });
  expect((await rider.as.query(api.fillUps.get, { id }))?.status).toBe("reading");
  const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled.map((s) => s.name)).toEqual(["ai:readFillUp"]);
});

test("with no API key on the deployment nobody has AI", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { user } = setup();
  const admin = await user(SUPERADMIN_EMAIL);
  expect((await admin.as.query(api.users.me, {}))?.ai).toBe(false);
});

test("a read is counted before it is made, once per fill-up, up to the month's cap", async () => {
  const { t, user } = setup();
  const rider = await user("rider@x", { aiEnabled: true });
  const fill = () => rider.as.mutation(api.fillUps.createManual, typed);
  const claim = (fillUpId: Id<"fillUps">) => t.mutation(internal.usage.claimAi, { userId: rider.id, fillUpId, model: "claude-haiku-5-5", cap: READ_MONTHLY_CAP });
  const first = await fill();
  const row = await claim(first);
  expect(row).not.toBeNull();
  // a retry of the same fill-up reuses its row
  expect(await claim(first)).toBe(row);
  for (let i = 1; i < READ_MONTHLY_CAP; i++) expect(await claim(await fill())).not.toBeNull();
  expect(await claim(await fill())).toBeNull();
  expect(await t.run((ctx) => ctx.db.query("aiReads").collect())).toHaveLength(READ_MONTHLY_CAP);
});

test("a read's tokens are priced and added up across retries", async () => {
  const { t, user } = setup();
  const rider = await user("rider@x", { aiEnabled: true });
  const fillUpId = await rider.as.mutation(api.fillUps.createManual, typed);
  const readId = (await t.mutation(internal.usage.claimAi, { userId: rider.id, fillUpId, model: "claude-haiku-5-5", cap: 60 }))!;
  const tokens = { input: 2000, output: 1000, cacheWrite: 0, cacheRead: 0 };
  await t.mutation(internal.usage.recordAi, { readId, model: "claude-haiku-5-5", outcome: "error", issues: ["error"], kinds: {}, tokens: { ...tokens, input: 0, output: 0 }, latencyMs: 500 });
  await t.mutation(internal.usage.recordAi, { readId, model: "claude-haiku-5-5", outcome: "saved", issues: [], kinds: { bill: 1, odometer: 1 }, tokens, latencyMs: 1500 });
  const row = await t.run((ctx) => ctx.db.get(readId));
  expect(row).toMatchObject({ attempts: 2, outcome: "saved", inputTokens: 2000, outputTokens: 1000, latencyMs: 2000, kinds: { bill: 1, odometer: 1 } });
  // 2,000 in at $0.10 and 1,000 out at $0.50 per million
  expect(row!.costUsd).toBeCloseTo(0.0007, 10);
});

test("a clean read saves the fill-up; one with issues waits; neither overwrites what the rider typed meanwhile", async () => {
  const { t, user, photo } = setup();
  const rider = await user("rider@x", { aiEnabled: true });
  const make = async () => rider.as.mutation(api.fillUps.createFromPhotos, { date: "2026-11-01", photoIds: [await photo(rider.as)] });
  const read = { kinds: { bill: 1, odometer: 1 }, printed: { amount: "1000" } };

  const clean = await make();
  expect(await t.mutation(internal.fillUps.applyRead, { fillUpId: clean, ...read, issues: [], fields: { amountMinor: 100_000, quantityMilli: 9430, odometerM: 12_410_000, date: "2026-10-30", stationName: "Sri Sai Fuel Station", stationBrand: "Indian Oil" } })).toBe("done");
  expect(await rider.as.query(api.fillUps.get, { id: clean })).toMatchObject({ status: "done", amountMinor: 100_000, date: "2026-10-30", billStation: { name: "Sri Sai Fuel Station", brand: "Indian Oil" } });

  const unsure = await make();
  expect(await t.mutation(internal.fillUps.applyRead, { fillUpId: unsure, ...read, issues: ["mismatch"], fields: {} })).toBe("review");
  expect((await rider.as.query(api.fillUps.get, { id: unsure }))?.read?.issues).toEqual(["mismatch"]);

  const typedFirst = await make();
  await rider.as.mutation(api.fillUps.update, { id: typedFirst, amountMinor: 50_000, quantityMilli: 4700 });
  expect(await t.mutation(internal.fillUps.applyRead, { fillUpId: typedFirst, ...read, issues: [], fields: { amountMinor: 100_000, quantityMilli: 9430 } })).toBeNull();
  expect((await rider.as.query(api.fillUps.get, { id: typedFirst }))?.amountMinor).toBe(50_000);
});

test("the first bill sets the account's currency; later bills in another do not", async () => {
  const { t, user, photo } = setup();
  const rider = await user("rider@x", { aiEnabled: true });
  const make = async () => rider.as.mutation(api.fillUps.createFromPhotos, { date: "2026-11-01", photoIds: [await photo(rider.as)] });
  const apply = (fillUpId: Id<"fillUps">, currency: string) => t.mutation(internal.fillUps.applyRead, { fillUpId, kinds: { bill: 1 }, printed: {}, issues: [], fields: { amountMinor: 5000, quantityMilli: 12_000, currency } });
  const first = await make();
  await apply(first, "USD");
  expect((await rider.as.query(api.settings.get, {})).currency).toBe("USD");
  expect((await rider.as.query(api.fillUps.get, { id: first }))?.currency).toBe("USD");
  const second = await make();
  await apply(second, "EUR");
  expect((await rider.as.query(api.settings.get, {})).currency).toBe("USD");
});

test("what a rider changes after an AI read is recorded by field name", async () => {
  const { t, user, photo } = setup();
  const rider = await user("rider@x", { aiEnabled: true });
  const id = await rider.as.mutation(api.fillUps.createFromPhotos, { date: "2026-11-01", photoIds: [await photo(rider.as)] });
  const readId = (await t.mutation(internal.usage.claimAi, { userId: rider.id, fillUpId: id, model: "claude-haiku-5-5", cap: 60 }))!;
  await t.mutation(internal.fillUps.applyRead, { fillUpId: id, kinds: { bill: 1 }, printed: {}, issues: [], fields: { amountMinor: 100_000, quantityMilli: 9430, odometerM: 12_410_000 } });
  await rider.as.mutation(api.fillUps.update, { id, odometerM: 12_470_000, note: "highway" });
  expect((await t.run((ctx) => ctx.db.get(readId)))?.corrected).toEqual(["odometerM"]);
});

test("delete and undo", async () => {
  const { user } = setup();
  const a = await user("a@x");
  const id = await a.as.mutation(api.fillUps.createManual, typed);
  await a.as.mutation(api.fillUps.remove, { id });
  expect(await a.as.query(api.fillUps.list, {})).toEqual([]);
  await a.as.mutation(api.fillUps.restore, { id });
  expect(await a.as.query(api.fillUps.list, {})).toHaveLength(1);
});

test("a deleted fill-up and its photos are removed for good after 30 days, not before", async () => {
  vi.useFakeTimers();
  const { t, user, photo } = setup();
  const a = await user("a@x");
  const p = await photo(a.as);
  const id = await a.as.mutation(api.fillUps.createManual, { ...typed, photoIds: [p] });
  const kept = await a.as.mutation(api.fillUps.createManual, { ...typed, date: "2026-11-02", photoIds: [await photo(a.as)] });
  await a.as.mutation(api.fillUps.remove, { id });
  vi.advanceTimersByTime(29 * 24 * 60 * 60 * 1000);
  await t.mutation(internal.fillUps.purgeDeleted, {});
  expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull();
  vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);
  await t.mutation(internal.fillUps.purgeDeleted, {});
  expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  expect(await t.run((ctx) => ctx.db.system.get("_storage", p))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(kept))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(1);
  vi.useRealTimers();
});

test("a station the rider chose is never replaced by detection; one Google place is one station", async () => {
  const { t, user } = setup();
  const a = await user("a@x");
  const place = { placeId: "ChIJabcdefghijkl", name: "HP Petrol Pump", address: "Koramangala" };
  const one = await a.as.mutation(api.fillUps.createManual, { ...typed, lat: 12.935, lng: 77.625 });
  const two = await a.as.mutation(api.fillUps.createManual, { ...typed, date: "2026-11-05", lat: 12.9351, lng: 77.625 });
  const s1 = await t.mutation(internal.stations.attach, { userId: a.id, fillUpId: one, by: "auto", place });
  const s2 = await t.mutation(internal.stations.attach, { userId: a.id, fillUpId: two, by: "auto", place });
  expect(s2).toBe(s1);
  const stations = await a.as.query(api.stations.list, {});
  expect(stations).toHaveLength(1);
  // the station sits where the rider was, not where Google says the place is
  expect(stations[0]).toMatchObject({ placeId: place.placeId, googleName: "HP Petrol Pump", lat: 12.935, lng: 77.625 });

  const mine = await a.as.mutation(api.stations.chooseCustom, { fillUpId: one, name: "Uncle's pump" });
  expect(await t.mutation(internal.stations.attach, { userId: a.id, fillUpId: one, by: "auto", place })).toBeNull();
  expect((await a.as.query(api.fillUps.get, { id: one }))?.stationId).toBe(mine);
  // cleared by the rider: detection leaves it empty
  await a.as.mutation(api.fillUps.update, { id: one, stationId: null });
  expect(await t.mutation(internal.stations.attach, { userId: a.id, fillUpId: one, by: "auto", place })).toBeNull();
});

test("an UnMoney link must be UnMoney's, and only its last four characters come back", async () => {
  const { user } = setup();
  const a = await user("a@x");
  const good = "https://brilliant-cheetah-609.convex.site/unfuel/abcdefghijklmnop1234";
  for (const bad of ["not a link", "https://evil.example/unfuel/abcdefghijklmnop1234", "http://brilliant-cheetah-609.convex.site/unfuel/abcdefghijklmnop1234", "https://brilliant-cheetah-609.convex.site/unfuel/short"]) {
    await expect(a.as.mutation(api.settings.setUnmoney, { url: bad })).rejects.toThrow(/link/);
  }
  // a local UnMoney over plain http is refused unless this deployment lists it by name
  const local = "http://127.0.0.1:3211/unfuel/abcdefghijklmnop1234";
  await expect(a.as.mutation(api.settings.setUnmoney, { url: local })).rejects.toThrow(/link/);
  process.env.UNMONEY_HOSTS = "127.0.0.1:3211, plain.example";
  await a.as.mutation(api.settings.setUnmoney, { url: local });
  await expect(a.as.mutation(api.settings.setUnmoney, { url: "http://plain.example/unfuel/abcdefghijklmnop1234" })).rejects.toThrow(/link/);
  await expect(a.as.mutation(api.settings.setUnmoney, { url: good })).rejects.toThrow(/link/);
  delete process.env.UNMONEY_HOSTS;

  await a.as.mutation(api.settings.setUnmoney, { url: good, auto: true });
  expect((await a.as.query(api.settings.get, {})).unmoney).toEqual({ tail: "1234", auto: true });
  expect(JSON.stringify(await a.as.query(api.settings.get, {}))).not.toContain("abcdefghijklmnop");
  await a.as.mutation(api.settings.setUnmoney, { clear: true });
  expect((await a.as.query(api.settings.get, {})).unmoney).toBeNull();
});

test("a fill-up is sent to UnMoney once, as its endpoint expects it; a refusal is shown, not retried", async () => {
  vi.useFakeTimers();
  const { t, user } = setup();
  const a = await user("a@x");
  const link = "https://brilliant-cheetah-609.convex.site/unfuel/abcdefghijklmnop1234";
  await a.as.mutation(api.settings.setUnmoney, { url: link });
  const id = await a.as.mutation(api.fillUps.createManual, { ...typed, time: "18:04" });
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  let answer = () => new Response("Added to UnMoney.", { status: 200 });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { sent.push({ url, body: JSON.parse(String(init.body)) }); return answer(); });

  // the button: nothing goes on its own while "send every fill-up" is off
  expect(sent).toEqual([]);
  await a.as.mutation(api.fillUps.sendToUnmoney, { id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(sent).toHaveLength(1);
  expect(sent[0].url).toBe(link);
  expect(sent[0].body).toEqual({ v: 1, source: "unfuel", ref: id, amount: "1000.00", currency: "INR", date: "2026-11-01", time: "18:04", note: "Fuel", description: "9.43 L petrol · My vehicle", category: "Fuel" });
  expect((await a.as.query(api.fillUps.get, { id }))?.unmoneySentAt).toBeGreaterThan(0);
  await expect(a.as.mutation(api.fillUps.sendToUnmoney, { id })).rejects.toThrow(/already in UnMoney/);

  // every fill-up, once the switch is on; what UnMoney says when it refuses is what the rider sees
  await a.as.mutation(api.settings.setUnmoney, { auto: true });
  answer = () => new Response("This fill-up is in INR and your UnMoney is in USD.", { status: 422 });
  const second = await a.as.mutation(api.fillUps.createManual, { ...typed, date: "2026-11-05" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(sent).toHaveLength(2);
  expect(await a.as.query(api.fillUps.get, { id: second })).toMatchObject({ unmoneyError: "This fill-up is in INR and your UnMoney is in USD." });
  expect((await a.as.query(api.fillUps.get, { id: second }))?.unmoneySentAt).toBeUndefined();

  // UnMoney down: tried again three times, then said so
  answer = () => new Response("oops", { status: 503 });
  const third = await a.as.mutation(api.fillUps.createManual, { ...typed, date: "2026-11-09" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(sent).toHaveLength(6);
  expect((await a.as.query(api.fillUps.get, { id: third }))?.unmoneyError).toBe("UnMoney could not be reached");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("the dashboard answers the superadmin and nobody else", async () => {
  const { user } = setup();
  const admin = await user(SUPERADMIN_EMAIL), rider = await user("rider@x");
  const range = { from: "2026-11-01", to: "2026-11-30", now: 0 };
  await expect(rider.as.query(api.admin.overview, range)).rejects.toThrow(/Not allowed/);
  await expect(rider.as.query(api.admin.badReads, {})).rejects.toThrow(/Not allowed/);
  await expect(rider.as.query(api.admin.userSessions, { userId: admin.id })).rejects.toThrow(/Not allowed/);
  await expect(rider.as.mutation(api.admin.setAi, { userIds: [rider.id], on: true })).rejects.toThrow(/Not allowed/);
  await expect(rider.as.mutation(api.admin.refresh, {})).rejects.toThrow(/Not allowed/);
  // a look-alike address is not the superadmin
  const fake = await user(`x${SUPERADMIN_EMAIL}`);
  await expect(fake.as.query(api.admin.overview, range)).rejects.toThrow(/Not allowed/);

  const o = await admin.as.query(api.admin.overview, range);
  expect(o.users.map((u) => u.email).sort()).toEqual([SUPERADMIN_EMAIL, "rider@x", `x${SUPERADMIN_EMAIL}`].sort());
});

test("the overview carries counts, never a rider's amounts, readings or places", async () => {
  const { t, user } = setup();
  const admin = await user(SUPERADMIN_EMAIL), rider = await user("rider@x");
  await rider.as.mutation(api.fillUps.createManual, { ...typed, amountMinor: 987_654, odometerM: 55_555_000, lat: 12.3456789, lng: 77.6543219, note: "secret note" });
  await t.action(internal.admin.refreshUser, { userId: rider.id });
  const text = JSON.stringify(await admin.as.query(api.admin.overview, { from: "2020-01-01", to: "2030-01-01", now: 0 }));
  for (const secret of ["987654", "55555000", "12.3456789", "77.6543219", "secret note"]) expect(text).not.toContain(secret);
  const stats = (await admin.as.query(api.admin.overview, { from: "2020-01-01", to: "2030-01-01", now: 0 })).stats.find((s) => s.userId === rider.id)!;
  expect(stats.fillUps).toMatchObject({ manual: 1, withLocation: 1, withNote: 1 });
  expect(stats.tables.fillUps.count).toBe(1);
  expect(stats.features).toMatchObject({ typedOnly: true, location: true, aiReading: false });
});

test("a usage ping sent twice counts once, and grows by what was added", async () => {
  const { t, user } = setup();
  const a = await user("a@x");
  const ping = (totals: Record<string, number>) => a.as.mutation(api.usage.ping, {
    sessionId: "s1", deviceId: "d1", day: "2026-11-27", hour: 18, startedAt: Date.now() - 60_000, tzOffset: 330, os: "Android", browser: "Chrome", formFactor: "phone", standalone: true, appVersion: "2026.11.27-18:00",
    totals, screens: { home: 1 },
  });
  await ping({ activeMs: 20_000, opsSent: 1, photos: 2, photoBytesBefore: 6_000_000, photoBytesAfter: 500_000, madeUp: 9 });
  await ping({ activeMs: 20_000, opsSent: 1, photos: 2, photoBytesBefore: 6_000_000, photoBytesAfter: 500_000 });
  await ping({ activeMs: 30_000, opsSent: 3, photos: 2, photoBytesBefore: 6_000_000, photoBytesAfter: 500_000 });
  const days = await t.run((ctx) => ctx.db.query("usageDaily").collect());
  expect(days).toHaveLength(1);
  expect(days[0]).toMatchObject({ opens: 1, hours: { h18: 1 }, screens: { home: 1 } });
  expect(days[0].totals).toMatchObject({ activeMs: 30_000, opsSent: 3, photos: 2, photoBytesBefore: 6_000_000 });
  expect(days[0].totals.madeUp).toBeUndefined();
  expect(await t.run((ctx) => ctx.db.query("usageDevices").collect())).toHaveLength(1);
});

test("deleting an account removes every row and photo of that user, and nothing of anyone else's", async () => {
  vi.useFakeTimers();
  const { t, user, photo } = setup();
  const me = await user("me@x", { aiEnabled: true }), other = await user("other@x");
  for (const u of [me, other]) {
    const p = await photo(u.as);
    const id = await u.as.mutation(api.fillUps.createManual, { ...typed, photoIds: [p], lat: 12.9, lng: 77.6 });
    await u.as.mutation(api.stations.chooseCustom, { fillUpId: id, name: "Pump" });
    await u.as.mutation(api.usage.ping, { sessionId: `s-${u.id}`, deviceId: "d", day: "2026-11-27", hour: 1, startedAt: Date.now(), tzOffset: 0, os: "iOS", browser: "Safari", formFactor: "phone", standalone: false, appVersion: "v", totals: {}, screens: {} });
    await t.mutation(internal.usage.claimAi, { userId: u.id, fillUpId: id, model: "claude-haiku-5-5", cap: 60 });
    await t.mutation(internal.usage.countPlaces, { userId: u.id, sku: "nearby" });
  }
  await me.as.mutation(api.account.remove, { confirm: "DELETE" });
  // a device still holding the old token cannot write while the purge runs
  await expect(me.as.mutation(api.fillUps.createManual, typed)).rejects.toThrow(/signed in/);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const left = await t.run(async (ctx) => {
    const count: Record<string, { mine: number; theirs: number }> = {};
    for (const table of Object.keys(schema.tables) as (keyof typeof schema.tables)[]) {
      const rows = (await ctx.db.query(table).collect()) as { userId?: Id<"users"> }[];
      if (rows.some((r) => "userId" in r)) count[table] = { mine: rows.filter((r) => r.userId === me.id).length, theirs: rows.filter((r) => r.userId === other.id).length };
    }
    return { count, files: (await ctx.db.system.query("_storage").collect()).length, users: (await ctx.db.query("users").collect()).map((u) => u.email) };
  });
  for (const [table, n] of Object.entries(left.count)) {
    expect(n.mine, `${table} of the deleted user`).toBe(0);
    expect(n.theirs, `${table} of the other user`).toBeGreaterThan(0);
  }
  expect(left.files).toBe(1);
  expect(left.users).toEqual(["other@x"]);
  vi.useRealTimers();
});
