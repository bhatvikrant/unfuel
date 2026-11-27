/**
 * When and where a photo was taken, from its EXIF block, read before the photo is optimised
 * (the re-encode drops it). JPEG only, which is what cameras write; anything else, or a file a
 * picker stripped, answers {}. No dependency: the few tags needed are read by hand.
 */

export type PhotoMeta = { date?: string; time?: string; lat?: number; lng?: number };

const TAG = { exifIfd: 0x8769, gpsIfd: 0x8825, dateTimeOriginal: 0x9003, dateTime: 0x0132, latRef: 1, lat: 2, lngRef: 3, lng: 4 };

export function readExif(buf: ArrayBuffer): PhotoMeta {
  try {
    return parse(new DataView(buf));
  } catch {
    return {}; // a truncated or odd file is just a photo with no details
  }
}

function parse(v: DataView): PhotoMeta {
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return {};
  // walk the JPEG segments to APP1 "Exif\0\0"
  let at = 2;
  while (at + 4 <= v.byteLength) {
    const marker = v.getUint16(at), size = v.getUint16(at + 2);
    if (marker === 0xffe1 && v.getUint32(at + 4) === 0x45786966) return tiff(v, at + 10);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    at += 2 + size;
  }
  return {};
}

function tiff(v: DataView, base: number): PhotoMeta {
  const le = v.getUint16(base) === 0x4949;
  const u16 = (o: number) => v.getUint16(o, le), u32 = (o: number) => v.getUint32(o, le);
  /** Every entry of the directory at `offset`: tag → [type, count, where its value is]. */
  const dir = (offset: number) => {
    const out = new Map<number, { type: number; count: number; at: number }>();
    const n = u16(base + offset);
    for (let i = 0; i < n; i++) {
      const e = base + offset + 2 + i * 12;
      const type = u16(e + 2), count = u32(e + 4);
      const bytes = count * ([0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8][type] ?? 1);
      out.set(u16(e), { type, count, at: bytes <= 4 ? e + 8 : base + u32(e + 8) });
    }
    return out;
  };
  const ascii = (e?: { count: number; at: number }) => (e ? Array.from({ length: e.count }, (_, i) => String.fromCharCode(v.getUint8(e.at + i))).join("").replace(/\0+$/, "") : "");
  const rational = (o: number) => u32(o) / (u32(o + 4) || 1);

  const root = dir(u32(base + 4));
  const meta: PhotoMeta = {};
  const exif = root.get(TAG.exifIfd);
  const stamp = ascii((exif && dir(u32(exif.at)).get(TAG.dateTimeOriginal)) ?? root.get(TAG.dateTime));
  // "2026:11:27 18:04:12"
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(stamp);
  if (m && m[1] !== "0000") { meta.date = `${m[1]}-${m[2]}-${m[3]}`; meta.time = `${m[4]}:${m[5]}`; }

  const gps = root.get(TAG.gpsIfd);
  if (gps) {
    const g = dir(u32(gps.at));
    const deg = (e?: { count: number; at: number }) => (e && e.count === 3 ? rational(e.at) + rational(e.at + 8) / 60 + rational(e.at + 16) / 3600 : NaN);
    const lat = deg(g.get(TAG.lat)) * (ascii(g.get(TAG.latRef)) === "S" ? -1 : 1);
    const lng = deg(g.get(TAG.lng)) * (ascii(g.get(TAG.lngRef)) === "W" ? -1 : 1);
    // 0,0 is what a camera with no fix writes
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) { meta.lat = lat; meta.lng = lng; }
  }
  return meta;
}
