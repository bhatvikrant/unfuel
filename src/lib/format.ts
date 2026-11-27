/** How numbers, money and dates are written everywhere in the app. One place, so a screen never rolls its own. */
import { currencyDecimals, formatMoney } from "@convex/lib/money";
import { costPerKm, kmPerUnit, per100km, type Rate } from "@convex/lib/mileage";

/** Indian grouping (1,00,000) for rupees, the browser's own otherwise. */
const localeFor = (currency: string) => (currency === "INR" ? "en-IN" : undefined);
const number = (n: number, digits = 0, locale?: string) => n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const money = (minor: number, currency: string) => formatMoney(Math.round(minor), currency, { locale: localeFor(currency) ?? navigator.language });
/** Money with no decimals when they are zero: a tile reads "₹1,000", a bill reads "₹1,000.50". */
export function moneyShort(minor: number, currency: string): string {
  const d = currencyDecimals(currency);
  if (d === 0 || Math.round(minor) % 10 ** d !== 0) return money(minor, currency);
  return new Intl.NumberFormat(localeFor(currency) ?? navigator.language, { style: "currency", currency, maximumFractionDigits: 0 }).format(Math.round(minor) / 10 ** d);
}

export const km = (m: number) => `${number(Math.round(m / 1000), 0, "en-IN")} km`;
export const UNIT = { petrol: "L", diesel: "L", cng: "kg" } as const;
export type Fuel = keyof typeof UNIT;
export const quantity = (milli: number, fuel: Fuel = "petrol") => `${number(milli / 1000, 2)} ${UNIT[fuel]}`;

export type EfficiencyUnit = "km/l" | "l/100km";
/** "43.5 km/l", or "2.3 L/100 km" for riders who think that way round. CNG is per kg. */
export function mileage(r: Rate, unit: EfficiencyUnit, fuel: Fuel = "petrol"): string {
  if (unit === "l/100km") return `${number(per100km(r), 1)} ${UNIT[fuel]}/100 km`;
  return `${number(kmPerUnit(r), 1)} km/${UNIT[fuel].toLowerCase()}`;
}
/** The bare number of a mileage, for charts and tiles that label the unit themselves. */
export const mileageValue = (r: { distanceM: number; fuelMilli: number }, unit: EfficiencyUnit) => (unit === "l/100km" ? per100km(r) : kmPerUnit(r));
export const mileageUnit = (unit: EfficiencyUnit, fuel: Fuel = "petrol") => (unit === "l/100km" ? `${UNIT[fuel]}/100 km` : `km/${UNIT[fuel].toLowerCase()}`);
export const perKm = (r: Rate, currency: string) => `${money(costPerKm(r), currency)}/km`;
/** Price per litre from an amount and a quantity. */
export const pricePerUnit = (amountMinor: number, quantityMilli: number, currency: string, fuel: Fuel = "petrol") =>
  `${money(amountMinor / (quantityMilli / 1000), currency)}/${UNIT[fuel]}`;
export const percent = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;

const pad = (n: number) => String(n).padStart(2, "0");
/** Today as the rider's own calendar day, "YYYY-MM-DD". */
export function todayISO(at = new Date()): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
export const timeHHmm = (at = new Date()) => `${pad(at.getHours())}:${pad(at.getMinutes())}`;

const asDate = (iso: string) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) || 1);
/** "10 Jan" this year, "10 Jan 2025" otherwise. */
export function day(iso: string): string {
  const d = asDate(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
}
export const dayLong = (iso: string) => asDate(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
/** "January 2026" from "2026-01". */
export const monthName = (month: string) => asDate(`${month}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
export const monthShort = (month: string) => asDate(`${month}-01`).toLocaleDateString("en-GB", { month: "short" });

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** What a thrown error should say in a toast: the server's own sentence when it sent one. */
export function errorText(e: unknown): string {
  const data = (e as { data?: unknown } | null)?.data;
  if (typeof data === "string") return data;
  if (e instanceof Error) {
    const m = e.message.match(/Uncaught (?:ConvexError|Error): ([^\n]+)/);
    if (m) return m[1];
    return e.message.length > 200 ? "Something went wrong" : e.message;
  }
  return "Something went wrong";
}
