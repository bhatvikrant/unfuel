/** One fill-up: its photos, every field to edit, what its stretch came to, and what can be done with it. */
import { CloudOff, Loader2, Send, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { currencySymbol } from "@convex/lib/currencies";
import { ISSUES } from "@convex/lib/fuelRead";
import { minorToDecimalString } from "@convex/lib/money";
import { useConfirm } from "@/components/ConfirmDialog";
import { FillFields, formOf, readForm, useFillForm } from "@/components/fill/FillForm";
import { PhotoStrip, useLocalPhotos } from "@/components/fill/Photos";
import { Card, Empty, Page, PageHeader, useGoBack } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { isTempId, useMutation, useOfflineStatus, useQuery } from "@/lib/convex";
import { filledOf, readOnDevice } from "@/lib/deviceRead";
import { day, errorText, km, mileage, perKm, quantity, todayISO } from "@/lib/format";
import { useFuel, type Fill, type Fuel } from "@/lib/fuel";

export default function FillPage() {
  const { id = "" } = useParams();
  const fuel = useFuel();
  const fill = fuel.allFills.find((f) => f._id === id);
  if (fuel.loading) return <PageHeader title="Fill-up" back="/history" />;
  if (!fill) return <><PageHeader title="Fill-up" back="/history" /><Empty title="This fill-up is not here">It may have been deleted, or belongs to another account.</Empty></>;
  // a fresh form when the fill-up changes under it (an AI read arriving, a sync giving it its real id)
  return <Detail key={`${fill._id}:${fill.status}`} fill={fill} fuel={fuel} />;
}

function Detail({ fill, fuel }: { fill: Fill; fuel: Fuel }) {
  const nav = useNavigate();
  const goBack = useGoBack();
  const confirm = useConfirm();
  const { connected } = useOfflineStatus();
  const local = isTempId(fill._id);
  const server = useQuery(api.fillUps.get, local ? "skip" : { id: fill._id });
  const localUrls = useLocalPhotos(fill.localPhotos);
  const urls = local ? localUrls : (server?.photoUrls ?? []).filter((u): u is string => !!u);
  const update = useMutation(api.fillUps.update);
  const remove = useMutation(api.fillUps.remove);
  const restore = useMutation(api.fillUps.restore);
  const retry = useMutation(api.fillUps.retryRead);
  const send = useMutation(api.fillUps.sendToUnmoney);
  const form = useFillForm(formOf(fill));
  const [filled, setFilled] = useState<string[]>([]);
  const [busy, setBusy] = useState<"save" | "read" | null>(null);

  const vehicle = fuel.vehicles.find((v) => v._id === fill.vehicleId);
  const fuelType = vehicle?.fuelType ?? "petrol";
  const stretch = fuel.stretchOf.get(fill._id);
  const issues = fill.read?.issues ?? [];
  const waiting = fill.status === "reading";

  async function save() {
    const parsed = readForm(form.form, fill.currency);
    if ("error" in parsed) { toast.error(parsed.error); return; }
    setBusy("save");
    try {
      const v = parsed.values;
      await update({
        id: fill._id, vehicleId: v.vehicleId as Id<"vehicles">, date: v.date, time: v.time ?? null, odometerM: v.odometerM ?? null,
        amountMinor: v.amountMinor, quantityMilli: v.quantityMilli, fullTank: v.fullTank, missedBefore: v.missedBefore, note: v.note ?? null,
        // only sent when the rider changed it: an untouched station stays the server's to detect
        ...(v.stationId !== (fill.stationId ?? null) ? { stationId: v.stationId as Id<"stations"> | null } : {}),
      });
      toast.success(connected ? "Saved" : "Saved on this device. It syncs when you are back online.");
      goBack("/history");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function del() {
    if (!(await confirm({ title: "Delete this fill-up?", description: "Its photos go with it. You can undo this for a moment." }))) return;
    try {
      await remove({ id: fill._id });
      nav("/history", { replace: true });
      toast("Fill-up deleted", { action: { label: "Undo", onClick: () => void restore({ id: fill._id, prev: fill } as never).catch((e) => toast.error(errorText(e))) } });
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  /** Read the stored photos on this device: when AI will not (off, the cap, a failed read). */
  async function readHere() {
    setBusy("read");
    try {
      const blobs = await Promise.all(urls.map(async (u) => (await fetch(u)).blob()));
      const before = fuel.done.filter((d) => d.odometerM !== undefined && d.date < fill.date && d.id !== fill._id).sort((a, b) => b.odometerM! - a.odometerM!)[0];
      const r = await readOnDevice(blobs, { today: todayISO(), currency: fill.currency, prevOdometerM: before?.odometerM });
      form.setForm((s) => {
        let next = { ...s, date: r.date ?? s.date, time: r.time ?? s.time, odometer: r.odometerM === undefined ? s.odometer : String(r.odometerM / 1000) };
        if (r.amountMinor) next = { ...next, amount: minorToDecimalString(r.amountMinor, fill.currency) };
        if (r.quantityMilli) next = { ...next, quantity: String(r.quantityMilli / 1000) };
        const a = Number(next.amount), q = Number(next.quantity);
        return a > 0 && q > 0 ? { ...next, price: String(Number((a / q).toFixed(2))), derived: "price" as const } : next;
      });
      setFilled(filledOf(r));
      toast.message(filledOf(r).length ? "Filled in what could be read. Check it, then save." : "Nothing could be read from the photos.");
    } catch {
      toast.error("The photos could not be read on this device");
    } finally {
      setBusy(null);
    }
  }

  const act = (run: () => Promise<unknown>, ok: string) => () => void run().then(() => toast.success(ok)).catch((e) => toast.error(errorText(e)));

  return (
    <>
      <PageHeader title={day(fill.date)} back="/history" right={<Button variant="ghost" size="icon" aria-label="Delete fill-up" onClick={() => void del()}><Trash2 className="size-4" /></Button>} />
      <Page className="space-y-4">
        {waiting ? (
          <Card className="flex items-center gap-3 text-sm">
            {local ? <CloudOff className="size-5 shrink-0 text-muted-foreground" /> : <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />}
            <div className="min-w-0">
              <div className="font-medium">{local ? "Waiting for a connection" : "Reading your photos…"}</div>
              <p className="text-muted-foreground">{local ? "The photos are kept on this device and are read once you are back online." : "This takes a few seconds. You can leave this screen, or type the numbers yourself."}</p>
            </div>
          </Card>
        ) : null}
        {fill.status === "review" ? (
          <Card className="space-y-2 border border-amber-500/40 text-sm">
            <div className="flex items-center gap-2 font-medium"><TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />Needs a look</div>
            <ul className="list-disc pl-5 text-muted-foreground">{(issues.length ? issues : ["amount"]).map((i) => <li key={i}>{ISSUES[i] ?? i}</li>)}</ul>
            <p className="text-muted-foreground">It is not in your figures until it has an amount and a quantity. Fill in what is missing and save.</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {urls.length ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void readHere()}>{busy === "read" ? "Reading…" : "Try reading on this device"}</Button> : null}
              {fuel.me?.ai && fill.photoIds.length && connected && !issues.includes("capReached") ? <Button size="sm" variant="outline" onClick={act(() => retry({ id: fill._id as Id<"fillUps"> }), "Reading again…")}><Sparkles />Read with AI again</Button> : null}
            </div>
          </Card>
        ) : null}

        {stretch ? (
          <Card className="text-sm">
            <div className="text-xs text-muted-foreground">{stretch.exact ? "This tank, full to full" : "This stretch, an estimate"}</div>
            <div className="mt-1 text-lg font-semibold tabular">{stretch.exact ? "" : "≈ "}{mileage(stretch, fuel.unit, fuelType)} · {perKm(stretch, fill.currency)}</div>
            <div className="text-muted-foreground tabular">{km(stretch.distanceM)} on {quantity(stretch.fuelMilli, fuelType)}</div>
          </Card>
        ) : null}

        <Card className="space-y-4">
          <PhotoStrip urls={urls} />
          <FillFields api={form} currencySymbol={currencySymbol(fill.currency)} fuel={fuelType} vehicles={fuel.vehicles} filled={filled}
            at={fill.lat !== undefined && fill.lng !== undefined ? { lat: fill.lat, lng: fill.lng } : null} />
          <Button size="lg" className="h-12 w-full text-base" disabled={busy !== null} onClick={() => void save()}>{busy === "save" ? "Saving…" : fill.status === "done" ? "Save changes" : "Save fill-up"}</Button>
        </Card>

        {fill.status === "done" && fuel.settings?.unmoney ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium">{fill.unmoneySentAt ? "Sent to UnMoney" : fill.unmoneyError ? "Not sent to UnMoney yet" : "UnMoney"}</div>
              <p className="text-muted-foreground">{fill.unmoneySentAt ? "Editing it here does not change it there." : fill.unmoneyError ?? (fuel.settings.unmoney.auto ? "It is sent on its own in a moment." : "Log this fill-up there as an expense.")}</p>
            </div>
            {!fill.unmoneySentAt && !local ? <Button variant="outline" onClick={act(() => send({ id: fill._id as Id<"fillUps"> }), "Sending to UnMoney…")}><Send />{fill.unmoneyError ? "Try again" : "Send to UnMoney"}</Button> : null}
          </Card>
        ) : null}
      </Page>
    </>
  );
}
