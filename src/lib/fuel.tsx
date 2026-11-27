/**
 * Everything the screens show, worked out once from the few queries the app keeps (and caches for
 * offline use): the current vehicle, its fill-ups, and the mileage figures built on them
 * (convex/lib/mileage.ts). Nothing here asks the server for a number.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import { dip, facts, headline, months, stationFigures, stretches, total, type Fill as MileageFill, type Stretch } from "@convex/lib/mileage";
import { useQuery } from "./convex";
import type { LocalFill, Settings, Station, Vehicle } from "@/offline/overlay";

export type { LocalFill as Fill, Station, Vehicle, Settings };

const toMileage = (f: LocalFill): MileageFill => ({
  id: f._id, date: f.date, time: f.time, odometerM: f.odometerM, quantityMilli: f.quantityMilli ?? 0, amountMinor: f.amountMinor ?? 0,
  fullTank: f.fullTank, missedBefore: f.missedBefore, stationId: f.stationId, createdAt: f._creationTime,
});

function useCompute() {
  const me = useQuery(api.users.me);
  const settings = useQuery(api.settings.get);
  const vehicles = useQuery(api.vehicles.list);
  const allFills = useQuery(api.fillUps.list) as LocalFill[] | undefined;
  const stations = useQuery(api.stations.list);

  return useMemo(() => {
    const live = (vehicles ?? []).filter((v) => !v.deletedAt);
    const vehicle = live.find((v) => v._id === settings?.currentVehicleId) ?? live[0] ?? null;
    const mine = (allFills ?? []).filter((f) => vehicle && f.vehicleId === vehicle._id);
    // newest first, as every list shows them
    const fills = [...mine].sort((a, b) => b.date.localeCompare(a.date) || (b.time ?? "").localeCompare(a.time ?? "") || b._creationTime - a._creationTime);
    const done = fills.filter((f) => f.status === "done").map(toMileage);
    const list = stretches(done);
    return {
      loading: me === undefined || settings === undefined || vehicles === undefined || allFills === undefined,
      me: me ?? null,
      settings,
      vehicles: vehicles ?? [],
      vehicle,
      stations: stations ?? [],
      stationById: new Map((stations ?? []).map((s) => [s._id as string, s])),
      allFills: allFills ?? [],
      /** The current vehicle's fill-ups, newest first, whatever their state. */
      fills,
      /** Those waiting to be read or needing a look: counted in no figure. */
      pending: (allFills ?? []).filter((f) => f.status !== "done"),
      done,
      stretches: list,
      /** The stretch that ended at a fill-up, by the fill-up's id. */
      stretchOf: new Map<string, Stretch>(list.map((s) => [s.id, s])),
      headline: headline(list),
      overall: total(list),
      dip: dip(list),
      months: months(done, list),
      facts: facts(done, list),
      stationFigures: stationFigures(done, list),
      currency: settings?.currency ?? "INR",
      unit: settings?.efficiencyUnit ?? "km/l",
      fuel: vehicle?.fuelType ?? "petrol",
    };
  }, [me, settings, vehicles, allFills, stations]);
}

export type Fuel = ReturnType<typeof useCompute>;
const Ctx = createContext<Fuel | null>(null);

export function FuelProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={useCompute()}>{children}</Ctx.Provider>;
}

export function useFuel(): Fuel {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFuel must be used inside FuelProvider");
  return v;
}
