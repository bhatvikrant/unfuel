import { expect, test } from "vitest";
import { applyOp, withMappedIds, type Fill, type Settings, type Station, type Vehicle } from "@/offline/overlay";
import { SPECS, type PrepareCtx } from "@/offline/specs";
import type { Op } from "@/offline/types";

const me = { id: "user1", ai: false };
const settings = { currency: "INR", efficiencyUnit: "km/l", theme: "system", fullTankDefault: true, currentVehicleId: "veh1", unmoney: null } as unknown as Settings;
const vehicle = { _id: "veh1", _creationTime: 1, userId: "user1", name: "Activa", kind: "scooter", fuelType: "petrol", order: 0 } as unknown as Vehicle;
const cached: Record<string, unknown> = { "settings:get": settings, "vehicles:list": [vehicle] };
const ctx: PrepareCtx = { me, read: (name) => cached[name] };

let seq = 0;
/** What the sync engine does with a call made offline: prepare it, and queue the op. */
function queue(fn: string, args: Record<string, unknown>): Op {
  const p = SPECS[fn].prepare(args, ctx);
  return { id: `op_${++seq}`, seq, fn, args: p.args, tempId: p.tempId, extra: p.extra, me, createdAt: 1000 + seq, attempts: 0 };
}
const typed = { date: "2026-11-27", quantityMilli: 9430, amountMinor: 100_000, fullTank: false };
const list = (ops: Op[], base: Fill[] = []) => ops.reduce((v, op) => applyOp(op, { name: "fillUps:list", args: {} }, v) as Fill[], base);

test("a fill-up typed offline shows at once, on the current vehicle, in the account's currency", () => {
  const op = queue("fillUps:createManual", { ...typed, odometerM: 12_410_000, lat: 12.9, lng: 77.6 });
  const [f] = list([op]);
  expect(f).toMatchObject({ _id: op.tempId, status: "done", source: "manual", vehicleId: "veh1", currency: "INR", amountMinor: 100_000, odometerM: 12_410_000, lat: 12.9, locationSource: "device", photoIds: [] });
  expect(f._id.startsWith("tmp_")).toBe(true);
});

test("photos taken offline stay on the device: their keys never reach the server's arguments", () => {
  const op = queue("fillUps:createFromPhotos", { date: "2026-11-27", photoIds: [], photoKeys: ["photo_a", "photo_b"] });
  expect(op.args).not.toHaveProperty("photoKeys");
  expect(op.extra?.blobKeys).toEqual(["photo_a", "photo_b"]);
  const [f] = list([op]);
  // waiting to be read, counted in no figure, with its photos to show from the device
  expect(f).toMatchObject({ status: "reading", source: "photo", fullTank: true, localPhotos: ["photo_a", "photo_b"] });
});

test("an edit, a delete and an undo made offline all show", () => {
  const made = queue("fillUps:createManual", typed);
  const id = made.tempId!;
  const edited = list([made, queue("fillUps:update", { id, amountMinor: 120_000, odometerM: 12_500_000, note: "highway" })]);
  expect(edited[0]).toMatchObject({ amountMinor: 120_000, odometerM: 12_500_000, note: "highway" });
  const cleared = list([made, queue("fillUps:update", { id, odometerM: 12_500_000 }), queue("fillUps:update", { id, odometerM: null, stationId: null })]);
  expect(cleared[0].odometerM).toBeUndefined();
  expect(cleared[0].stationSetBy).toBe("user");

  const gone = list([made, queue("fillUps:remove", { id })]);
  expect(gone).toEqual([]);
  const restore = queue("fillUps:restore", { id, prev: edited[0] });
  // the fill-up handed over for the undo is not sent to the server
  expect(restore.args).toEqual({ id });
  expect(list([made, queue("fillUps:remove", { id }), restore])).toHaveLength(1);
});

test("a fill-up that needed a look becomes complete once it has an amount and a quantity", () => {
  const waiting = { _id: "f1", status: "review", vehicleId: "veh1", date: "2026-11-27", photoIds: [], fullTank: false, missedBefore: false } as unknown as Fill;
  const [f] = list([queue("fillUps:update", { id: "f1", amountMinor: 100_000, quantityMilli: 9430 })], [waiting]);
  expect(f.status).toBe("done");
});

test("once the server gives a real id, queued edits follow it", () => {
  const made = queue("fillUps:createManual", typed);
  const edit = queue("fillUps:update", { id: made.tempId, note: "later" });
  const server = [{ _id: "real1", status: "done", vehicleId: "veh1", date: "2026-11-27", photoIds: [], fullTank: false, missedBefore: false } as unknown as Fill];
  const mapped = withMappedIds(edit, { [made.tempId!]: "real1" });
  expect(mapped.args.id).toBe("real1");
  expect((applyOp(mapped, { name: "fillUps:list", args: {} }, server) as Fill[])[0].note).toBe("later");
});

test("a vehicle added offline is listed and becomes the current one", () => {
  const op = queue("vehicles:create", { name: "Bullet", kind: "bike", fuelType: "petrol", tankMilli: 13_500 });
  const vehicles = applyOp(op, { name: "vehicles:list", args: {} }, [vehicle]) as Vehicle[];
  expect(vehicles.map((v) => v.name)).toEqual(["Activa", "Bullet"]);
  expect((applyOp(op, { name: "settings:get", args: {} }, settings) as Settings).currentVehicleId).toBe(op.tempId);
  const archived = applyOp(queue("vehicles:setArchived", { id: "veh1", archived: true }), { name: "vehicles:list", args: {} }, vehicles) as Vehicle[];
  expect(archived[0].deletedAt).toBeDefined();
});

test("settings and station names changed offline show", () => {
  expect(applyOp(queue("settings:update", { efficiencyUnit: "l/100km" }), { name: "settings:get", args: {} }, settings)).toMatchObject({ efficiencyUnit: "l/100km", currency: "INR" });
  const station = { _id: "st1", _creationTime: 1, userId: "user1", googleName: "HP Petrol Pump" } as unknown as Station;
  const renamed = applyOp(queue("stations:rename", { id: "st1", name: "Home pump" }), { name: "stations:list", args: {} }, [station]) as Station[];
  expect(renamed[0].customName).toBe("Home pump");
  const custom = queue("stations:chooseCustom", { fillUpId: "f1", name: "Uncle's pump" });
  expect((applyOp(custom, { name: "stations:list", args: {} }, [station]) as Station[]).map((s) => s.customName)).toEqual([undefined, "Uncle's pump"]);
});

test("a query with nothing cached yet is left alone, and unknown queries pass through", () => {
  const op = queue("fillUps:createManual", typed);
  expect(applyOp(op, { name: "fillUps:list", args: {} }, undefined)).toBeUndefined();
  expect(applyOp(op, { name: "users:me", args: {} }, { id: "user1" })).toEqual({ id: "user1" });
});

test("every write that changes what a screen shows can be made offline", () => {
  expect(Object.keys(SPECS).sort()).toEqual([
    "fillUps:createFromPhotos", "fillUps:createManual", "fillUps:remove", "fillUps:restore", "fillUps:update",
    "settings:update", "stations:chooseCustom", "stations:rename", "vehicles:create", "vehicles:setArchived", "vehicles:update",
  ]);
  for (const fn of ["fillUps:createManual", "fillUps:createFromPhotos", "vehicles:create", "stations:chooseCustom"]) expect(SPECS[fn].clientKey, fn).toBe(true);
});
