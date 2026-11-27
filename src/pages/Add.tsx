/**
 * Adding a fill-up. Photos first: the bill (or the pump's display) and the odometer, in any order.
 * An account whose photos are read by AI saves them as they are and the server reads them. Any
 * other account gets them read on the device, and checks the form that comes back. Typing is
 * always there. The same screen fixes a fill-up the server refused (`?fix=<op id>`).
 */
import { Loader2, MapPin, PencilLine } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { PHOTO_MAX_COUNT, isRealDate } from "@convex/lib/fuelRead";
import { currencySymbol } from "@convex/lib/currencies";
import { minorToDecimalString } from "@convex/lib/money";
import { FillFields, blankForm, readForm, useFillForm, type FormState } from "@/components/fill/FillForm";
import { PhotoButtons, PhotoStrip } from "@/components/fill/Photos";
import { Card, Page, PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMutation, useOffline, useOfflineStatus } from "@/lib/convex";
import { bump } from "@/lib/counters";
import { filledOf, readOnDevice, type DeviceRead } from "@/lib/deviceRead";
import { errorText, pricePerUnit, timeHHmm, todayISO } from "@/lib/format";
import { useFuel, type Fuel } from "@/lib/fuel";
import { currentPosition } from "@/lib/location";
import { keepStorage, pickPhoto, type Picked } from "@/lib/photos";
import type { FailedOp } from "@/offline/types";

/** A photo taken within this long counts as taken here and now: the phone's position is where the fill-up was. */
const RECENT_MS = 10 * 60_000;
type Place = { lat: number; lng: number; accuracyM?: number; locationSource: "device" | "photo" };

export default function AddPage() {
  const fuel = useFuel();
  const { store } = useOffline();
  const [params] = useSearchParams();
  const fix = params.get("fix");
  const failed = useMemo(() => (fix ? store.failed.find((f) => f.op.id === fix) ?? null : null), [fix, store]);
  if (fuel.loading || !fuel.vehicle) return <><PageHeader title="Add fill-up" back /><Page><Skeleton className="h-40 w-full" /></Page></>;
  return <Add key={fix ?? "new"} fuel={fuel} failed={failed} />;
}

function Add({ fuel, failed }: { fuel: Fuel; failed: FailedOp | null }) {
  const nav = useNavigate();
  const { store } = useOffline();
  const { connected } = useOfflineStatus();
  const ai = !!fuel.me?.ai;
  const createFromPhotos = useMutation(api.fillUps.createFromPhotos);
  const createManual = useMutation(api.fillUps.createManual);

  const old = (failed?.op.args ?? {}) as Record<string, never>;
  const initial: FormState = useMemo(() => {
    const blank = blankForm(old.vehicleId ?? fuel.vehicle!._id, old.date ?? todayISO(), old.time ?? timeHHmm(), old.fullTank ?? fuel.settings?.fullTankDefault ?? false);
    if (!failed) return blank;
    return {
      ...blank, missedBefore: !!old.missedBefore, note: old.note ?? "", stationId: old.stationId ?? null,
      odometer: old.odometerM === undefined ? "" : String(old.odometerM / 1000),
      amount: old.amountMinor ? minorToDecimalString(old.amountMinor, fuel.currency) : "",
      quantity: old.quantityMilli ? String(old.quantityMilli / 1000) : "",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const form = useFillForm(initial);
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [place, setPlace] = useState<Place | null>(old.lat !== undefined ? { lat: old.lat, lng: old.lng, accuracyM: old.accuracyM, locationSource: "device" } : null);
  const [step, setStep] = useState<"pick" | "reading" | "form">(failed ? "form" : "pick");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [read, setRead] = useState<DeviceRead | null>(null);
  const located = useRef(false);

  // a fill-up being fixed brings the photos that waited with it
  useEffect(() => {
    const keys = (failed?.op.extra?.blobKeys as string[] | undefined) ?? [];
    let alive = true;
    void Promise.all(keys.map(async (key) => ({ key, blob: await store.getBlob(key) }))).then((list) => {
      if (alive) setPhotos(list.flatMap(({ key, blob }) => (blob ? [{ key, original: blob, blob, url: URL.createObjectURL(blob), meta: {}, takenAt: 0 }] : [])));
    });
    return () => { alive = false; };
  }, [failed, store]);
  // addresses made for thumbnails are released when the screen closes
  const all = useRef<Picked[]>([]);
  useEffect(() => { all.current = photos; }, [photos]);
  useEffect(() => () => all.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  async function onFiles(files: File[]) {
    setAdding(true);
    keepStorage();
    const room = PHOTO_MAX_COUNT - photos.length;
    if (files.length > room) toast.message(`A fill-up takes at most ${PHOTO_MAX_COUNT} photos`);
    const picked: Picked[] = [];
    for (const file of files.slice(0, room)) {
      try {
        picked.push(await pickPhoto(file));
      } catch (e) {
        toast.error(errorText(e));
      }
    }
    setPhotos((p) => [...p, ...picked]);
    setAdding(false);
    if (!picked.length) return;
    // when: the photo's own date when it has one, so a bill photographed yesterday is yesterday's
    const dated = picked.find((p) => p.meta.date && isRealDate(p.meta.date) && p.meta.date <= todayISO());
    if (dated?.meta.date) { form.set("date", dated.meta.date); if (dated.meta.time) form.set("time", dated.meta.time); }
    // where: the phone's position for a photo taken just now, else what the photo itself recorded
    if (located.current || place) return;
    located.current = true;
    const recent = picked.some((p) => Date.now() - p.takenAt < RECENT_MS);
    const fixNow = recent ? await currentPosition() : null;
    const tagged = picked.find((p) => p.meta.lat !== undefined);
    if (fixNow) setPlace({ ...fixNow, locationSource: "device" });
    else if (tagged) setPlace({ lat: tagged.meta.lat!, lng: tagged.meta.lng!, locationSource: "photo" });
  }

  /** The photos go into the device's own store first: from here on they survive a reload or a lost connection. */
  async function keepPhotos(): Promise<string[] | null> {
    for (const p of photos) {
      if (!(await store.putBlob(p.key, p.blob))) {
        toast.error("This device has no room to keep the photos. Free some space, or remove the photos and type the fill-up.");
        return null;
      }
    }
    return photos.map((p) => p.key);
  }
  const placeArgs = place ? { lat: place.lat, lng: place.lng, accuracyM: place.accuracyM, locationSource: place.locationSource } : {};
  const finish = async (message: string) => {
    if (failed) await store.unpark(failed.op.id, false);
    toast.success(message);
    nav("/", { replace: true });
  };

  async function saveForAi() {
    setSaving(true);
    try {
      const photoKeys = await keepPhotos();
      if (!photoKeys) return;
      await createFromPhotos({ date: form.form.date, time: form.form.time || undefined, fullTank: form.form.fullTank, vehicleId: form.form.vehicleId, photoIds: [], photoKeys, ...placeArgs } as never);
      await finish(connected ? "Saved. Reading your photos…" : "Kept on this device. It is read as soon as you are back online.");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  async function readHere() {
    setStep("reading");
    const before = fuel.done.filter((d) => d.odometerM !== undefined && d.date <= form.form.date).sort((a, b) => b.odometerM! - a.odometerM!)[0];
    const r = await readOnDevice(photos.map((p) => p.original), { today: todayISO(), currency: fuel.currency, prevOdometerM: before?.odometerM });
    setRead(r);
    form.setForm((s) => {
      let next = { ...s, date: r.date ?? s.date, time: r.time ?? s.time, odometer: r.odometerM === undefined ? s.odometer : String(r.odometerM / 1000) };
      if (r.amountMinor) next = { ...next, amount: minorToDecimalString(r.amountMinor, fuel.currency) };
      if (r.quantityMilli) next = { ...next, quantity: String(r.quantityMilli / 1000) };
      const a = Number(next.amount), q = Number(next.quantity);
      return a > 0 && q > 0 ? { ...next, price: String(Number((a / q).toFixed(2))), derived: "price" } : next;
    });
    setStep("form");
  }

  async function saveTyped() {
    const parsed = readForm(form.form, fuel.currency);
    if ("error" in parsed) { toast.error(parsed.error); return; }
    setSaving(true);
    try {
      const photoKeys = await keepPhotos();
      if (!photoKeys) return;
      const v = parsed.values;
      const printed: Record<string, string> = {};
      if (read) for (const [k, x] of Object.entries(read)) if (x !== undefined) printed[k] = String(x);
      await createManual({
        ...v, stationId: v.stationId ?? undefined, photoIds: [], photoKeys, ...placeArgs,
        source: read && photos.length ? "device" : "manual",
        billStation: read?.stationName || read?.stationBrand ? { name: read.stationName, brand: read.stationBrand } : undefined,
        printed: read ? printed : undefined,
      } as never);
      // how many of the fields the device filled the rider left as they were (the dashboard's read quality)
      if (read) bump("deviceFieldsKept", [read.amountMinor === v.amountMinor, read.quantityMilli === v.quantityMilli, read.odometerM !== undefined && read.odometerM === v.odometerM, read.date === v.date].filter(Boolean).length);
      await finish(connected ? "Fill-up saved" : "Saved on this device. It syncs when you are back online.");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  const last = fuel.fills.find((x) => x.status === "done" && x.amountMinor && x.quantityMilli);
  const strip = <PhotoStrip urls={photos.map((p) => p.url)} onRemove={saving ? undefined : (i) => setPhotos((p) => { URL.revokeObjectURL(p[i].url); return p.filter((_, j) => j !== i); })} />;
  const where = place ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="size-3.5 shrink-0" />Location saved, to find the station.</p> : null;

  return (
    <>
      <PageHeader title={failed ? "Fix fill-up" : "Add fill-up"} back />
      <Page className="space-y-4">
        {failed ? <Card className="border border-destructive/30 text-sm"><span className="font-medium">This one could not be saved: </span><span className="text-muted-foreground">{failed.reason}. Correct it and save again.</span></Card> : null}

        {step === "pick" ? (
          <>
            <Card className="space-y-4">
              <div>
                <h2 className="font-medium">Photos of the bill and the odometer</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Any order, up to {PHOTO_MAX_COUNT}. No bill? Photograph the pump's display. {ai ? "They are read for you." : "This device reads what it can, and you check it."}
                </p>
              </div>
              <PhotoButtons count={photos.length} onFiles={(f) => void onFiles(f)} busy={adding || saving} />
              {adding ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Preparing the photo…</p> : null}
              {strip}
              {where}
              {photos.length ? (
                <Button size="lg" className="h-12 w-full text-base" disabled={adding || saving} onClick={() => void (ai ? saveForAi() : readHere())}>
                  {saving ? "Saving…" : ai ? "Done, read them" : "Continue"}
                </Button>
              ) : null}
              {!ai ? <p className="text-xs text-muted-foreground">AI reading is not on for this account, so photos are read on this device and sent to nobody to be read.</p> : !connected ? <p className="text-xs text-muted-foreground">You are offline. The photos are kept on this device and read once you are back online.</p> : null}
            </Card>
            <Button variant="ghost" className="w-full gap-2" onClick={() => setStep("form")}><PencilLine className="size-4" />Type it instead</Button>
          </>
        ) : null}

        {step === "reading" ? (
          <Card className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="font-medium">Reading on this device…</p>
            <p className="max-w-xs text-sm text-muted-foreground">The first time takes a little longer while the reader downloads.</p>
          </Card>
        ) : null}

        {step === "form" ? (
          <Card className="space-y-4">
            {photos.length ? strip : null}
            {read ? (
              <p className="text-sm text-muted-foreground">
                {filledOf(read).length ? "Filled in what could be read. Check the marked fields and type the rest." : "Nothing could be read from the photos. They are kept with the fill-up; type the numbers from them."}
                {read.stationName || read.stationBrand ? ` The bill names ${[read.stationBrand, read.stationName].filter(Boolean).join(" · ")}; it is matched to the real station when you save.` : ""}
              </p>
            ) : null}
            <FillFields api={form} currencySymbol={currencySymbol(fuel.currency)} fuel={fuel.fuel} vehicles={fuel.vehicles} filled={read ? filledOf(read) : []} at={place}
              prevPrice={last ? pricePerUnit(last.amountMinor!, last.quantityMilli!, last.currency, fuel.fuel) : undefined} />
            {!photos.length ? <PhotoButtons count={0} onFiles={(f) => void onFiles(f)} busy={adding || saving} /> : null}
            {where}
            <Button size="lg" className="h-12 w-full text-base" disabled={saving || adding} onClick={() => void saveTyped()}>{saving ? "Saving…" : "Save fill-up"}</Button>
          </Card>
        ) : null}
      </Page>
    </>
  );
}
