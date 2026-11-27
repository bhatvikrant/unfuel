/**
 * What a fuel bill says, from the text OCR read off it on the device: amount, quantity, price per
 * litre, date, and the station's name. Pure. Like receiptAmount.ts, every rule errs towards giving
 * up: a wrong number filled in quietly is worse than an empty field. The three numbers are held to
 * the same sum as an AI read (convex/lib/fuelRead.ts reconcile): numbers read less surely count
 * only when they agree with each other.
 */
import { addDays, isRealDate, odometerFits, reconcile } from "@convex/lib/fuelRead";
import { currencyDecimals } from "@convex/lib/money";
import { BRANDS, brandOf } from "@convex/lib/stations";
import { BACKED_UP_CONFIDENCE, MIN_WORD_CONFIDENCE, parseAmount, pickAmount, type OcrLine, type OcrWord } from "./receiptAmount";

const text = (l: OcrLine) => l.words.map((w) => w.text).join(" ");

// OCR reads the letter O for a zero and l or I for a one inside numbers
const digits = (s: string) => s.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1");

/** A quantity or a rate as printed: "9.43", "9.430", "102,86", "Rs.102.86/L". Plain decimals only; not a date, a time or a bill number. */
export function parseDecimal(word: string): number | null {
  const s = digits(word).replace(/^(rs\.?|inr|₹|[:=(])+/i, "").replace(/(\/-|\/?(ltrs?|l|kg)\.?|[:;)])+$/i, "");
  if (!/^\d{1,5}([.,]\d{1,3})?$/.test(s) || /^0\d/.test(s)) return null;
  const n = Number(s.replace(",", "."));
  return n > 0 ? n : null;
}

const QUANTITY = /\b(vol(ume)?|qty|quantity|lit(re|er)s?|ltrs?|kgs?)\b/i;
const RATE = /\b(rate|price|ppu|unit\s*price)\b|(rs|₹)\.?\s*\/\s*(l|ltr|kg)\b/i;
const AMOUNT = /\b(amount|amt|sale|total|net)\b/i;
/** Lines that carry a number but are none of the three. */
const NOISE = /\b(bill|invoice|receipt|txn|trans|nozzle|pump|tin|gst|gstin|vat|mob|ph|tel|vehicle|veh|density|preset|token|slip|id)\b/i;

type Found = { value: number; sure: boolean };

/** The number a labelled line gives: its last one, or the first on the next line when the label stands alone. */
function labelled(lines: OcrLine[], label: RegExp, not: RegExp[], parse: (w: string) => number | null): Found | null {
  for (let i = 0; i < lines.length; i++) {
    const t = text(lines[i]);
    if (!label.test(t) || not.some((n) => n.test(t))) continue;
    const on = (l: OcrLine | undefined): Found[] => (l?.words ?? []).filter((w) => w.confidence >= BACKED_UP_CONFIDENCE).flatMap((w) => {
      const value = parse(w.text);
      return value === null ? [] : [{ value, sure: w.confidence >= MIN_WORD_CONFIDENCE }];
    });
    const here = on(lines[i]);
    if (here.length) return here[here.length - 1];
    const next = lines[i + 1];
    const below = next && ![QUANTITY, RATE, AMOUNT, NOISE].some((r) => r.test(text(next))) ? on(next) : [];
    if (below.length) return below[0];
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The date and time printed on a bill. An all-number date is read day first, except where the
 * currency's country writes the month first; a date that is not real, is in the future or is over a
 * year old is no date. `today` is the rider's own day.
 */
export function findDate(lines: OcrLine[], today: string, currency: string): { date?: string; time?: string } {
  const all = lines.map(text).join("\n");
  const ok = (y: number, m: number, d: number) => {
    const iso = `${y < 100 ? 2000 + y : y}-${pad(m)}-${pad(d)}`;
    return isRealDate(iso) && iso <= addDays(today, 1) && iso >= addDays(today, -366) ? iso : undefined;
  };
  let date: string | undefined;
  for (const m of all.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) {
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    date = currency === "USD" ? ok(y, a, b) ?? ok(y, b, a) : ok(y, b, a) ?? ok(y, a, b);
    if (date) break;
  }
  if (!date) for (const m of all.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) { date = ok(+m[1], +m[2], +m[3]); if (date) break; }
  if (!date) for (const m of all.matchAll(/\b(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s,-]+(\d{4}|\d{2})\b/g)) {
    const month = MONTHS.indexOf(m[2].toLowerCase());
    date = month < 0 ? undefined : ok(+m[3], month + 1, +m[1]);
    if (date) break;
  }
  if (!date) return {};
  const t = /\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\s*([AaPp][Mm])?\b/.exec(all);
  if (!t) return { date };
  let h = +t[1];
  if (t[3]) h = (h % 12) + (/p/i.test(t[3]) ? 12 : 0);
  return { date, time: `${pad(h)}:${t[2]}` };
}

/** Lines that open the body of a bill: everything above the first of them is the header. */
const BODY = /\b(bill|invoice\s*no|receipt\s*no|txn|trans|date|dt|time|nozzle|pump|product|prod|rate|volume|qty|amount|vehicle|preset)\b/i;
const TITLE = /\b(tax\s*invoice|original|duplicate|welcome|cash\s*memo|customer\s*copy|thank|visit)\b/i;
const STATION_WORD = /\b(fuel|fuels|filling|service\s*station|petroleum|petro|auto|automobiles|enterprises|agenc(y|ies)|traders|brothers|bros|sons|highway|centre|center)\b/i;
const HEADER_LINES = 8;

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());

/**
 * The station as the top of a bill names it: the oil company from a list of known ones, and the
 * dealer's name from the first clearly read header line that is not a brand, a title or a number.
 * A line with a station word ("Fuel Station", "Enterprises") beats an earlier one without. There
 * is no sum to check a name against, so an unclear header gives no name.
 */
export function stationFromHeader(lines: OcrLine[]): { name?: string; brand?: string } {
  const end = lines.findIndex((l) => BODY.test(text(l)));
  const header = lines.slice(0, Math.min(end < 0 ? HEADER_LINES : end, HEADER_LINES));
  const fix = (t: string) => t.replace(/0/g, "O").replace(/1/g, "I");
  let brand: string | undefined;
  const names: { name: string; marked: boolean }[] = [];
  for (const line of header) {
    const t = text(line).replace(/\s+/g, " ").trim();
    const b = brandOf(t) ?? brandOf(fix(t));
    brand ??= b;
    // what is left of the line once the oil company's name is taken out of it
    let rest = t;
    for (const x of BRANDS) rest = rest.replace(new RegExp(x.forms.source, "gi"), " ");
    rest = rest.replace(/\b(corporation|corp|ltd|limited|dealers?|dealer\s*of)\b\.?/gi, " ").replace(/[^A-Za-z&.' -]/g, " ").replace(/\s+/g, " ").trim();
    const words = rest.split(" ").filter((w) => /^[A-Za-z&.']{2,}$/.test(w));
    const letters = t.replace(/[^A-Za-z]/g, "").length, numbers = t.replace(/\D/g, "").length;
    if (TITLE.test(t) || words.length < 2 || numbers > letters / 2) continue;
    const read = line.words.filter((w) => /[A-Za-z]{2}/.test(w.text));
    if (!read.length || read.reduce((n, w) => n + w.confidence, 0) / read.length < MIN_WORD_CONFIDENCE) continue;
    names.push({ name: titleCase(words.join(" ")).slice(0, 60), marked: STATION_WORD.test(rest) });
  }
  const name = (names.find((n) => n.marked) ?? names[0])?.name;
  return { ...(name ? { name } : {}), ...(brand ? { brand } : {}) };
}

export type BillRead = { amountMinor?: number; quantityMilli?: number; date?: string; time?: string; stationName?: string; stationBrand?: string };

/**
 * A fuel bill's fields from its text. Amount, quantity and rate come from their labelled lines; the
 * amount also from UnMoney's stricter rules for totals. Two of the three read with confidence give
 * the third; all three count even when read less surely, as long as they agree. Otherwise only an
 * amount found by the strict rules is kept.
 */
export function readBill(lines: OcrLine[], today: string, currency: string): BillRead {
  const one = 10 ** currencyDecimals(currency);
  const quantity = labelled(lines, QUANTITY, [RATE, NOISE], parseDecimal);
  const rate = labelled(lines, RATE, [NOISE], parseDecimal);
  const strict = pickAmount(lines);
  const amount: Found | null = strict !== null ? { value: strict, sure: true } : labelled(lines, AMOUNT, [RATE, QUANTITY, NOISE], parseAmount);
  const out: BillRead = { ...findDate(lines, today, currency) };

  const minor = (f: Found | null) => (f ? Math.round(f.value * one) : undefined);
  const all = reconcile({ amountMinor: minor(amount), quantityMilli: quantity ? Math.round(quantity.value * 1000) : undefined, unitPriceMinor: rate ? rate.value * one : undefined }, currency);
  const three = !!(amount && quantity && rate);
  // three numbers that agree vouch for each other; two must each be read with confidence
  const trusted = three ? !all.issue : [amount, quantity, rate].filter((f) => f?.sure).length >= 2 && [amount, quantity, rate].filter(Boolean).every((f) => f!.sure);
  if (trusted && all.amountMinor && all.quantityMilli) { out.amountMinor = all.amountMinor; out.quantityMilli = all.quantityMilli; }
  else if (strict !== null && !three) out.amountMinor = Math.round(strict * one);

  const station = stationFromHeader(lines);
  if (station.name) out.stationName = station.name;
  if (station.brand) out.stationBrand = station.brand;
  return out;
}

/**
 * The odometer among the runs of digits read off a dashboard, in metres: the longest whole number
 * of three to seven digits that sits after the last fill-up's reading by a believable distance.
 * With no earlier reading there is nothing to check against, so it must be read with confidence.
 */
export function pickOdometer(words: OcrWord[], ctx: { prevOdometerM?: number; nextOdometerM?: number }): number | null {
  const checked = ctx.prevOdometerM !== undefined;
  const fits = words.flatMap((w) => {
    // a tenths digit after a point is dropped: "12345.6"
    const s = digits(w.text).replace(/[.,]\d$/, "").replace(/\D/g, "");
    if (s.length < 3 || s.length > 7 || w.confidence < (checked ? BACKED_UP_CONFIDENCE : MIN_WORD_CONFIDENCE)) return [];
    const m = Number(s) * 1000;
    return m > 0 && odometerFits(m, ctx) ? [{ m, len: s.length, confidence: w.confidence }] : [];
  });
  if (!fits.length) return null;
  fits.sort((a, b) => b.len - a.len || b.confidence - a.confidence);
  // two different readings as likely as each other: no answer
  if (fits.length > 1 && fits[1].len === fits[0].len && fits[1].m !== fits[0].m && checked === false) return null;
  return fits[0].m;
}
