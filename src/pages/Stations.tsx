/** The rider's fuel stations: where they fill up, what it costs there, and how the tanks filled there ran. */
import { ExternalLink, MapPin, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { STATION_MIN_FILLS } from "@convex/lib/mileage";
import { GOOGLE_NAME_TTL_MS, stationAddress, stationName } from "@convex/lib/stations";
import { FillRow } from "@/components/fill/FillRow";
import { Card, Empty, Page, PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isTempId, useAction, useMutation, useOfflineStatus } from "@/lib/convex";
import { errorText, mileage, money, percent, UNIT } from "@/lib/format";
import { useFuel, type Station } from "@/lib/fuel";

/** Google's name is a copy that may only be kept a while: refetch it when a station whose copy is old is shown. */
function useFreshName(s: Station | undefined) {
  const refresh = useAction(api.places.refresh);
  const { connected } = useOfflineStatus();
  const stale = !!s?.placeId && !isTempId(s._id) && Date.now() - (s.googleFetchedAt ?? 0) > GOOGLE_NAME_TTL_MS;
  const id = s?._id;
  useEffect(() => {
    if (stale && connected && id) void refresh({ id }).catch(() => {});
  }, [stale, connected, id, refresh]);
}

function versus(x: number) {
  return `${percent(x)} ${x >= 0 ? "better" : "worse"} than your average`;
}

export function StationsPage() {
  const f = useFuel();
  const figures = new Map(f.stationFigures.map((x) => [x.stationId, x]));
  // most visited first: the ones worth comparing
  const list = [...f.stations].sort((a, b) => (figures.get(b._id)?.visits ?? 0) - (figures.get(a._id)?.visits ?? 0) || stationName(a).localeCompare(stationName(b)));
  return (
    <>
      <PageHeader title="Stations" back="/more" />
      <Page className="space-y-4">
        {!list.length ? <Empty title="No stations yet">A fill-up with a location, or a bill that names the station, adds it here.</Empty> : (
          <Card className="p-0">
            <div className="divide-y">
              {list.map((s) => {
                const fig = figures.get(s._id);
                return (
                  <Link key={s._id} to={`/stations/${s._id}`} className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-muted/60">
                    <MapPin className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{stationName(s)}</div>
                      <div className="truncate text-xs text-muted-foreground">{fig?.versus !== null && fig?.versus !== undefined ? versus(fig.versus) : stationAddress(s) ?? "No address"}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs tabular text-muted-foreground">
                      <div>{fig?.visits ?? 0} {fig?.visits === 1 ? "visit" : "visits"}</div>
                      {fig?.pricePerUnit ? <div>{money(fig.pricePerUnit, f.currency)}/{UNIT[f.fuel]}</div> : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>
        )}
        <p className="text-xs text-muted-foreground">Figures are for {f.vehicle?.name ?? "the current vehicle"}. Mileage by station is a hint, not proof: a tank mixes fuel from more than one station.</p>
      </Page>
    </>
  );
}

export function StationPage() {
  const { id = "" } = useParams();
  const f = useFuel();
  const station = f.stationById.get(id);
  useFreshName(station);
  const rename = useMutation(api.stations.rename);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  if (f.loading) return <PageHeader title="Station" back="/stations" />;
  if (!station) return <><PageHeader title="Station" back="/stations" /><Empty title="This station is not here" /></>;

  const fig = f.stationFigures.find((x) => x.stationId === id);
  const fills = f.fills.filter((x) => x.stationId === id);
  const address = stationAddress(station);
  const maps = station.placeId
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stationName(station))}&query_place_id=${station.placeId}`
    : station.lat !== undefined && station.lng !== undefined ? `https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lng}` : null;

  async function save() {
    try {
      await rename({ id: station!._id as Id<"stations">, name });
      setEditing(false);
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <>
      <PageHeader title="Station" back="/stations" right={<Button variant="ghost" size="icon" aria-label="Rename station" onClick={() => { setName(station.customName ?? ""); setEditing(true); }}><Pencil className="size-4" /></Button>} />
      <Page className="space-y-4">
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight break-words">{stationName(station)}</h2>
          {address ? <p className="text-sm text-muted-foreground break-words">{address}</p> : null}
          {station.googleName && !station.customName ? <p className="text-xs text-muted-foreground">Name and address from Google Maps{station.billName ? `. On your bill: ${station.billName}.` : "."}</p> : null}
          {maps ? <Button variant="outline" size="sm" asChild><a href={maps} target="_blank" rel="noreferrer"><ExternalLink />Open in Maps</a></Button> : null}
        </Card>
        <div className="grid grid-cols-2 gap-3">
          <Card><div className="text-xs text-muted-foreground">Visits</div><div className="mt-1 text-xl font-semibold tabular">{fig?.visits ?? fills.length}</div></Card>
          <Card><div className="text-xs text-muted-foreground">Average price</div><div className="mt-1 truncate text-xl font-semibold tabular">{fig?.pricePerUnit ? `${money(fig.pricePerUnit, f.currency)}/${UNIT[f.fuel]}` : "–"}</div></Card>
        </div>
        <Card className="text-sm">
          {fig?.rate && fig.versus !== null ? (
            <><span className="font-medium">{mileage(fig.rate, f.unit, f.fuel)} on tanks filled here, </span><span className="text-muted-foreground">{versus(fig.versus)}. A hint, not proof: a tank mixes fuel from more than one station.</span></>
          ) : <span className="text-muted-foreground">Mileage for this station shows from {STATION_MIN_FILLS} fill-ups here with odometer readings.</span>}
        </Card>
        {fills.length ? <Card className="p-0"><h2 className="px-4 pt-3 text-sm font-medium">Fill-ups here</h2><div className="divide-y">{fills.map((x) => <FillRow key={x._id} fill={x} />)}</div></Card> : null}
      </Page>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename station</DialogTitle>
            <DialogDescription>Your own name for it, on every fill-up here. Leave it empty to go back to the name from Google Maps or the bill.</DialogDescription>
          </DialogHeader>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={stationName({ ...station, customName: undefined })} aria-label="Station name" />
          <DialogFooter><Button onClick={() => void save()}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
