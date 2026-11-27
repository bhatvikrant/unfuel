import { expect, test } from "@playwright/test";
import { addTyped, idbCount, signUp } from "./helpers";

test("a fill-up and its photo made with no connection wait on the device and arrive once, when it is back", async ({ page, context }) => {
  await signUp(page);
  await addTyped(page, { date: "2026-01-01", amount: "1000", fuel: "9.43", odometer: "12000" });
  // everything the app needs is on the page before the network goes
  await page.goto("/add");
  await page.getByRole("button", { name: "Type it instead" }).waitFor();

  await context.setOffline(true);
  await expect(page.getByRole("status")).toContainText("Offline");
  await page.getByTestId("gallery-input").setInputFiles({ name: "bill.png", mimeType: "image/png", buffer: (await import("./helpers")).PNG });
  await page.getByRole("button", { name: "Type it instead" }).click();
  await page.locator('input[type="date"]').fill("2026-01-10");
  await page.getByLabel("Amount paid").fill("1000");
  await page.getByLabel("Fuel in L").fill("9.5");
  await page.getByLabel("Odometer in km").fill("12410");
  await page.getByRole("button", { name: "Save fill-up" }).click();

  // shown at once, counted in the figures, and kept in the device's own store
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: /10 Jan/ })).toBeVisible();
  await expect(page.getByText("≈ 43.5 km/l").first()).toBeVisible();
  await expect(page.getByRole("status")).toContainText("1 waiting");
  expect(await idbCount(page, "outbox")).toBe(1);
  expect(await idbCount(page, "blobs")).toBe(1);

  await context.setOffline(false);
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => idbCount(page, "outbox")).toBe(0);
  await expect.poll(() => idbCount(page, "blobs")).toBe(0);
  // one fill-up, not two, and its photo is on the server now
  await page.goto("/history");
  await expect(page.getByRole("link", { name: /10 Jan/ })).toHaveCount(1);
  await page.getByRole("link", { name: /10 Jan/ }).click();
  await expect(page).not.toHaveURL(/tmp_/);
  await expect(page.getByRole("button", { name: "Photo 1, open full size" })).toBeVisible();
});
