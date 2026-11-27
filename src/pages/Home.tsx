import { Camera, ChevronRight, CloudOff, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Link } from "react-router";
import { FillRow } from "@/components/fill/FillRow";
import { Card, Empty, Page } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOffline } from "@/lib/convex";
import { day, mileage, moneyShort, percent, perKm, pricePerUnit, todayISO } from "@/lib/format";
import { useFuel } from "@/lib/fuel";
import { useConfirm } from "@/components/ConfirmDialog";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-card p-3 shadow-card sm:p-4">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold tabular tracking-tight sm:text-2xl">{value}</div>
      {sub ? <div className="truncate text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** New fill-ups the server refused (made offline): kept with their photos until fixed or thrown away. */
function Failed() {
  const { store } = useOffline();
  const confirm = useConfirm();
  const failed = useSyncExternalStore(store.subscribe, () => store.failed);
  if (!failed.length) return null;
  return (
    <Card className="border border-destructive/30">
      <div className="flex items-center gap-2 text-sm font-medium"><TriangleAlert className="size-4 shrink-0 text-destructive" />Could not sync</div>
      <ul className="mt-2 space-y-2">
        {failed.map((f) => (
          <li key={f.op.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate">Fill-up of {typeof f.op.args.date === "string" ? day(f.op.args.date) : "an earlier day"}</span>
              <span className="block text-xs text-muted-foreground">{f.reason}</span>
            </span>
            <span className="flex shrink-0 gap-1">
              <Button size="sm" variant="outline" asChild><Link to={`/add?fix=${f.op.id}`}>Fix it</Link></Button>
              <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: "Throw this fill-up away?", description: "Its photos are deleted from this device too.", action: "Throw away" })) void store.unpark(f.op.id, true); }}>Discard</Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function HomePage() {
  const f = useFuel();
  if (f.loading) return <Page className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></Page>;

  const month = todayISO().slice(0, 7);
  const thisMonth = f.months.find((m) => m.month === month);
  const latest = f.fills.filter((x) => x.status === "done")[0];
  const priceMove = f.facts.price && f.facts.prevPrice ? f.facts.price / f.facts.prevPrice - 1 : 0;
  const add = <Button size="lg" className="h-12 w-full gap-2 text-base sm:w-auto sm:px-6" asChild><Link to="/add"><Camera className="size-5" /> Add fill-up</Link></Button>;

  return (
    <Page className="space-y-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{f.vehicle?.name ?? "Unfuel"}</h1>
          <p className="truncate text-sm text-muted-foreground">{latest ? `Last filled ${day(latest.date)}` : "No fill-ups yet"}</p>
        </div>
        {f.vehicles.filter((v) => !v.deletedAt).length > 1 ? <Button variant="outline" size="sm" asChild><Link to="/vehicles">Switch</Link></Button> : null}
      </div>

      <Failed />

      {f.pending.length ? (
        <Card className="p-0">
          <div className="flex items-center gap-2 px-4 pt-3 text-sm font-medium"><CloudOff className="size-4 shrink-0 text-muted-foreground" />Not in your figures yet</div>
          <div className="divide-y">{f.pending.map((x) => <FillRow key={x._id} fill={x} />)}</div>
        </Card>
      ) : null}

      {!f.done.length ? (
        <Card>
          <Empty title="Add your first fill-up" action={add}>
            Take a photo of the fuel bill and one of the odometer. That is all it takes to start.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Tile label={f.headline && !f.headline.exact ? "Mileage (estimate)" : "Mileage"} value={f.headline ? `${f.headline.exact ? "" : "≈ "}${mileage(f.headline, f.unit, f.fuel)}` : "–"} sub={f.headline ? `last ${Math.min(5, f.stretches.length)} ${f.stretches.length === 1 ? "stretch" : "stretches"}` : "after one more fill-up"} />
            <Tile label="Cost per km" value={f.headline ? perKm(f.headline, f.currency) : "–"} sub={latest?.amountMinor && latest.quantityMilli ? `at ${pricePerUnit(latest.amountMinor, latest.quantityMilli, latest.currency, f.fuel)}` : undefined} />
            <div className="col-span-2 sm:col-span-1"><Tile label="This month" value={moneyShort(thisMonth?.spendMinor ?? 0, f.currency)} sub={`${thisMonth?.fills ?? 0} ${thisMonth?.fills === 1 ? "fill-up" : "fill-ups"}`} /></div>
          </div>
          {!f.stretches.length ? <p className="text-sm text-muted-foreground">One more fill-up with an odometer reading and you will see your mileage.</p> : null}
          <div className="md:hidden">{add}</div>

          {f.dip ? (
            <Card className="flex gap-3">
              {f.dip.state === "dip" ? <TrendingDown className="mt-0.5 size-5 shrink-0 text-expense" /> : <TrendingUp className="mt-0.5 size-5 shrink-0 text-income" />}
              <div className="min-w-0 text-sm">
                <div className="font-medium">{f.dip.state === "dip" ? `Mileage is down ${percent(f.dip.drop)} since ${day(f.dip.since)}` : "Mileage is back to normal"}</div>
                <p className="mt-0.5 text-muted-foreground">
                  {f.dip.state === "dip" ? "The usual causes are low tyre pressure, a clogged air filter, a service that is due, or a change of route." : `It dipped and has recovered since ${day(f.dip.since)}.`}
                </p>
              </div>
            </Card>
          ) : null}
          {Math.abs(priceMove) >= 0.005 && f.facts.price ? (
            <Card className="text-sm">
              <span className="font-medium">Fuel is {percent(priceMove)} {priceMove > 0 ? "dearer" : "cheaper"}</span>
              <span className="text-muted-foreground"> than at your fill-up before this one.</span>
            </Card>
          ) : null}

          <Card className="p-0">
            <div className="flex items-center justify-between px-4 pt-3">
              <h2 className="text-sm font-medium">Latest fill-ups</h2>
              <Link to="/history" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground">All <ChevronRight className="size-3.5" /></Link>
            </div>
            <div className="divide-y">{f.fills.filter((x) => x.status === "done").slice(0, 5).map((x) => <FillRow key={x._id} fill={x} />)}</div>
          </Card>
        </>
      )}
    </Page>
  );
}
