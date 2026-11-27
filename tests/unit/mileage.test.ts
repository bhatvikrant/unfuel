import { expect, test } from "vitest";
import { costPerKm, dip, facts, headline, kmPerUnit, months, stationFigures, stretches, total, type Fill } from "@convex/lib/mileage";

let n = 0;
/** A fill-up: km on the clock, litres, rupees. */
const fill = (date: string, km: number | undefined, litres: number, rupees: number, more: Partial<Fill> = {}): Fill => ({
  id: `f${++n}`, date, odometerM: km === undefined ? undefined : km * 1000, quantityMilli: Math.round(litres * 1000), amountMinor: rupees * 100,
  fullTank: false, missedBefore: false, ...more,
});
const full = { fullTank: true };

test("one fill-up has no mileage yet", () => {
  expect(stretches([fill("2026-01-01", 12000, 9.43, 1000)])).toEqual([]);
  expect(headline([])).toBeNull();
});

test("fills by amount: distance since the last fill over the fuel added at that fill", () => {
  const s = stretches([fill("2026-01-01", 12000, 9.43, 1000), fill("2026-01-10", 12410, 9.5, 1000)]);
  expect(s).toHaveLength(1);
  expect(s[0].exact).toBe(false);
  expect(kmPerUnit(s[0])).toBeCloseTo(43.48, 2);
  // ₹1000 over 410 km, in paise per km
  expect(costPerKm(s[0])).toBeCloseTo(243.9, 1);
});

test("full tank to full tank is exact and uses the fuel of the second fill", () => {
  const s = stretches([fill("2026-01-01", 1000, 10, 1000, full), fill("2026-01-10", 1400, 8, 800, full)]);
  expect(s).toEqual([expect.objectContaining({ exact: true, distanceM: 400_000, fuelMilli: 8000, costMinor: 80_000 })]);
});

test("partial fills between two full tanks are summed into one exact stretch", () => {
  const s = stretches([
    fill("2026-01-01", 1000, 10, 1000, full),
    fill("2026-01-05", 1200, 3, 300),
    fill("2026-01-09", 1350, 2, 200),
    fill("2026-01-12", 1500, 5, 500, full),
  ]);
  expect(s).toHaveLength(1);
  expect(s[0]).toMatchObject({ exact: true, distanceM: 500_000, fuelMilli: 10_000, costMinor: 100_000 });
});

test("partials after a full tank are estimates until the next full tank", () => {
  const s = stretches([fill("2026-01-01", 1000, 10, 1000, full), fill("2026-01-05", 1400, 3, 300), fill("2026-01-09", 1520, 3, 300)]);
  expect(s.map((x) => x.exact)).toEqual([false, false]);
  expect(s[1]).toMatchObject({ distanceM: 120_000, fuelMilli: 3000 });
});

test("a fill-up with no odometer adds its fuel to the stretch it falls in", () => {
  const s = stretches([fill("2026-01-01", 1000, 5, 500), fill("2026-01-04", undefined, 5, 500), fill("2026-01-08", 1400, 5, 500)]);
  expect(s).toEqual([expect.objectContaining({ distanceM: 400_000, fuelMilli: 10_000, costMinor: 100_000 })]);
});

test("a missed fill-up breaks the chain: no stretch crosses it", () => {
  const s = stretches([
    fill("2026-01-01", 1000, 5, 500),
    fill("2026-01-05", 1200, 5, 500),
    fill("2026-01-20", 1900, 5, 500, { missedBefore: true }),
    fill("2026-01-25", 2100, 5, 500),
  ]);
  expect(s.map((x) => x.distanceM)).toEqual([200_000, 200_000]);
});

test("an odometer that went backwards is ignored, not turned into a negative stretch", () => {
  const s = stretches([fill("2026-01-01", 1000, 5, 500), fill("2026-01-05", 900, 5, 500), fill("2026-01-09", 1400, 5, 500)]);
  expect(s).toEqual([expect.objectContaining({ distanceM: 400_000, fuelMilli: 10_000 })]);
});

test("fill-ups are ordered by date whatever order they arrive in", () => {
  const a = fill("2026-01-10", 12410, 9.5, 1000), b = fill("2026-01-01", 12000, 9.43, 1000);
  expect(stretches([a, b])[0]).toMatchObject({ id: a.id, fromId: b.id });
});

test("the headline averages the last five stretches by distance over fuel, not the mean of their rates", () => {
  const fills = [fill("2026-01-01", 0, 10, 1000)];
  for (let i = 1; i <= 7; i++) fills.push(fill(`2026-01-${String(1 + i * 3).padStart(2, "0")}`, i * 400, i === 7 ? 20 : 10, 1000));
  const s = stretches(fills);
  expect(s).toHaveLength(7);
  expect(kmPerUnit(headline(s)!)).toBeCloseTo((5 * 400) / 50, 6);
  expect(headline(s)!.exact).toBe(false);
  expect(kmPerUnit(total(s)!)).toBeCloseTo(40, 6);
});

function steady(count: number, kmPerFill: (i: number) => number): Fill[] {
  const fills = [fill("2026-01-01", 0, 10, 1000)];
  let km = 0;
  for (let i = 1; i <= count; i++) { km += kmPerFill(i); fills.push(fill(`2026-${String(1 + Math.floor(i / 9)).padStart(2, "0")}-${String(1 + (i % 9) * 3).padStart(2, "0")}`, km, 10, 1000)); }
  return fills;
}

test("a dip is flagged when the last three stretches are 10% below the ones before", () => {
  expect(dip(stretches(steady(10, () => 400)))).toBeNull();
  const d = dip(stretches(steady(10, (i) => (i > 7 ? 340 : 400))));
  expect(d).toMatchObject({ state: "dip" });
  expect(d!.drop).toBeCloseTo(0.15, 6);
});

test("too little history says nothing", () => {
  expect(dip(stretches(steady(6, (i) => (i > 3 ? 200 : 400))))).toBeNull();
});

test("mileage back within 5% after a dip is reported as recovered", () => {
  // stretches 6-8 are low: a dip at 8 and 9, back to normal at 10 (said once), nothing to say at 11
  const s = stretches(steady(11, (i) => (i >= 6 && i <= 8 ? 300 : 400)));
  expect(dip(s.slice(0, 8))).toMatchObject({ state: "dip" });
  expect(dip(s.slice(0, 9))).toMatchObject({ state: "dip" });
  expect(dip(s.slice(0, 10))).toMatchObject({ state: "recovered" });
  expect(dip(s)).toBeNull();
});

test("months sum spend by fill date and distance by where a stretch ended", () => {
  const fills = [fill("2026-01-28", 1000, 5, 500), fill("2026-02-03", 1200, 5, 520), fill("2026-02-20", 1500, 5, 540)];
  expect(months(fills, stretches(fills))).toEqual([
    { month: "2026-01", spendMinor: 50_000, fuelMilli: 5000, distanceM: 0, fills: 1 },
    { month: "2026-02", spendMinor: 106_000, fuelMilli: 10_000, distanceM: 500_000, fills: 2 },
  ]);
});

test("facts: totals, best and worst tank, averages, price change", () => {
  const fills = [fill("2026-01-01", 1000, 5, 500), fill("2026-01-11", 1300, 5, 525), fill("2026-01-21", 1500, 5, 550)];
  const s = stretches(fills);
  const f = facts(fills, s);
  expect(f).toMatchObject({ spendMinor: 157_500, fuelMilli: 15_000, distanceM: 500_000, fills: 3, avgDays: 10, avgDistanceM: 250_000 });
  expect(f.best!.distanceM).toBe(300_000);
  expect(f.worst!.distanceM).toBe(200_000);
  expect(f.price).toBeCloseTo(11_000, 6);
  expect(f.prevPrice).toBeCloseTo(10_500, 6);
});

test("a station is compared only from three fill-ups, by the stretches that began there", () => {
  const A = { stationId: "A" }, B = { stationId: "B" };
  const fills = [
    fill("2026-01-01", 0, 10, 1000, A), fill("2026-01-05", 440, 10, 1000, B), fill("2026-01-09", 800, 10, 1000, A),
    fill("2026-01-13", 1240, 10, 1100, B), fill("2026-01-17", 1600, 10, 1000, A), fill("2026-01-21", 2040, 10, 1000, B),
  ];
  const figs = stationFigures(fills, stretches(fills));
  const a = figs.find((x) => x.stationId === "A")!, b = figs.find((x) => x.stationId === "B")!;
  expect(a.visits).toBe(3);
  // A's three tanks ran 440 km each; B's two ran 360: overall 2040 km on 50 L
  expect(kmPerUnit(a.rate!)).toBeCloseTo(44, 6);
  expect(a.versus).toBeCloseTo(44 / 40.8 - 1, 6);
  expect(b.pricePerUnit).toBeCloseTo(10_333.33, 1);
  expect(kmPerUnit(b.rate!)).toBeCloseTo(36, 6);
});
