import { Link } from "react-router";
import { FillRow } from "@/components/fill/FillRow";
import { Card, Empty, Page, PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { km, monthName, moneyShort } from "@/lib/format";
import { useFuel } from "@/lib/fuel";

/** Every fill-up of the current vehicle, by month, newest first, with each month's totals. */
export default function HistoryPage() {
  const f = useFuel();
  const groups = new Map<string, typeof f.fills>();
  for (const x of f.fills) groups.set(x.date.slice(0, 7), [...(groups.get(x.date.slice(0, 7)) ?? []), x]);
  const totals = new Map(f.months.map((m) => [m.month, m]));
  return (
    <>
      <PageHeader title="History" />
      <Page className="space-y-4">
        {!f.loading && !f.fills.length ? (
          <Empty title="No fill-ups yet" action={<Button asChild><Link to="/add">Add fill-up</Link></Button>}>Each fill-up you add shows here, by month.</Empty>
        ) : null}
        {[...groups.entries()].map(([month, list]) => {
          const t = totals.get(month);
          return (
            <Card key={month} className="p-0">
              <div className="flex min-w-0 items-baseline justify-between gap-3 px-4 pt-3">
                <h2 className="truncate text-sm font-medium">{monthName(month)}</h2>
                <span className="shrink-0 text-xs tabular text-muted-foreground">{t ? `${moneyShort(t.spendMinor, f.currency)}${t.distanceM ? ` · ${km(t.distanceM)}` : ""}` : ""}</span>
              </div>
              <div className="divide-y">{list.map((x) => <FillRow key={x._id} fill={x} />)}</div>
            </Card>
          );
        })}
      </Page>
    </>
  );
}
