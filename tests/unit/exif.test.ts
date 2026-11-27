import { expect, test } from "vitest";
import { readExif } from "@/lib/exif";

/** A minimal JPEG with an EXIF block: DateTimeOriginal and a GPS fix, little-endian. */
function jpeg(opts: { stamp?: string; lat?: [number, number, number, "N" | "S"]; lng?: [number, number, number, "E" | "W"] }): ArrayBuffer {
  const t = new Uint8Array(400);
  const v = new DataView(t.buffer);
  let free = 200; // where values that do not fit in an entry go
  const put = (dirAt: number, i: number, tag: number, type: number, count: number, value: number | number[] | string) => {
    const e = dirAt + 2 + i * 12;
    v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, count, true);
    if (typeof value === "number") v.setUint32(e + 8, value, true);
    else if (typeof value === "string" && count <= 4) for (let k = 0; k < value.length; k++) t[e + 8 + k] = value.charCodeAt(k);
    else {
      v.setUint32(e + 8, free, true);
      if (typeof value === "string") { for (let k = 0; k < value.length; k++) t[free + k] = value.charCodeAt(k); free += count; }
      else for (const n of value) { v.setUint32(free, Math.round(n * 1000), true); v.setUint32(free + 4, 1000, true); free += 8; }
    }
  };
  t[0] = 0x49; t[1] = 0x49; v.setUint16(2, 42, true); v.setUint32(4, 8, true);
  v.setUint16(8, 2, true); // root: two entries
  put(8, 0, 0x8769, 4, 1, 40);
  put(8, 1, 0x8825, 4, 1, 60);
  v.setUint16(40, opts.stamp ? 1 : 0, true);
  if (opts.stamp) put(40, 0, 0x9003, 2, 20, opts.stamp + "\0");
  v.setUint16(60, opts.lat && opts.lng ? 4 : 0, true);
  if (opts.lat && opts.lng) {
    put(60, 0, 1, 2, 2, opts.lat[3] + "\0"); put(60, 1, 2, 5, 3, opts.lat.slice(0, 3) as number[]);
    put(60, 2, 3, 2, 2, opts.lng[3] + "\0"); put(60, 3, 4, 5, 3, opts.lng.slice(0, 3) as number[]);
  }
  const out = new Uint8Array(4 + 2 + 6 + t.length + 2);
  out.set([0xff, 0xd8, 0xff, 0xe1]);
  new DataView(out.buffer).setUint16(4, 2 + 6 + t.length);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6);
  out.set(t, 12);
  out.set([0xff, 0xd9], 12 + t.length);
  return out.buffer;
}

test("reads when and where a photo was taken", () => {
  const meta = readExif(jpeg({ stamp: "2026:11:27 18:04:12", lat: [12, 56, 6, "N"], lng: [77, 37, 30, "E"] }));
  expect(meta.date).toBe("2026-11-27");
  expect(meta.time).toBe("18:04");
  expect(meta.lat).toBeCloseTo(12.935, 3);
  expect(meta.lng).toBeCloseTo(77.625, 3);
});

test("south and west are negative", () => {
  const meta = readExif(jpeg({ lat: [33, 52, 0, "S"], lng: [70, 40, 0, "W"] }));
  expect(meta.lat).toBeCloseTo(-33.8667, 3);
  expect(meta.lng).toBeCloseTo(-70.6667, 3);
});

test("a photo with no details, or a file that is not a JPEG, answers nothing", () => {
  expect(readExif(jpeg({}))).toEqual({});
  expect(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).buffer)).toEqual({});
  expect(readExif(new ArrayBuffer(0))).toEqual({});
  expect(readExif(jpeg({ stamp: "2026:11:27 18:04:12" }).slice(0, 60))).toEqual({});
});

test("a camera with no fix writes 0,0: that is not a place", () => {
  expect(readExif(jpeg({ lat: [0, 0, 0, "N"], lng: [0, 0, 0, "E"] }))).toEqual({});
});
