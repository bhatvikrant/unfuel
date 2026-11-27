import { expect, test } from "vitest";
import { isRealDate, odometerFits, reconcile, validateRead, type ReadContext } from "@convex/lib/fuelRead";

const ctx: ReadContext = { today: "2026-11-27", captureDate: "2026-11-27", captureTime: "18:10", currency: "INR", fuelType: "petrol", prevOdometerM: 12_000_000 };
const answer = (over: Record<string, unknown> = {}) => ({
  photos: ["bill", "odometer"], amount: 1000, quantity: 9.72, quantityUnit: "l", unitPrice: 102.86, currency: "INR", date: "2026-11-27", time: "18:04",
  product: "PETROL", stationName: "Sri Sai Fuel Station", stationBrand: "Indian Oil", stationAddress: "Outer Ring Road", odometer: 12410, odometerUnit: "km", ...over,
});

test("a date must be real, whatever the model sends", () => {
  expect(isRealDate("2026-11-27")).toBe(true);
  for (const d of ["2026-02-31", "2026-27-11", "27/11/2026", "", "2026-1-1"]) expect(isRealDate(d)).toBe(false);
});

test("any two of amount, quantity and rate give the third", () => {
  expect(reconcile({ amountMinor: 100_000, unitPriceMinor: 10_000 }, "INR")).toEqual({ amountMinor: 100_000, quantityMilli: 10_000 });
  expect(reconcile({ quantityMilli: 9720, unitPriceMinor: 10_286 }, "INR")).toEqual({ amountMinor: 99_980, quantityMilli: 9720 });
  expect(reconcile({ amountMinor: 100_000, quantityMilli: 9720 }, "INR")).toEqual({ amountMinor: 100_000, quantityMilli: 9720 });
});

test("three that agree within rounding pass; three that do not are a misread", () => {
  expect(reconcile({ amountMinor: 100_000, quantityMilli: 9720, unitPriceMinor: 10_286 }, "INR").issue).toBeUndefined();
  expect(reconcile({ amountMinor: 100_000, quantityMilli: 8720, unitPriceMinor: 10_286 }, "INR")).toEqual({ issue: "mismatch" });
});

test("one number alone says what is missing", () => {
  expect(reconcile({ amountMinor: 100_000 }, "INR")).toEqual({ amountMinor: 100_000, issue: "quantity" });
  expect(reconcile({ quantityMilli: 9720 }, "INR")).toEqual({ quantityMilli: 9720, issue: "amount" });
  expect(reconcile({}, "INR")).toEqual({ issue: "amount" });
});

test("an odometer must move forward, not too far, and stay under the next reading", () => {
  expect(odometerFits(12_410_000, { prevOdometerM: 12_000_000 })).toBe(true);
  expect(odometerFits(12_000_000, { prevOdometerM: 12_000_000 })).toBe(false);
  expect(odometerFits(16_000_000, { prevOdometerM: 12_000_000 })).toBe(false);
  expect(odometerFits(12_410_000, { prevOdometerM: 12_000_000, nextOdometerM: 12_300_000 })).toBe(false);
  expect(odometerFits(500_000, {})).toBe(true);
});

test("a clean read has every field and nothing to look at", () => {
  const r = validateRead(answer(), ctx);
  expect(r.issues).toEqual([]);
  expect(r.fields).toEqual({ amountMinor: 100_000, quantityMilli: 9720, date: "2026-11-27", time: "18:04", odometerM: 12_410_000, stationName: "Sri Sai Fuel Station", stationBrand: "Indian Oil", stationAddress: "Outer Ring Road" });
  expect(r.kinds).toEqual({ bill: 1, odometer: 1 });
});

test("a bill alone is enough: no odometer photo is not an issue", () => {
  const r = validateRead(answer({ photos: ["bill"], odometer: null, odometerUnit: null }), ctx);
  expect(r.issues).toEqual([]);
  expect(r.fields.odometerM).toBeUndefined();
});

test("an odometer photo that could not be read, or reads backwards, needs a look", () => {
  expect(validateRead(answer({ odometer: null }), ctx).issues).toEqual(["odometer"]);
  const back = validateRead(answer({ odometer: 11900 }), ctx);
  expect(back.issues).toEqual(["odometer"]);
  expect(back.fields.odometerM).toBeUndefined();
});

test("numbers that disagree are not saved", () => {
  const r = validateRead(answer({ quantity: 8.72 }), ctx);
  expect(r.issues).toContain("mismatch");
  expect(r.fields.amountMinor).toBeUndefined();
});

test("no readable date falls back to when the photo was taken", () => {
  for (const date of [null, "2026-27-11", "2027-01-01", "2024-01-01"]) {
    expect(validateRead(answer({ date }), ctx).fields).toMatchObject({ date: "2026-11-27", time: "18:10" });
  }
});

test("more fuel than the tank holds needs a look", () => {
  expect(validateRead(answer({ unitPrice: null, quantity: 20 }), { ...ctx, tankMilli: 12_000 }).issues).toEqual(["tank"]);
});

test("miles are turned into metres; another currency on the bill is reported", () => {
  const r = validateRead(answer({ odometer: 7700, odometerUnit: "mi", currency: "usd" }), ctx);
  expect(r.fields.odometerM).toBe(Math.round(7700 * 1609.344));
  expect(r.fields.currency).toBe("USD");
});

test("photos of nothing useful, or an answer that is not one, are unreadable", () => {
  expect(validateRead(answer({ photos: ["other"] }), ctx).issues).toEqual(["unreadable"]);
  for (const raw of [null, "nope", {}, { photos: "bill" }]) expect(validateRead(raw, ctx).issues).toEqual(["unreadable"]);
});

test("text is cut to length and never trusted to be a string", () => {
  const r = validateRead(answer({ stationName: "x".repeat(300), stationBrand: 42 }), ctx);
  expect(r.fields.stationName).toHaveLength(80);
  expect(r.fields.stationBrand).toBeUndefined();
});
