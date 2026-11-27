/**
 * What the outbox knows about each mutation that can run offline: how to prepare it (temp ids,
 * what the overlay needs, the value to hand back right away) and how to learn real ids from the
 * server's result. Mutations not listed here (the UnMoney link, merging stations, deleting the
 * account…) need a live connection and say so when there is none.
 */
import type { Settings, Vehicle } from "./overlay";
import { tempId } from "./ids";
import type { MeInfo, Op } from "./types";

export type PrepareCtx = {
  me: MeInfo;
  /** Read a query through the overlay (server value plus pending ops). */
  read: (name: string, args: Record<string, unknown>) => unknown;
};

export type Prepared = {
  args: Record<string, unknown>;
  tempId?: string;
  extra?: Record<string, unknown>;
  /** What the caller gets back while the server hasn't answered yet. */
  result: unknown;
};

export type Spec = {
  /** Shown in the "couldn't sync" toast. */
  label: string;
  /** Send `clientKey` so a replay after a reload can't double-apply. */
  clientKey?: boolean;
  prepare: (args: Record<string, unknown>, ctx: PrepareCtx) => Prepared;
  /** Temp → real id pairs learned from the server's result. */
  mapResult?: (op: Op, result: unknown) => [string, string][];
};

const idResult = (op: Op, result: unknown): [string, string][] => (op.tempId && typeof result === "string" ? [[op.tempId, result]] : []);
const plain = (label: string, clientKey = false): Spec => ({ label, clientKey, prepare: (args) => ({ args, result: null }) });

/**
 * A new fill-up. `photoKeys` (photos kept in IndexedDB, src/offline/sync.ts uploads them before the
 * mutation is sent) are taken out of the args: the server only ever sees `photoIds`. The vehicle,
 * currency and full-tank habit are what the server would fill in, so the row looks the same before
 * and after it syncs.
 */
function newFill(args: Record<string, unknown>, ctx: PrepareCtx): Prepared {
  const { photoKeys, ...rest } = args as { photoKeys?: string[] } & Record<string, unknown>;
  const settings = ctx.read("settings:get", {}) as Settings | undefined;
  const vehicles = (ctx.read("vehicles:list", {}) as Vehicle[] | undefined) ?? [];
  const vehicleId = rest.vehicleId ?? settings?.currentVehicleId ?? vehicles.find((v) => !v.deletedAt)?._id;
  const id = tempId("fillUps");
  return {
    args: rest, tempId: id, result: id,
    extra: { vehicleId, currency: settings?.currency, fullTank: settings?.fullTankDefault, blobKeys: photoKeys?.length ? photoKeys : undefined },
  };
}

export const SPECS: Record<string, Spec> = {
  "fillUps:createManual": { label: "Fill-up", clientKey: true, prepare: newFill, mapResult: idResult },
  "fillUps:createFromPhotos": { label: "Fill-up", clientKey: true, prepare: newFill, mapResult: idResult },
  "fillUps:update": plain("Fill-up edit"),
  "fillUps:remove": plain("Delete fill-up"),
  "fillUps:restore": {
    label: "Restore fill-up",
    // the caller hands over the fill-up it just deleted (`prev`): it is no longer in the list to be found
    prepare: ({ prev, ...args }) => ({ args, result: null, extra: { prev } }),
  },
  "vehicles:create": {
    label: "New vehicle",
    clientKey: true,
    prepare: (args) => { const id = tempId("vehicles"); return { args, tempId: id, result: id }; },
    mapResult: idResult,
  },
  "vehicles:update": plain("Vehicle"),
  "vehicles:setArchived": plain("Vehicle"),
  "stations:rename": plain("Station name"),
  "stations:chooseCustom": {
    label: "Station",
    clientKey: true,
    prepare: (args) => { const id = tempId("stations"); return { args, tempId: id, result: id }; },
    mapResult: idResult,
  },
  "settings:update": plain("Settings"),
};
