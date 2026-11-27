/**
 * Mileage, cost per km and the insights built on them, from one vehicle's fill-ups. Pure, so the
 * app computes everything on the device (and offline) from the fill-ups it already has.
 *
 * A stretch is the road between two fill-ups that both have an odometer reading ("anchors").
 *  - exact: between two full-tank anchors. The fuel burnt is everything added after the first,
 *    up to and including the second (partial fills in between are summed in).
 *  - estimated: any other pair of consecutive anchors. The fuel burnt is taken to be what was
 *    added at the first of the two (and at any fill-up with no odometer before the second): right
 *    for a rider who refuels by amount at about the same tank level, off for any single stretch
 *    otherwise, which is why the headline averages five of them.
 * A fill-up marked "missed one before this" breaks the chain: no stretch crosses it.
 */

export type Fill = {
  id: string;
  date: string;
  time?: string;
  odometerM?: number;
  quantityMilli: number;
  amountMinor: number;
  fullTank: boolean;
  missedBefore: boolean;
  stationId?: string;
  createdAt?: number;
};

export type Stretch = {
  /** The fill-up the stretch ends at: its figure is shown on that fill-up. */
  id: string;
  fromId: string;
  date: string;
  distanceM: number;
  fuelMilli: number;
  costMinor: number;
  exact: boolean;
  /** The station whose fuel was burnt: where the stretch began. */
  stationId?: string;
};

export type Rate = { distanceM: number; fuelMilli: number; costMinor: number; exact: boolean };

/** km per litre (or per kg): metres over thousandths are the same ratio. */
export const kmPerUnit = (r: { distanceM: number; fuelMilli: number }) => (r.fuelMilli > 0 ? r.distanceM / r.fuelMilli : 0);
/** Minor units of currency per km. */
export const costPerKm = (r: { distanceM: number; costMinor: number }) => (r.distanceM > 0 ? r.costMinor / (r.distanceM / 1000) : 0);
/** Litres per 100 km. */
export const per100km = (r: { distanceM: number; fuelMilli: number }) => (r.distanceM > 0 ? (r.fuelMilli / r.distanceM) * 100 : 0);

/** Date, then time, then odometer, then the order they were added. */
export function sortFills<T extends Fill>(fills: T[]): T[] {
  return [...fills].sort((a, b) =>
    a.date.localeCompare(b.date)
    || (a.time && b.time ? a.time.localeCompare(b.time) : 0)
    || (a.odometerM !== undefined && b.odometerM !== undefined ? a.odometerM - b.odometerM : 0)
    || (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function stretches(input: Fill[]): Stretch[] {
  const fills = sortFills(input);
  // an odometer that did not move forward is a misread or a typo: that fill-up is not an anchor
  const anchors: number[] = [];
  let last = -Infinity;
  fills.forEach((f, i) => {
    if (f.odometerM !== undefined && f.odometerM > last) { anchors.push(i); last = f.odometerM; }
  });
  const sum = (from: number, to: number) => {
    let fuelMilli = 0, costMinor = 0;
    for (let i = from; i <= to; i++) { fuelMilli += fills[i].quantityMilli; costMinor += fills[i].amountMinor; }
    return { fuelMilli, costMinor };
  };
  /** No fill-up after `a` up to `b` says one was missed before it. */
  const unbroken = (a: number, b: number) => { for (let i = a + 1; i <= b; i++) if (fills[i].missedBefore) return false; return true; };
  const out: Stretch[] = [];
  const emit = (a: number, b: number, exact: boolean) => {
    const { fuelMilli, costMinor } = exact ? sum(a + 1, b) : sum(a, b - 1);
    const distanceM = fills[b].odometerM! - fills[a].odometerM!;
    if (fuelMilli > 0 && distanceM > 0) out.push({ id: fills[b].id, fromId: fills[a].id, date: fills[b].date, distanceM, fuelMilli, costMinor, exact, stationId: fills[a].stationId });
  };
  let k = 0;
  while (k < anchors.length - 1) {
    const a = anchors[k];
    if (fills[a].fullTank) {
      let j = k + 1;
      while (j < anchors.length && !fills[anchors[j]].fullTank) j++;
      if (j < anchors.length && unbroken(a, anchors[j])) { emit(a, anchors[j], true); k = j; continue; }
    }
    const b = anchors[k + 1];
    if (unbroken(a, b)) emit(a, b, false);
    k++;
  }
  return out;
}

export function total(list: Stretch[]): Rate | null {
  if (!list.length) return null;
  return {
    distanceM: list.reduce((n, s) => n + s.distanceM, 0),
    fuelMilli: list.reduce((n, s) => n + s.fuelMilli, 0),
    costMinor: list.reduce((n, s) => n + s.costMinor, 0),
    exact: list.every((s) => s.exact),
  };
}

/** How many stretches the headline figure averages. */
export const HEADLINE_STRETCHES = 5;
export const headline = (list: Stretch[]) => total(list.slice(-HEADLINE_STRETCHES));

const DIP_RECENT = 3;
const DIP_BASE_MAX = 10;
const DIP_BASE_MIN = 5;
const DIP_AT = 0.1;
const RECOVERED_WITHIN = 0.05;

export type Dip = { state: "dip" | "recovered"; drop: number; since: string; recent: number; base: number };

/** How far the last three stretches are below the up-to-ten before them: 0.12 is 12% worse. Null with too little history. */
function dropAt(list: Stretch[], end: number): { drop: number; recent: number; base: number; since: string } | null {
  const recent = list.slice(end - DIP_RECENT, end);
  const base = list.slice(Math.max(0, end - DIP_RECENT - DIP_BASE_MAX), end - DIP_RECENT);
  if (recent.length < DIP_RECENT || base.length < DIP_BASE_MIN) return null;
  const r = kmPerUnit(total(recent)!), b = kmPerUnit(total(base)!);
  return b > 0 ? { drop: (b - r) / b, recent: r, base: b, since: recent[0].date } : null;
}

/** Mileage dropped 10% or more against its own recent past, or came back within 5% after such a drop. */
export function dip(list: Stretch[]): Dip | null {
  const now = dropAt(list, list.length);
  if (!now) return null;
  if (now.drop >= DIP_AT) return { state: "dip", ...now };
  const before = dropAt(list, list.length - 1);
  if (before && before.drop >= DIP_AT && now.drop <= RECOVERED_WITHIN) return { state: "recovered", ...now };
  return null;
}

export type Month = { month: string; spendMinor: number; fuelMilli: number; distanceM: number; fills: number };

/** Spend and fuel by the month of the fill-up; distance by the month a stretch ended in. Oldest first, no gaps filled. */
export function months(fills: Fill[], list: Stretch[]): Month[] {
  const by = new Map<string, Month>();
  const at = (m: string) => by.get(m) ?? by.set(m, { month: m, spendMinor: 0, fuelMilli: 0, distanceM: 0, fills: 0 }).get(m)!;
  for (const f of fills) { const m = at(f.date.slice(0, 7)); m.spendMinor += f.amountMinor; m.fuelMilli += f.quantityMilli; m.fills++; }
  for (const s of list) at(s.date.slice(0, 7)).distanceM += s.distanceM;
  return [...by.values()].sort((a, b) => a.month.localeCompare(b.month));
}

const dayNumber = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;

export type Facts = {
  spendMinor: number;
  fuelMilli: number;
  distanceM: number;
  fills: number;
  best: Stretch | null;
  worst: Stretch | null;
  avgDistanceM: number | null;
  avgDays: number | null;
  avgFillMinor: number | null;
  /** Minor units per litre at the newest fill-up, and at the one before it. */
  price: number | null;
  prevPrice: number | null;
};

export function facts(input: Fill[], list: Stretch[]): Facts {
  const fills = sortFills(input);
  const price = (f?: Fill) => (f && f.quantityMilli > 0 ? f.amountMinor / (f.quantityMilli / 1000) : null);
  const byRate = [...list].sort((a, b) => kmPerUnit(a) - kmPerUnit(b));
  const n = fills.length;
  return {
    spendMinor: fills.reduce((s, f) => s + f.amountMinor, 0),
    fuelMilli: fills.reduce((s, f) => s + f.quantityMilli, 0),
    distanceM: list.reduce((s, x) => s + x.distanceM, 0),
    fills: n,
    best: byRate[byRate.length - 1] ?? null,
    worst: byRate[0] ?? null,
    avgDistanceM: list.length ? list.reduce((s, x) => s + x.distanceM, 0) / list.length : null,
    avgDays: n > 1 ? (dayNumber(fills[n - 1].date) - dayNumber(fills[0].date)) / (n - 1) : null,
    avgFillMinor: n ? fills.reduce((s, f) => s + f.amountMinor, 0) / n : null,
    price: price(fills[n - 1]),
    prevPrice: price(fills[n - 2]),
  };
}

/** kg of CO₂ from burning a litre (a kg, for CNG): rounded published factors, good for "about". */
export const CO2_KG_PER_UNIT = { petrol: 2.31, diesel: 2.68, cng: 2.75 } as const;

export type StationFigure = { stationId: string; visits: number; pricePerUnit: number | null; rate: Rate | null; versus: number | null };
/** Shown from this many fill-ups at a station: fewer says nothing. */
export const STATION_MIN_FILLS = 3;

/**
 * Per station: visits, average price, and the mileage of the stretches that began there against
 * the vehicle's overall figure (0.04 is 4% better). A hint only: a tank mixes fuel from several stations.
 */
export function stationFigures(fills: Fill[], list: Stretch[]): StationFigure[] {
  const overall = total(list);
  const ids = [...new Set(fills.map((f) => f.stationId).filter((x): x is string => !!x))];
  return ids.map((stationId) => {
    const here = fills.filter((f) => f.stationId === stationId);
    const fuel = here.reduce((s, f) => s + f.quantityMilli, 0);
    const rate = total(list.filter((s) => s.stationId === stationId));
    const enough = here.length >= STATION_MIN_FILLS;
    return {
      stationId,
      visits: here.length,
      pricePerUnit: fuel > 0 ? here.reduce((s, f) => s + f.amountMinor, 0) / (fuel / 1000) : null,
      rate: enough ? rate : null,
      versus: enough && rate && overall && kmPerUnit(overall) > 0 ? kmPerUnit(rate) / kmPerUnit(overall) - 1 : null,
    };
  });
}
