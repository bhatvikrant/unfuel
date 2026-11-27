import { expect, type Page } from "@playwright/test";

/** A 1×1 PNG: enough of a photo for the upload path. */
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/**
 * Sign up a fresh account through the test-only password provider (convex/auth.ts: local
 * deployments with E2E_AUTH=1 only; src/pages/Landing.tsx exposes the hook in dev builds).
 */
export async function signUp(page: Page, email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@unfuel.test`): Promise<string> {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__e2eSignIn === "function");
  await page.evaluate((e) => window.__e2eSignIn!({ email: e, password: "e2e-password-1", flow: "signUp", name: "E2E Rider" }), email);
  await expect(page.getByRole("heading", { name: "My vehicle" })).toBeVisible();
  return email;
}

export type Typed = { date: string; amount: string; fuel: string; odometer?: string; note?: string; photo?: boolean };

/** Add a fill-up by typing it, as a rider would. */
export async function addTyped(page: Page, f: Typed) {
  await page.goto("/add");
  if (f.photo) await page.getByTestId("gallery-input").setInputFiles({ name: "bill.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Type it instead" }).click();
  await page.locator('input[type="date"]').fill(f.date);
  await page.getByLabel("Amount paid").fill(f.amount);
  await page.getByLabel("Fuel in L").fill(f.fuel);
  if (f.odometer) await page.getByLabel("Odometer in km").fill(f.odometer);
  if (f.note) await page.getByPlaceholder("Serviced, highway trip…").fill(f.note);
  await page.getByRole("button", { name: "Save fill-up" }).click();
  await expect(page).toHaveURL("/");
}

/** Rows of a table in the device's offline store (src/offline/db.ts). */
export const idbCount = (page: Page, store: "outbox" | "blobs") => page.evaluate((s) => new Promise<number>((resolve) => {
  const open = indexedDB.open("unfuel-offline");
  open.onsuccess = () => {
    const count = open.result.transaction(s, "readonly").objectStore(s).count();
    count.onsuccess = () => { resolve(count.result); open.result.close(); };
  };
  open.onerror = () => resolve(-1);
}), store);
