import { CloudOff, Loader2, TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { stationName } from "@convex/lib/stations";
import { isTempId } from "@/lib/convex";
import { day, mileage, moneyShort, quantity } from "@/lib/format";
import { useFuel, type Fill } from "@/lib/fuel";

/** What a fill-up that is not complete is waiting for, in a few words; nothing for a complete one. */
export function fillState(f: Fill): { text: string; icon: typeof Loader2; spin?: boolean } | null {
  if (f.status === "done") return null;
  if (f.status === "review") return { text: "Needs a look", icon: TriangleAlert };
  return isTempId(f._id) ? { text: "Waiting for connection", icon: CloudOff } : { text: "Reading…", icon: Loader2, spin: true };
}

/** One fill-up in a list: when, where, how much, and the mileage of the stretch that ended at it. */
export function FillRow({ fill }: { fill: Fill }) {
  const { stationById, stretchOf, unit, fuel } = useFuel();
  const station = fill.stationId ? stationById.get(fill.stationId) : undefined;
  const stretch = stretchOf.get(fill._id);
  const state = fillState(fill);
  return (
    <Link to={`/fill/${fill._id}`} className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-muted/60 active:bg-muted">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <span className="shrink-0">{day(fill.date)}</span>
          {isTempId(fill._id) && fill.status === "done" ? <CloudOff className="size-3.5 shrink-0 text-muted-foreground" aria-label="Not synced yet" /> : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {state ? <span className="inline-flex items-center gap-1"><state.icon className={state.spin ? "size-3 animate-spin" : "size-3"} />{state.text}</span> : station ? stationName(station) : "No station"}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-medium tabular">{fill.amountMinor ? moneyShort(fill.amountMinor, fill.currency) : "–"}</div>
        <div className="text-xs tabular text-muted-foreground">
          {fill.quantityMilli ? quantity(fill.quantityMilli, fuel) : ""}
          {stretch ? ` · ${stretch.exact ? "" : "≈ "}${mileage({ ...stretch }, unit, fuel)}` : ""}
        </div>
      </div>
    </Link>
  );
}
