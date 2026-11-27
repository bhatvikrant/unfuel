/** The rider's vehicles: which one is current, and each one's name, kind, fuel and tank size. */
import { Check, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Card, Page, PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation } from "@/lib/convex";
import { errorText, UNIT } from "@/lib/format";
import { useFuel, type Vehicle } from "@/lib/fuel";

const KINDS = { bike: "Bike", scooter: "Scooter", car: "Car", other: "Other" } as const;
const FUELS = { petrol: "Petrol", diesel: "Diesel", cng: "CNG" } as const;
type Draft = { id?: string; name: string; kind: keyof typeof KINDS; fuelType: keyof typeof FUELS; tank: string };

export default function VehiclesPage() {
  const f = useFuel();
  const create = useMutation(api.vehicles.create);
  const update = useMutation(api.vehicles.update);
  const setArchived = useMutation(api.vehicles.setArchived);
  const setCurrent = useMutation(api.settings.update);
  const [draft, setDraft] = useState<Draft | null>(null);
  const live = f.vehicles.filter((v) => !v.deletedAt);
  const archived = f.vehicles.filter((v) => v.deletedAt);
  const count = (id: string) => f.allFills.filter((x) => x.vehicleId === id).length;
  const run = (work: () => Promise<unknown>) => void work().catch((e) => toast.error(errorText(e)));

  async function save() {
    if (!draft) return;
    const tank = draft.tank.trim() ? Math.round(Number(draft.tank) * 1000) : undefined;
    if (!draft.name.trim()) { toast.error("Give the vehicle a name"); return; }
    if (tank !== undefined && !(tank > 0)) { toast.error("That tank size does not look right"); return; }
    try {
      if (draft.id) await update({ id: draft.id as Id<"vehicles">, name: draft.name, kind: draft.kind, fuelType: draft.fuelType, tankMilli: tank ?? null });
      else await create({ name: draft.name, kind: draft.kind, fuelType: draft.fuelType, tankMilli: tank });
      setDraft(null);
    } catch (e) {
      toast.error(errorText(e));
    }
  }
  const edit = (v: Vehicle) => setDraft({ id: v._id, name: v.name, kind: v.kind, fuelType: v.fuelType, tank: v.tankMilli ? String(v.tankMilli / 1000) : "" });

  return (
    <>
      <PageHeader title="Vehicles" back="/more" right={<Button variant="ghost" size="icon" aria-label="Add vehicle" onClick={() => setDraft({ name: "", kind: "bike", fuelType: "petrol", tank: "" })}><Plus className="size-5" /></Button>} />
      <Page className="space-y-4">
        <Card className="p-0">
          <div className="divide-y">
            {live.map((v) => {
              const current = v._id === f.vehicle?._id;
              return (
                <div key={v._id} className="flex min-w-0 items-center gap-2 px-4 py-3">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => run(() => setCurrent({ currentVehicleId: v._id }))} aria-pressed={current}>
                    <span className={current ? "flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" : "size-5 shrink-0 rounded-full border"}>{current ? <Check className="size-3.5" /> : null}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{v.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{KINDS[v.kind]} · {FUELS[v.fuelType]}{v.tankMilli ? ` · ${v.tankMilli / 1000} ${UNIT[v.fuelType]} tank` : ""} · {count(v._id)} fill-ups</span>
                    </span>
                  </button>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${v.name}`} onClick={() => edit(v)}><Pencil className="size-4" /></Button>
                </div>
              );
            })}
          </div>
        </Card>
        <p className="text-xs text-muted-foreground">Tap a vehicle to make it the current one. Home, History and Stats show the current vehicle, and a new fill-up goes to it.</p>
        {archived.length ? (
          <Card className="p-0">
            <h2 className="px-4 pt-3 text-sm font-medium">Archived</h2>
            <div className="divide-y">
              {archived.map((v) => (
                <div key={v._id} className="flex min-w-0 items-center justify-between gap-2 px-4 py-3">
                  <span className="min-w-0 truncate text-sm text-muted-foreground">{v.name} · {count(v._id)} fill-ups</span>
                  <Button variant="outline" size="sm" onClick={() => run(() => setArchived({ id: v._id, archived: false }))}>Bring back</Button>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </Page>
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit vehicle" : "Add vehicle"}</DialogTitle>
            <DialogDescription>Only the name is needed. Tank size lets Unfuel estimate your range.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="v-name">Name</Label><Input id="v-name" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Activa" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0 space-y-1.5">
                  <Label>Kind</Label>
                  <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as Draft["kind"] })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(KINDS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label>Fuel</Label>
                  <Select value={draft.fuelType} onValueChange={(v) => setDraft({ ...draft, fuelType: v as Draft["fuelType"] })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(FUELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="v-tank">Tank size ({UNIT[draft.fuelType]}), optional</Label><Input id="v-tank" inputMode="decimal" value={draft.tank} onChange={(e) => setDraft({ ...draft, tank: e.target.value })} placeholder="5.3" /></div>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            {draft?.id && live.length > 1 ? <Button variant="ghost" onClick={() => { const id = draft.id as Id<"vehicles">; setDraft(null); run(() => setArchived({ id, archived: true })); }}>Archive</Button> : null}
            <Button onClick={() => void save()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
