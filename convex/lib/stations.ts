/**
 * Fuel stations: how near is near, which Google result is the one, and which name to show. Pure,
 * shared by the detection on the server (convex/places.ts) and the lists in the app.
 */

/** Two fill-ups this close are at the same station. */
export const SAME_STATION_M = 150;
/** With no bill name to go by, the nearest result is taken only this close, and only if the next is twice as far. */
const SURE_WITHIN_M = 60;
/** A copy of Google's name is refetched when older than this (Places policy). */
export const GOOGLE_NAME_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type LatLng = { lat: number; lng: number };

export function haversineM(a: LatLng, b: LatLng): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The nearest of the rider's own stations within reach, by their own GPS fixes. */
export function nearestOwn<T extends { lat?: number; lng?: number }>(stations: T[], at: LatLng, within = SAME_STATION_M): T | null {
  let best: T | null = null, bestM = within;
  for (const s of stations) {
    if (s.lat === undefined || s.lng === undefined) continue;
    const m = haversineM(at, { lat: s.lat, lng: s.lng });
    if (m <= bestM) { best = s; bestM = m; }
  }
  return best;
}

/** Oil companies as bills and Google write them, each with the forms OCR and people use. */
export const BRANDS: { name: string; forms: RegExp }[] = [
  { name: "Indian Oil", forms: /\b(indian\s*oil|indianoil|iocl|ioc)\b/i },
  { name: "Bharat Petroleum", forms: /\b(bharat\s*petroleum|bpcl|bharat\s*petro)\b/i },
  { name: "HP", forms: /\b(hindustan\s*petroleum|hpcl|hp)\b/i },
  { name: "Shell", forms: /\bshell\b/i },
  { name: "Nayara", forms: /\b(nayara|essar)\b/i },
  { name: "Jio-bp", forms: /\b(jio\s*-?\s*bp|reliance)\b/i },
];
export const brandOf = (text: string): string | undefined => BRANDS.find((b) => b.forms.test(text))?.name;

const GENERIC = new Set(["fuel", "fuels", "filling", "station", "service", "petrol", "pump", "petroleum", "auto", "the", "and", "of", "co", "pvt", "ltd"]);
/** The words that tell one station from another: lower case, no brand, no "fuel station". */
export function nameWords(text: string): string[] {
  let t = text.toLowerCase();
  for (const b of BRANDS) t = t.replace(new RegExp(b.forms.source, "gi"), " ");
  return t.split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !GENERIC.has(w));
}

export type Candidate = { placeId: string; name: string; address?: string; distanceM?: number };
export type BillStation = { name?: string; brand?: string };

/** How well a Google result matches what the bill says: the brand counts, each shared word counts more. */
function matchScore(c: Candidate, bill: BillStation): number {
  const brand = bill.brand ? brandOf(bill.brand) ?? bill.brand : bill.name ? brandOf(bill.name) : undefined;
  const words = new Set(nameWords(bill.name ?? ""));
  const theirs = nameWords(c.name);
  return (brand && brandOf(c.name) === brandOf(brand) ? 1 : 0) + theirs.filter((w) => words.has(w)).length * 2;
}

/**
 * The station a fill-up was at, from Google's results nearest first, or null when it is not clear.
 * One result is it. Several with a bill name: the best match, the nearer on a tie, and no match at
 * all is no answer. Several with no bill name: the nearest, only when it is very near and the next
 * is at least twice as far. A wrong station chosen quietly is worse than an empty field.
 */
export function pickStation(candidates: Candidate[], bill: BillStation = {}): Candidate | null {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  if (bill.name || bill.brand) {
    const scored = candidates.map((c) => ({ c, score: matchScore(c, bill) })).filter((x) => x.score > 0);
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score || (a.c.distanceM ?? Infinity) - (b.c.distanceM ?? Infinity));
    // two stations of the same brand side by side, and nothing else to tell them apart
    if (scored.length > 1 && scored[0].score === scored[1].score && scored[0].c.distanceM === scored[1].c.distanceM) return null;
    return scored[0].c;
  }
  const [first, second] = candidates;
  if (first.distanceM === undefined || first.distanceM > SURE_WITHIN_M) return null;
  return second.distanceM === undefined || second.distanceM >= first.distanceM * 2 ? first : null;
}

/** A text search result is taken only when the brand and at least one other word match the bill. */
export function pickByText(candidates: Candidate[], bill: BillStation): Candidate | null {
  const hits = candidates.filter((c) => matchScore(c, bill) >= 3);
  return hits.length === 1 ? hits[0] : null;
}

export type StationNames = { customName?: string; googleName?: string; billName?: string; billBrand?: string; googleAddress?: string; billAddress?: string };

/** The name shown: the rider's own, else Google's, else the bill's, else a plain fallback. */
export function stationName(s: StationNames): string {
  if (s.customName) return s.customName;
  if (s.googleName) return s.googleName;
  if (s.billName) return s.billBrand && !brandOf(s.billName) ? `${s.billBrand} · ${s.billName}` : s.billName;
  return s.billBrand ? `${s.billBrand} station` : "Fuel station";
}
export const stationAddress = (s: StationNames): string | undefined => s.googleAddress ?? s.billAddress;
