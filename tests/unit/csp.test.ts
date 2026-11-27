// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const headers = () => (JSON.parse(read("vercel.json")) as { headers: { headers: { key: string; value: string }[] }[] }).headers.flatMap((h) => h.headers);

test("the Content-Security-Policy allows index.html's inline script, by its hash", () => {
  // vercel.json names the one inline script by hash. Edit that script and the browser refuses to run it
  // (a dark-mode device flashes light on every launch) until the hash there is replaced with the one printed here.
  const inline = [...read("index.html").matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const csp = headers().find((h) => h.key === "Content-Security-Policy")!.value;
  expect(inline).toHaveLength(1);
  for (const script of inline) expect(csp).toContain(`'sha256-${createHash("sha256").update(script).digest("base64")}'`);
});

test("the app may ask where the rider is, and nothing else of the device", () => {
  const policy = headers().find((h) => h.key === "Permissions-Policy")!.value;
  expect(policy).toContain("geolocation=(self)");
  expect(policy).toContain("camera=()");
});
