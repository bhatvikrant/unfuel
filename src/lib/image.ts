/**
 * Every photo is optimised here, on the device, before it is uploaded or queued: the original
 * never leaves the phone. Longest edge capped, re-encoded once as WebP (JPEG where the browser
 * cannot write WebP), camera metadata dropped. The server refuses anything else (convex/files.ts).
 * A port of UnSplit's compressImage with UnMoney's limits.
 */
import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE } from "@convex/lib/fuelRead";
import { bump } from "./counters";

/** WebP at this quality cannot be told from the original by eye at a fraction of the size. */
const QUALITY = 0.85;
/** The fallback when the first encode is still over the limit: smaller, a little softer. */
const LOW_QUALITY = 0.7;

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** The optimised photo, or an error with a sentence for the rider when it cannot be read or is still too large. */
export async function optimisePhoto(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    // "from-image" bakes the camera's rotation in, so the orientation tag is no longer needed
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("That file is not a photo this device can open");
  }
  try {
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("That photo could not be prepared");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let type = "image/webp";
    let blob = await encode(canvas, type, QUALITY);
    // Safari can't write WebP and quietly hands back a PNG instead
    if (blob?.type !== "image/webp") {
      // JPEG has no transparency: paint it white rather than black
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      type = "image/jpeg";
      blob = await encode(canvas, type, QUALITY);
    }
    // each encode is from the decoded pixels, never from an earlier encode
    if (blob && blob.size > PHOTO_MAX_BYTES) blob = await encode(canvas, type, LOW_QUALITY);
    // a small PNG or WebP (a screenshot) is kept as it is when re-encoding would not shrink it. Never a
    // JPEG: a camera's JPEG carries the place it was taken, which only the re-encode strips.
    const keepOriginal = scale === 1 && /^image\/(webp|png)$/.test(file.type) && (!blob || file.size <= blob.size);
    const out = keepOriginal ? file : blob;
    if (!out || out.size > PHOTO_MAX_BYTES) throw new Error("That photo is too large even after shrinking");
    bump("photos");
    bump("photoBytesBefore", file.size);
    bump("photoBytesAfter", out.size);
    return out;
  } finally {
    bitmap.close();
  }
}
