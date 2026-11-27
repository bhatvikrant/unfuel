/**
 * The outbox laid over the server's last answers, so a change made offline shows at once: a new
 * fill-up in History, Home and Stats, an edit, a delete, a renamed station. Pure: one op, one
 * query, the value before, the value after. Only the queries the app's screens are built from are
 * covered; everything else on screen is worked out from those (convex/lib/mileage.ts).
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { rewriteIds } from "./ids";
import type { Op } from "./types";

export type Query = { name: string; args: Record<string, unknown> };
export type Fill = FunctionReturnType<typeof api.fillUps.list>[number];
export type Vehicle = FunctionReturnType<typeof api.vehicles.list>[number];
export type Station = FunctionReturnType<typeof api.stations.list>[number];
export type Settings = FunctionReturnType<typeof api.settings.get>;

/** A fill-up made on this device that the server does not have yet: the photos waiting with it, by their keys in IndexedDB. */
export type LocalFill = Fill & { localPhotos?: string[] };

export function withMappedIds(op: Op, idMap: Record<string, string>): Op {
  return { ...op, args: rewriteIds(op.args, idMap), tempId: op.tempId ? idMap[op.tempId] ?? op.tempId : undefined };
}

const drop = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** The fill-up a queued create will make, as the list will show it once the server has it. */
function fillOf(op: Op): LocalFill | null {
  const a = op.args as Record<string, never>;
  const x = (op.extra ?? {}) as { vehicleId?: string; currency?: string; fullTank?: boolean; blobKeys?: string[] };
  if (!op.tempId || !x.vehicleId) return null;
  const photos = op.fn === "fillUps:createFromPhotos";
  return drop({
    _id: op.tempId as Fill["_id"], _creationTime: op.createdAt, userId: op.me.id as Fill["userId"], vehicleId: (a.vehicleId ?? x.vehicleId) as Fill["vehicleId"],
    status: photos ? "reading" : "done", source: photos ? "photo" : a.source === "device" ? "device" : "manual",
    date: a.date, time: a.time, odometerM: a.odometerM, quantityMilli: a.quantityMilli, amountMinor: a.amountMinor,
    currency: x.currency ?? "INR", fullTank: a.fullTank ?? x.fullTank ?? false, missedBefore: a.missedBefore ?? false, note: a.note,
    stationId: a.stationId, stationSetBy: a.stationId ? "user" : undefined, billStation: a.billStation,
    lat: a.lat, lng: a.lng, accuracyM: a.accuracyM, locationSource: a.lat === undefined ? undefined : a.locationSource ?? "device",
    photoIds: (a.photoIds ?? []) as Fill["photoIds"], localPhotos: x.blobKeys,
  } as LocalFill);
}

function patchFill(f: Fill, a: Record<string, unknown>): Fill {
  const next: Record<string, unknown> = { ...f };
  for (const k of ["vehicleId", "date", "quantityMilli", "amountMinor", "fullTank", "missedBefore"]) if (a[k] !== undefined) next[k] = a[k];
  for (const k of ["time", "odometerM", "note", "stationId"]) if (a[k] !== undefined) { if (a[k] === null) delete next[k]; else next[k] = a[k]; }
  if (a.stationId !== undefined) next.stationSetBy = "user";
  if (next.quantityMilli && next.amountMinor) next.status = "done";
  return next as Fill;
}

function fills(op: Op, list: Fill[]): Fill[] {
  const a = op.args;
  switch (op.fn) {
    case "fillUps:createManual":
    case "fillUps:createFromPhotos": {
      const f = fillOf(op);
      return f && !list.some((x) => x._id === f._id) ? [...list, f] : list;
    }
    case "fillUps:update": return list.map((f) => (f._id === a.id ? patchFill(f, a) : f));
    case "fillUps:remove": return list.filter((f) => f._id !== a.id);
    case "fillUps:restore": {
      const prev = op.extra?.prev as Fill | undefined;
      return prev && !list.some((f) => f._id === prev._id) ? [...list, prev] : list;
    }
    case "stations:chooseCustom": return op.tempId && a.fillUpId ? list.map((f) => (f._id === a.fillUpId ? { ...f, stationId: op.tempId as Fill["stationId"], stationSetBy: "user" as const } : f)) : list;
    default: return list;
  }
}

function vehicles(op: Op, list: Vehicle[]): Vehicle[] {
  const a = op.args as Record<string, never>;
  switch (op.fn) {
    case "vehicles:create":
      return op.tempId && !list.some((x) => x._id === op.tempId)
        ? [...list, drop({ _id: op.tempId as Vehicle["_id"], _creationTime: op.createdAt, userId: op.me.id as Vehicle["userId"], name: a.name, kind: a.kind, fuelType: a.fuelType, tankMilli: a.tankMilli, order: list.length })]
        : list;
    case "vehicles:update":
      return list.map((x) => (x._id === a.id ? drop({ ...x, name: a.name ?? x.name, kind: a.kind ?? x.kind, fuelType: a.fuelType ?? x.fuelType, tankMilli: a.tankMilli === null ? undefined : a.tankMilli ?? x.tankMilli }) : x));
    case "vehicles:setArchived":
      return list.map((x) => (x._id === a.id ? drop({ ...x, deletedAt: a.archived ? op.createdAt : undefined }) : x));
    default: return list;
  }
}

function stations(op: Op, list: Station[]): Station[] {
  const a = op.args as Record<string, never>;
  switch (op.fn) {
    case "stations:rename": return list.map((s) => (s._id === a.id ? drop({ ...s, customName: String(a.name).trim() || undefined }) : s));
    case "stations:chooseCustom":
      return op.tempId && !list.some((s) => s._id === op.tempId) ? [...list, { _id: op.tempId as Station["_id"], _creationTime: op.createdAt, userId: op.me.id as Station["userId"], customName: String(a.name).trim() }] : list;
    default: return list;
  }
}

function settings(op: Op, s: Settings): Settings {
  const a = op.args as Record<string, never>;
  if (op.fn === "settings:update") return { ...s, ...drop({ currency: a.currency, efficiencyUnit: a.efficiencyUnit, theme: a.theme, fullTankDefault: a.fullTankDefault, currentVehicleId: a.currentVehicleId }) };
  if (op.fn === "vehicles:create" && op.tempId) return { ...s, currentVehicleId: op.tempId as Settings["currentVehicleId"] };
  return s;
}

/** `base` with one queued op applied, for one query. Queries with nothing cached yet stay as they are. */
export function applyOp(op: Op, q: Query, base: unknown): unknown {
  if (base === undefined || base === null) return base;
  switch (q.name) {
    case "fillUps:list": return fills(op, base as Fill[]);
    case "vehicles:list": return vehicles(op, base as Vehicle[]);
    case "stations:list": return stations(op, base as Station[]);
    case "settings:get": return settings(op, base as Settings);
    default: return base;
  }
}
