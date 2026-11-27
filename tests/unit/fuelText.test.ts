import { describe, expect, test } from "vitest";
import { findDate, parseDecimal, pickOdometer, readBill, stationFromHeader } from "@/lib/fuelText";
import type { OcrLine } from "@/lib/receiptAmount";

/** A line from text: words split on spaces, all confident unless a word ends with "?" (unsure) or "??" (unread). */
const line = (text: string, height = 20): OcrLine => ({
  height,
  words: text.split(" ").map((t) => (t.endsWith("??") ? { text: t.slice(0, -2), confidence: 40 } : t.endsWith("?") ? { text: t.slice(0, -1), confidence: 70 } : { text: t, confidence: 95 })),
});
const TODAY = "2026-11-27";

const IOCL = [
  line("INDIAN OIL CORPORATION LTD"), line("SRI SAI FUEL STATION"), line("OUTER RING ROAD KORAMANGALA"), line("BANGALORE 560034"),
  line("BILL NO: 004512"), line("DATE: 27/11/2026 TIME: 18:04"), line("NOZZLE NO: 2"), line("PRODUCT: PETROL"),
  line("RATE/LTR: 102.86"), line("VOLUME(LTR): 9.72"), line("AMOUNT(RS): 1000.00"), line("THANK YOU VISIT AGAIN"),
];

describe("parseDecimal", () => {
  test.each([["9.72", 9.72], ["9.720", 9.72], ["102,86", 102.86], ["Rs.102.86", 102.86], ["9.72L", 9.72], ["1OO.5", 100.5], ["45", 45]])("%s → %s", (w, n) => expect(parseDecimal(w)).toBe(n));
  test.each(["27/11/2026", "18:04", "004512", "abc", "1,234.56", "0", "12-5"])("%s is not a plain decimal", (w) => expect(parseDecimal(w)).toBeNull());
});

describe("readBill", () => {
  test("a clear bill: amount, litres, date, time and station", () => {
    expect(readBill(IOCL, TODAY, "INR")).toEqual({ amountMinor: 100_000, quantityMilli: 9720, date: "2026-11-27", time: "18:04", stationName: "Sri Sai Fuel Station", stationBrand: "Indian Oil" });
  });

  test("numbers read less surely still count when the three agree", () => {
    const lines = [line("HP PETROL PUMP"), line("RATE 102.86?"), line("QTY 9.72?"), line("SALE 1000.00?")];
    expect(readBill(lines, TODAY, "INR")).toMatchObject({ amountMinor: 100_000, quantityMilli: 9720 });
  });

  test("three numbers that disagree fill in nothing", () => {
    const lines = [line("RATE/LTR: 102.86"), line("VOLUME(LTR): 8.72"), line("AMOUNT(RS): 1000.00")];
    const r = readBill(lines, TODAY, "INR");
    expect(r.amountMinor).toBeUndefined();
    expect(r.quantityMilli).toBeUndefined();
  });

  test("amount and rate, both sure, give the litres", () => {
    const r = readBill([line("RATE/LTR: 100.00"), line("AMOUNT(RS): 500.00")], TODAY, "INR");
    expect(r).toMatchObject({ amountMinor: 50_000, quantityMilli: 5000 });
  });

  test("two numbers, one read unsurely: only a total found by the strict rules is kept", () => {
    const r = readBill([line("VOLUME(LTR): 9.72?"), line("TOTAL AMOUNT 1000.00")], TODAY, "INR");
    expect(r.amountMinor).toBe(100_000);
    expect(r.quantityMilli).toBeUndefined();
  });

  test("a rate line is not mistaken for the quantity, nor a bill number for the amount", () => {
    const r = readBill([line("BILL NO: 1000"), line("RATE/LTR: 102.86"), line("LTR: 9.72"), line("AMOUNT: 1000.00")], TODAY, "INR");
    expect(r).toMatchObject({ amountMinor: 100_000, quantityMilli: 9720 });
  });

  test("the number under a label that stands alone", () => {
    const r = readBill([line("RATE"), line("102.86"), line("VOLUME"), line("9.72"), line("AMOUNT"), line("1000.00")], TODAY, "INR");
    expect(r).toMatchObject({ amountMinor: 100_000, quantityMilli: 9720 });
  });

  test("nothing readable gives nothing", () => {
    expect(readBill([line("lorem?? ipsum??"), line("12?? 99??")], TODAY, "INR")).toEqual({});
  });
});

describe("findDate", () => {
  test("day first for rupees, month first for dollars", () => {
    expect(findDate([line("05/11/2026")], TODAY, "INR").date).toBe("2026-11-05");
    expect(findDate([line("05/11/2026")], TODAY, "USD").date).toBe("2026-05-11");
  });
  test("a day above 12 settles it either way", () => {
    expect(findDate([line("11/27/2026")], TODAY, "INR").date).toBe("2026-11-27");
  });
  test("two-digit years, named months, and afternoon times", () => {
    expect(findDate([line("DT 27-11-26 06:04 PM")], TODAY, "INR")).toEqual({ date: "2026-11-27", time: "18:04" });
    expect(findDate([line("27 Nov 2026")], TODAY, "INR").date).toBe("2026-11-27");
  });
  test("a date in the future, over a year old or impossible is no date", () => {
    expect(findDate([line("30/11/2026")], TODAY, "INR")).toEqual({});
    expect(findDate([line("27/11/2024")], TODAY, "INR")).toEqual({});
    expect(findDate([line("31/02/2026")], TODAY, "INR")).toEqual({});
  });
});

describe("stationFromHeader", () => {
  test.each([
    [["BHARAT PETROLEUM", "ANAND AUTO SERVICE", "MG ROAD PUNE"], "Bharat Petroleum", "Anand Auto Service"],
    [["HPCL DEALER", "SHREE GANESH ENTERPRISES"], "HP", "Shree Ganesh Enterprises"],
    [["SHELL", "WELCOME", "KRISHNA FILLING STATION"], "Shell", "Krishna Filling Station"],
    [["IOCL", "NH 48 ROAD SIDE", "HIGHWAY FUELS CENTRE"], "Indian Oil", "Highway Fuels Centre"],
    [["1ND1AN 01L", "SRI SAI FUEL STATION"], "Indian Oil", "Sri Sai Fuel Station"],
  ])("%j", (header, brand, name) => {
    expect(stationFromHeader([...header.map((h) => line(h)), line("BILL NO: 12")])).toEqual({ name, brand });
  });

  test("titles, phone numbers and tax ids are not names", () => {
    expect(stationFromHeader([line("TAX INVOICE"), line("PH: 080 25531234"), line("GSTIN 29ABCDE1234F1Z5"), line("BILL NO 7")])).toEqual({});
  });

  test("a header read unsurely gives the brand at most, never a guessed name", () => {
    expect(stationFromHeader([line("INDIAN OIL"), line("SR1?? SA1?? FUEL?? STAT10N??"), line("DATE: 27/11/2026")])).toEqual({ brand: "Indian Oil" });
  });

  test("only the lines above the bill's body are the header", () => {
    expect(stationFromHeader([line("DATE: 27/11/2026"), line("KRISHNA FILLING STATION")])).toEqual({});
  });
});

describe("pickOdometer", () => {
  const w = (text: string, confidence = 95) => ({ text, confidence });
  test("the reading that follows the last one, among a dashboard's other numbers", () => {
    expect(pickOdometer([w("62"), w("12410"), w("18:04"), w("3")], { prevOdometerM: 12_000_000 })).toBe(12_410_000);
  });
  test("a reading that went backwards or jumped too far is not offered", () => {
    expect(pickOdometer([w("11900")], { prevOdometerM: 12_000_000 })).toBeNull();
    expect(pickOdometer([w("99999")], { prevOdometerM: 12_000_000 })).toBeNull();
  });
  test("a tenths digit is dropped", () => {
    expect(pickOdometer([w("12410.6")], { prevOdometerM: 12_000_000 })).toBe(12_410_000);
  });
  test("with no earlier reading it must be read with confidence", () => {
    expect(pickOdometer([w("12410", 70)], {})).toBeNull();
    expect(pickOdometer([w("12410", 95)], {})).toBe(12_410_000);
    expect(pickOdometer([w("12410", 70)], { prevOdometerM: 12_000_000 })).toBe(12_410_000);
  });
});
