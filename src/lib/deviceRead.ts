/**
 * Reading a fill-up's photos on the device, with no AI: for accounts Claude does not read for, and
 * when it cannot (the monthly cap, a failed read). The photo's own details first (src/lib/exif.ts),
 * then the bill's text, then, on a photo with no amount on it, the odometer. Whatever is found
 * fills the form for the rider to check; nothing is saved from here. The engine (src/lib/ocr.ts)
 * is its own chunk, loaded the first time it is needed.
 */
import type { ReadContext } from "@convex/lib/fuelRead";
import { bump } from "./counters";
import { pickOdometer, readBill, type BillRead } from "./fuelText";

export type DeviceRead = BillRead & { odometerM?: number };
/** The fields a read can fill, as the form names them. */
export const filledOf = (r: DeviceRead): string[] => (["amountMinor", "quantityMilli", "date", "odometerM", "stationName"] as const).filter((k) => r[k] !== undefined);

export async function readOnDevice(photos: Blob[], ctx: Pick<ReadContext, "today" | "currency" | "prevOdometerM" | "nextOdometerM">): Promise<DeviceRead> {
  const out: DeviceRead = {};
  try {
    const { readText, readDigits } = await import("./ocr");
    for (const photo of photos) {
      const bill = await readText<BillRead>(photo, (lines) => { const value = readBill(lines, ctx.today, ctx.currency); return { found: !!value.amountMinor, value }; }, {});
      // the first photo to give each field wins: a second bill photo does not overwrite the first
      for (const k of Object.keys(bill) as (keyof BillRead)[]) if (out[k] === undefined && bill[k] !== undefined) (out as Record<string, unknown>)[k] = bill[k];
      if (!bill.amountMinor && !bill.quantityMilli && out.odometerM === undefined) {
        const m = pickOdometer(await readDigits(photo), ctx);
        if (m !== null) out.odometerM = m;
      }
    }
  } catch {
    // the engine could not load (first use with no signal): the form opens empty
  }
  bump("deviceReads");
  bump("deviceFieldsFound", filledOf(out).length);
  return out;
}
