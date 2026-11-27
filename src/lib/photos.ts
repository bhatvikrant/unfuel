/**
 * A photo the rider picked, on its way to a fill-up: its own details read (src/lib/exif.ts), then
 * optimised (src/lib/image.ts). The original stays in memory only for reading on the device and
 * is never uploaded or stored.
 */
import { readExif, type PhotoMeta } from "./exif";
import { optimisePhoto } from "./image";

export type Picked = { key: string; original: Blob; blob: Blob; url: string; meta: PhotoMeta; takenAt: number };

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, "");

export async function pickPhoto(file: File): Promise<Picked> {
  // EXIF sits at the start of the file: the first 256 KB is plenty and keeps a 12 MP photo out of memory twice
  const meta = readExif(await file.slice(0, 256 * 1024).arrayBuffer());
  const blob = await optimisePhoto(file);
  return { key: `photo_${uid()}`, original: file, blob, url: URL.createObjectURL(blob), meta, takenAt: file.lastModified || Date.now() };
}

/** Ask the browser not to evict what this site keeps (queued photos): granted quietly to installed apps and sites in regular use. */
export function keepStorage(): void {
  void navigator.storage?.persist?.().catch(() => {});
}
