/**
 * The station field: a search box with a drop-down. The rider's own stations first (they work
 * offline), then fuel stations near the fill-up and, as they type, fuel stations by name, both
 * from Google Maps (convex/places.ts). A station Google does not have can be added by its name.
 */
import { MapPin, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { haversineM, stationAddress, stationName, type Candidate } from "@convex/lib/stations";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useAction, useMutation, useOfflineStatus } from "@/lib/convex";
import { errorText } from "@/lib/format";
import { useFuel } from "@/lib/fuel";

const token = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
const metres = (m?: number) => (m === undefined ? "" : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

export function StationPicker({ value, onChange, at }: { value: string | null; onChange: (id: string | null) => void; at: { lat: number; lng: number } | null }) {
  const { stations, stationById, me } = useFuel();
  const { connected } = useOfflineStatus();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [nearby, setNearby] = useState<Candidate[] | null>(null);
  const [found, setFound] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const session = useRef(token());
  const searchNearby = useAction(api.places.nearby);
  const search = useAction(api.places.search);
  const choose = useAction(api.places.choose);
  const addCustom = useMutation(api.stations.chooseCustom);
  const google = connected && !!me?.places;
  const current = value ? stationById.get(value) : undefined;

  // the rider's own stations, nearest first when the fill-up has a place
  const mine = useMemo(() => {
    const d = (s: (typeof stations)[number]) => (at && s.lat !== undefined && s.lng !== undefined ? haversineM(at, { lat: s.lat, lng: s.lng }) : undefined);
    return stations.map((s) => ({ s, m: d(s) })).sort((a, b) => (a.m ?? Infinity) - (b.m ?? Infinity) || stationName(a.s).localeCompare(stationName(b.s)));
  }, [stations, at]);

  // fuel stations around the fill-up, once, when the list opens
  const lat = at?.lat, lng = at?.lng;
  useEffect(() => {
    if (!open || !google || lat === undefined || lng === undefined || nearby !== null) return;
    let alive = true;
    searchNearby({ lat, lng }).then((r) => { if (alive) setNearby(r); }).catch(() => { if (alive) setNearby([]); });
    return () => { alive = false; };
  }, [open, google, lat, lng, nearby, searchNearby]);

  // fuel stations by name, a moment after the rider stops typing
  useEffect(() => {
    const q = text.trim();
    if (!open || !google || q.length < 3) { setFound([]); return; }
    let alive = true;
    const timer = setTimeout(() => {
      search({ text: q, lat, lng, sessionToken: session.current }).then((r) => { if (alive) setFound(r); }).catch(() => { if (alive) setFound([]); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [open, google, text, lat, lng, search]);

  const done = (id: string | null) => { onChange(id); setOpen(false); setText(""); };
  async function pickPlace(c: Candidate) {
    setBusy(true);
    try {
      const id = await choose({ placeId: c.placeId, sessionToken: session.current });
      // a selection ends Google's search session: the next search starts a new one
      session.current = token();
      if (id) done(id);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function pickCustom() {
    try {
      done(await addCustom({ name: text.trim() }));
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  const taken = new Set(stations.map((s) => s.placeId).filter(Boolean));
  const fresh = (list: Candidate[]) => list.filter((c) => !taken.has(c.placeId));
  const row = (c: Candidate) => (
    <CommandItem key={c.placeId} value={`g ${c.name} ${c.placeId}`} onSelect={() => void pickPlace(c)} disabled={busy}>
      <MapPin className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{c.name}</span>
        {c.address ? <span className="block truncate text-xs text-muted-foreground">{c.address}</span> : null}
      </span>
      <span className="shrink-0 text-xs tabular text-muted-foreground">{metres(c.distanceM)}</span>
    </CommandItem>
  );

  return (
    <>
      <div className="flex min-w-0 items-center gap-1">
        <Button type="button" variant="outline" className="h-9 min-w-0 flex-1 justify-start px-3 font-normal" onClick={() => setOpen(true)}>
          <MapPin className="size-4 shrink-0 text-muted-foreground" />
          <span className={current ? "truncate" : "truncate text-muted-foreground"}>{current ? stationName(current) : "Choose the fuel station"}</span>
        </Button>
        {current ? <Button type="button" variant="ghost" size="icon-lg" aria-label="Clear the station" onClick={() => onChange(null)}><X /></Button> : null}
      </div>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="md:mx-auto md:max-w-xl md:rounded-t-xl">
          <DrawerHeader className="py-2">
            <DrawerTitle className="text-sm">Fuel station</DrawerTitle>
            <DrawerDescription className="sr-only">Pick one of your stations, one nearby, or search by name.</DrawerDescription>
          </DrawerHeader>
          {/* cmdk filters by what is typed; the Google rows are already the answer to it, so they always show */}
          <Command shouldFilter={false} className="rounded-none bg-transparent">
            <CommandInput value={text} onValueChange={setText} placeholder="Search by name" />
            <CommandList className="safe-bottom max-h-[60vh]">
              <CommandEmpty>{google ? "No station by that name" : "Nothing to show"}</CommandEmpty>
              {mine.filter(({ s }) => !text.trim() || stationName(s).toLowerCase().includes(text.trim().toLowerCase())).length ? (
                <CommandGroup heading="Your stations">
                  {mine.filter(({ s }) => !text.trim() || stationName(s).toLowerCase().includes(text.trim().toLowerCase())).map(({ s, m }) => (
                    <CommandItem key={s._id} value={`s ${s._id}`} onSelect={() => done(s._id)}>
                      <MapPin className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{stationName(s)}</span>
                        {stationAddress(s) ? <span className="block truncate text-xs text-muted-foreground">{stationAddress(s)}</span> : null}
                      </span>
                      <span className="shrink-0 text-xs tabular text-muted-foreground">{metres(m)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {!text.trim() && nearby && fresh(nearby).length ? <CommandGroup heading="Nearby">{fresh(nearby).map(row)}</CommandGroup> : null}
              {fresh(found).length ? <CommandGroup heading="Search results">{fresh(found).map(row)}</CommandGroup> : null}
              {text.trim().length >= 2 ? (
                <CommandGroup heading="Not listed?">
                  <CommandItem value="custom" onSelect={() => void pickCustom()}><Plus className="size-4 shrink-0" /><span className="truncate">Use “{text.trim()}”</span></CommandItem>
                </CommandGroup>
              ) : null}
              <p className="px-3 py-3 text-xs text-muted-foreground">
                {google ? "Nearby and search results are from Google Maps" : connected ? "Station search is not set up on this server. You can still add a station by name." : "Searching for stations needs a connection. Your own stations are listed."}
              </p>
            </CommandList>
          </Command>
        </DrawerContent>
      </Drawer>
    </>
  );
}
