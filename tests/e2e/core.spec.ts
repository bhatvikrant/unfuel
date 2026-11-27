import { expect, test } from "@playwright/test";
import { addTyped, signUp } from "./helpers";

test("two fill-ups give a mileage and a cost per km; a fill-up can be edited, deleted and brought back", async ({ page }) => {
  await signUp(page);
  await expect(page.getByText("Add your first fill-up")).toBeVisible();

  await addTyped(page, { date: "2026-01-01", amount: "1000", fuel: "9.43", odometer: "12000" });
  await expect(page.getByText("One more fill-up with an odometer reading")).toBeVisible();
  await addTyped(page, { date: "2026-01-10", amount: "1000", fuel: "9.5", odometer: "12410" });
  // 410 km on the 9.43 L of the fill-up before: an estimate, since neither was a full tank
  await expect(page.getByText("≈ 43.5 km/l").first()).toBeVisible();
  await expect(page.getByText("₹2.44/km").first()).toBeVisible();

  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "January 2026" })).toBeVisible();
  await page.getByRole("link", { name: /10 Jan/ }).click();
  await expect(page.getByText("410 km on 9.43 L")).toBeVisible();
  // the price per litre follows the other two numbers
  await page.getByLabel("Amount paid").fill("950");
  await expect(page.getByLabel("Price per L")).toHaveValue("100");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("link", { name: /10 Jan/ })).toContainText("₹950");

  await page.getByRole("link", { name: /10 Jan/ }).click();
  await page.getByRole("button", { name: "Delete fill-up" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("link", { name: /10 Jan/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("link", { name: /10 Jan/ })).toBeVisible();
});

test("an odometer that goes backwards is refused with the reason", async ({ page }) => {
  await signUp(page);
  await addTyped(page, { date: "2026-01-01", amount: "1000", fuel: "9.43", odometer: "12000" });
  await page.goto("/add");
  await page.getByRole("button", { name: "Type it instead" }).click();
  await page.locator('input[type="date"]').fill("2026-01-10");
  await page.getByLabel("Amount paid").fill("500");
  await page.getByLabel("Fuel in L").fill("5");
  await page.getByLabel("Odometer in km").fill("11000");
  await page.getByRole("button", { name: "Save fill-up" }).click();
  await expect(page.getByText("The odometer was already at 12000 km")).toBeVisible();
  await expect(page).toHaveURL("/add");
});

test("a photo added with a typed fill-up is kept and shown; AI is off for a new account", async ({ page }) => {
  await signUp(page);
  await page.goto("/add");
  await expect(page.getByText("AI reading is not on for this account")).toBeVisible();
  await addTyped(page, { date: "2026-01-01", amount: "800", fuel: "7.6", photo: true });
  await page.getByRole("link", { name: /1 Jan/ }).first().click();
  await expect(page.getByRole("button", { name: "Photo 1, open full size" })).toBeVisible();
});

test("signed out, every address leads to the landing page; the dashboard is closed to everyone else", async ({ page }) => {
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "Know what your vehicle really costs to run." })).toBeVisible();
  await expect(page).toHaveURL("/");
  await signUp(page);
  await page.goto("/admin");
  await expect(page).toHaveURL("/");
  await page.goto("/more");
  await expect(page.getByText("Superadmin")).toHaveCount(0);
});
