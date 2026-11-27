/**
 * The one form a fill-up is typed, checked or edited in: the same fields whether it is new, was
 * filled from photos by the device, or needs a look after an AI read. Amount, quantity and price
 * per litre are three views of two numbers: type any two and the third is worked out.
 */
import { useCallback, useState, type ReactNode } from "react";
import { normalizeDecimal, parseMoney, minorToDecimalString } from "@convex/lib/money";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { UNIT, type Fuel } from "@/lib/format";
import type { Fill, Vehicle } from "@/lib/fuel";
import { cn } from "@/lib/utils";
import { StationPicker } from "./StationPicker";

type Sum = "amount" | "quantity" | "price";
export type FormState = {
  vehicleId: string;
  date: string;
  time: string;
  odometer: string;
  amount: string;
  quantity: string;
  price: string;
  /** Which of the three was worked out from the other two, and so follows them. */
  derived: Sum | null;
  fullTank: boolean;
  missedBefore: boolean;
  note: string;
  stationId: string | null;
};

const num = (text: string) => { const n = Number(normalizeDecimal(text).replace(/[,\s]/g, "")); return text.trim() && Number.isFinite(n) && n > 0 ? n : null; };
const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));

export function blankForm(vehicleId: string, date: string, time: string, fullTank: boolean): FormState {
  return { vehicleId, date, time, odometer: "", amount: "", quantity: "", price: "", derived: "price", fullTank, missedBefore: false, note: "", stationId: null };
}

export function formOf(f: Fill): FormState {
  const amount = f.amountMinor ? minorToDecimalString(f.amountMinor, f.currency) : "";
  const quantity = f.quantityMilli ? trim(f.quantityMilli / 1000, 3) : "";
  return {
    vehicleId: f.vehicleId, date: f.date, time: f.time ?? "", odometer: f.odometerM === undefined ? "" : trim(f.odometerM / 1000, 1),
    amount, quantity, price: amount && quantity ? trim(Number(amount) / Number(quantity), 2) : "", derived: "price",
    fullTank: f.fullTank, missedBefore: f.missedBefore, note: f.note ?? "", stationId: f.stationId ?? null,
  };
}

/** One of the three numbers typed: the one that was worked out (or, failing that, the emptiest) follows the other two. */
function withSum(s: FormState, field: Sum, text: string): FormState {
  const next = { ...s, [field]: text };
  const others = (["amount", "quantity", "price"] as const).filter((k) => k !== field);
  const target = s.derived && s.derived !== field ? s.derived : others.find((k) => !next[k].trim()) ?? null;
  if (!target) return { ...next, derived: s.derived === field ? null : s.derived };
  const a = num(next.amount), q = num(next.quantity), p = num(next.price);
  const value = target === "price" ? (a && q ? trim(a / q, 2) : "") : target === "quantity" ? (a && p ? trim(a / p, 3) : "") : q && p ? trim(q * p, 2) : "";
  return { ...next, [target]: value, derived: target };
}

export type FillValues = { vehicleId: string; date: string; time?: string; odometerM?: number; amountMinor: number; quantityMilli: number; fullTank: boolean; missedBefore: boolean; note?: string; stationId: string | null };

/** The form as the server takes it, or a sentence saying what is missing. */
export function readForm(s: FormState, currency: string): { values: FillValues } | { error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) return { error: "Pick the date" };
  const amountMinor = parseMoney(s.amount, currency);
  if (!amountMinor || amountMinor <= 0) return { error: "Type the amount paid" };
  const q = num(s.quantity);
  if (!q) return { error: "Type how much fuel went in" };
  const odo = s.odometer.trim() ? num(s.odometer) : undefined;
  if (odo === null) return { error: "That odometer reading does not look right" };
  return {
    values: {
      vehicleId: s.vehicleId, date: s.date, time: /^\d{2}:\d{2}$/.test(s.time) ? s.time : undefined,
      odometerM: odo === undefined ? undefined : Math.round(odo * 1000),
      amountMinor, quantityMilli: Math.round(q * 1000),
      fullTank: s.fullTank, missedBefore: s.missedBefore, note: s.note.trim() || undefined, stationId: s.stationId,
    },
  };
}

export function useFillForm(initial: FormState) {
  const [form, setForm] = useState(initial);
  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => setForm((s) => ({ ...s, [key]: value })), []);
  const setSum = useCallback((field: Sum, text: string) => setForm((s) => withSum(s, field, text)), []);
  return { form, set, setSum, setForm };
}

function Field({ label, hint, from, children, className }: { label: string; hint?: string; from?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="truncate">{label}</Label>
        {from ? <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">from photo, check it</span> : hint ? <span className="shrink-0 text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Toggle({ id, label, sub, checked, onChange }: { id: string; label: string; sub: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function FillFields({ api, currencySymbol, fuel, vehicles, filled = [], at, prevPrice }: {
  api: ReturnType<typeof useFillForm>;
  currencySymbol: string;
  fuel: Fuel;
  vehicles: Vehicle[];
  /** The fields a photo read filled in: marked so the rider checks them. */
  filled?: string[];
  /** Where the fill-up was made, for the station list. */
  at?: { lat: number; lng: number } | null;
  /** The last price per litre, shown as a hint to type against. */
  prevPrice?: string;
}) {
  const { form, set, setSum } = api;
  const unit = UNIT[fuel];
  const decimal = { inputMode: "decimal" as const, autoComplete: "off", className: "tabular" };
  const choices = vehicles.filter((v) => !v.deletedAt || v._id === form.vehicleId);
  return (
    <div className="space-y-4">
      {choices.length > 1 ? (
        <Field label="Vehicle">
          <Select value={form.vehicleId} onValueChange={(v) => set("vehicleId", v)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{choices.map((v) => <SelectItem key={v._id} value={v._id}>{v.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" from={filled.includes("date")}><Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Time" hint="optional"><Input type="time" value={form.time} onChange={(e) => set("time", e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Amount (${currencySymbol})`} from={filled.includes("amountMinor")}>
          <Input {...decimal} value={form.amount} onChange={(e) => setSum("amount", e.target.value)} placeholder="1000" aria-label="Amount paid" />
        </Field>
        <Field label={`Fuel (${unit})`} from={filled.includes("quantityMilli")}>
          <Input {...decimal} value={form.quantity} onChange={(e) => setSum("quantity", e.target.value)} placeholder="9.43" aria-label={`Fuel in ${unit}`} />
        </Field>
      </div>
      <Field label={`Price per ${unit} (${currencySymbol})`} hint={prevPrice ? `last time ${prevPrice}` : "worked out for you"}>
        <Input {...decimal} value={form.price} onChange={(e) => setSum("price", e.target.value)} placeholder="106.05" aria-label={`Price per ${unit}`} />
      </Field>
      <Field label="Odometer (km)" hint="needed for mileage" from={filled.includes("odometerM")}>
        <Input {...decimal} value={form.odometer} onChange={(e) => set("odometer", e.target.value)} placeholder="12410" aria-label="Odometer in km" />
      </Field>
      <Field label="Station" from={filled.includes("stationName")}>
        <StationPicker value={form.stationId} onChange={(id) => set("stationId", id)} at={at ?? null} />
      </Field>
      <div className="space-y-3 rounded-lg border p-3">
        <Toggle id="full" label="Full tank" sub="Filled until the pump cut off. Makes the mileage exact." checked={form.fullTank} onChange={(v) => set("fullTank", v)} />
        <Toggle id="missed" label="I missed logging one before this" sub="Leaves this stretch out so the average stays right." checked={form.missedBefore} onChange={(v) => set("missedBefore", v)} />
      </div>
      <Field label="Note" hint="optional">
        <Textarea value={form.note} onChange={(e) => set("note", e.target.value)} rows={2} maxLength={500} placeholder="Serviced, highway trip…" />
      </Field>
    </div>
  );
}
