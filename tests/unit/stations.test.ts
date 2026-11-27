import { expect, test } from "vitest";
import { brandOf, haversineM, nearestOwn, pickByText, pickStation, stationName, type Candidate } from "@convex/lib/stations";

const c = (placeId: string, name: string, distanceM?: number): Candidate => ({ placeId, name, distanceM });

test("distance between two points", () => {
  // one thousandth of a degree of latitude is about 111 m
  expect(haversineM({ lat: 12.935, lng: 77.625 }, { lat: 12.936, lng: 77.625 })).toBeCloseTo(111.2, 0);
  expect(haversineM({ lat: 12.935, lng: 77.625 }, { lat: 12.935, lng: 77.625 })).toBe(0);
});

test("the rider's own nearest station within 150 m, else none", () => {
  const mine = [{ id: "far", lat: 12.94, lng: 77.625 }, { id: "near", lat: 12.9355, lng: 77.625 }, { id: "nowhere" }];
  expect(nearestOwn(mine, { lat: 12.935, lng: 77.625 })?.id).toBe("near");
  expect(nearestOwn(mine, { lat: 13.5, lng: 77.625 })).toBeNull();
});

test("brands in the forms bills and Google use", () => {
  expect(brandOf("IOCL DEALER")).toBe("Indian Oil");
  expect(brandOf("Hindustan Petroleum Corporation")).toBe("HP");
  expect(brandOf("Jio-bp Mobility Station")).toBe("Jio-bp");
  expect(brandOf("Sri Sai Fuel Station")).toBeUndefined();
});

test("one result nearby is the station", () => {
  expect(pickStation([c("a", "HP Petrol Pump", 40)])?.placeId).toBe("a");
});

test("several results: the one the bill names, by brand and by name", () => {
  const near = [c("a", "Shell", 30), c("b", "Indian Oil - Sri Sai Fuel Station", 70), c("c", "Indian Oil Petrol Pump", 90)];
  expect(pickStation(near, { brand: "Indian Oil", name: "Sri Sai Fuel Station" })?.placeId).toBe("b");
  expect(pickStation(near, { brand: "Shell" })?.placeId).toBe("a");
  // the bill's brand is not among them: no guess
  expect(pickStation(near, { brand: "Nayara" })).toBeNull();
});

test("several results and no bill: the nearest only when it is very near and clearly nearest", () => {
  expect(pickStation([c("a", "Shell", 25), c("b", "HP", 140)])?.placeId).toBe("a");
  expect(pickStation([c("a", "Shell", 50), c("b", "HP", 70)])).toBeNull();
  expect(pickStation([c("a", "Shell", 90), c("b", "HP", 400)])).toBeNull();
  expect(pickStation([])).toBeNull();
});

test("two stations of the same brand, equally near, with nothing else to go on: no guess", () => {
  expect(pickStation([c("a", "HP Petrol Pump", 60), c("b", "HP Petrol Pump", 60)], { brand: "HP" })).toBeNull();
});

test("a text search result needs the brand and a word of the name", () => {
  const found = [c("a", "Indian Oil - Sri Sai Fuel Station"), c("b", "Indian Oil Petrol Pump")];
  expect(pickByText(found, { brand: "Indian Oil", name: "Sri Sai Fuel Station" })?.placeId).toBe("a");
  expect(pickByText(found, { brand: "Indian Oil" })).toBeNull();
});

test("the name shown: the rider's, then Google's, then the bill's", () => {
  expect(stationName({ customName: "Home pump", googleName: "HP Petrol Pump", billName: "Sri Sai" })).toBe("Home pump");
  expect(stationName({ googleName: "HP Petrol Pump", billName: "Sri Sai" })).toBe("HP Petrol Pump");
  expect(stationName({ billName: "Sri Sai Fuel Station", billBrand: "Indian Oil" })).toBe("Indian Oil · Sri Sai Fuel Station");
  expect(stationName({ billBrand: "Shell" })).toBe("Shell station");
  expect(stationName({})).toBe("Fuel station");
});
