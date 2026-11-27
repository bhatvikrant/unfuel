import { expect, test } from "@playwright/test";
import { addTyped, signUp } from "./helpers";

const SIZES = [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }];

test("no screen scrolls sideways, from a small phone to a desktop, with long names and large numbers", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page);
  await addTyped(page, { date: "2026-01-01", amount: "123456.78", fuel: "999.999", odometer: "1234567", note: "A very long note about a very long highway trip that went on and on ".repeat(4) });
  await addTyped(page, { date: "2026-01-10", amount: "98765.43", fuel: "888.888", odometer: "1299999" });
  await addTyped(page, { date: "2026-02-03", amount: "1000", fuel: "9.5", odometer: "1300400" });
  // a vehicle and a station with names as long as the fields allow
  await page.goto("/vehicles");
  await page.getByRole("button", { name: "Edit My vehicle" }).click();
  await page.getByLabel("Name").fill("Grandfather's 1987 Royal Enfield Bullet 350");
  await page.getByRole("button", { name: "Save" }).click();
  await page.goto("/history");
  await page.getByRole("link", { name: /3 Feb/ }).click();
  await page.getByRole("button", { name: "Choose the fuel station" }).click();
  await page.getByPlaceholder("Search by name").fill("Sri Venkateswara Lakshmi Narasimha Highway Fuel And Service Station Number Forty Two");
  await page.getByText("Use “").click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.goto("/history");
  const fill = await page.getByRole("link", { name: /3 Feb/ }).getAttribute("href");
  await page.goto("/stations");
  const station = await page.locator('a[href^="/stations/"]').first().getAttribute("href");

  const routes = ["/", "/add", "/history", fill!, "/stats", "/stations", station!, "/vehicles", "/more", "/privacy"];
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(scroll, `${route} at ${size.width}px is ${scroll}px wide`).toBeLessThanOrEqual(client);
    }
  }
});

test("the landing page does not scroll sideways either", async ({ page }) => {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "What you get" })).toBeVisible();
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(scroll, `landing at ${size.width}px`).toBeLessThanOrEqual(client);
  }
});
