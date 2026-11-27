/**
 * Sending a fill-up to UnMoney as an expense: a POST to the rider's private UnMoney link
 * (settings.unmoney), from the server, so it also works for a fill-up read while the app is
 * closed. One mechanism for the button and for "send every fill-up". UnMoney treats `ref` as an
 * idempotency key, so a retry cannot make a second entry. The receiving end is UnMoney's
 * convex/unfuel.ts (POST /unfuel/<token>): it answers in one plain sentence, 200 when the fill-up is
 * in (or already was), 401 for a link that no longer works, 4xx for a fill-up it cannot take.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { minorToDecimalString } from "./lib/money";
import { stationName } from "./lib/stations";
import { checkUnmoneyUrl, settingsOf } from "./settings";

const RETRY_AFTER_MS = [60_000, 600_000, 3_600_000];
const UNREACHABLE = "UnMoney could not be reached";
const UNIT = { petrol: "L petrol", diesel: "L diesel", cng: "kg CNG" } as const;

/** What goes over, or null when there is nothing to send (deleted, already sent, UnMoney disconnected). */
export const payload = internalQuery({
  args: { fillUpId: v.id("fillUps") },
  handler: async (ctx, { fillUpId }) => {
    const f = await ctx.db.get(fillUpId);
    if (!f || f.deletedAt || f.status !== "done" || f.unmoneySentAt || !f.amountMinor || !f.quantityMilli) return null;
    const link = (await settingsOf(ctx, f.userId))?.unmoney?.url;
    if (!link) return null;
    const [vehicle, station] = [await ctx.db.get(f.vehicleId), f.stationId ? await ctx.db.get(f.stationId) : null];
    const description = [`${(f.quantityMilli / 1000).toFixed(2)} ${UNIT[vehicle?.fuelType ?? "petrol"]}`, vehicle?.name, station && stationName(station)].filter(Boolean).join(" · ");
    return {
      url: link,
      body: { v: 1, source: "unfuel", ref: f._id, amount: minorToDecimalString(f.amountMinor, f.currency), currency: f.currency, date: f.date, time: f.time ?? null, note: "Fuel", description, category: "Fuel" },
    };
  },
});

export const settle = internalMutation({
  args: { fillUpId: v.id("fillUps"), error: v.optional(v.string()) },
  handler: async (ctx, { fillUpId, error }) => {
    if (!(await ctx.db.get(fillUpId))) return null;
    await ctx.db.patch("fillUps", fillUpId, error ? { unmoneyError: error } : { unmoneySentAt: Date.now(), unmoneyError: undefined });
    return null;
  },
});

export const send = internalAction({
  args: { fillUpId: v.id("fillUps"), attempt: v.number() },
  handler: async (ctx, { fillUpId, attempt }): Promise<null> => {
    const job = await ctx.runQuery(internal.unmoney.payload, { fillUpId });
    if (!job) return null;
    let error = UNREACHABLE;
    try {
      // checked again here: the action is the only place a rider's data leaves for another host
      const res = await fetch(checkUnmoneyUrl(job.url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job.body) });
      if (res.ok) { await ctx.runMutation(internal.unmoney.settle, { fillUpId }); return null; }
      // UnMoney said no, in a sentence of its own (the link is off, another currency, a deleted payment
      // method): trying again would get the same answer, so the rider is told instead
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        const said = (await res.text()).replace(/\s+/g, " ").trim().slice(0, 200);
        error = said || "UnMoney did not accept the fill-up";
      }
    } catch (e) {
      console.error("unmoney send failed", e instanceof Error ? e.message : e);
    }
    const wait = RETRY_AFTER_MS[attempt];
    if (wait === undefined || error !== UNREACHABLE) await ctx.runMutation(internal.unmoney.settle, { fillUpId, error });
    else await ctx.scheduler.runAfter(wait, internal.unmoney.send, { fillUpId, attempt: attempt + 1 });
    return null;
  },
});
