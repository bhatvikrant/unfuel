/**
 * Charts and facts for the current vehicle, all worked out on the device from its fill-ups
 * (src/lib/fuel.tsx), so they show offline too. Estimates are drawn lighter than exact figures.
 */
import { useState } from "react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, Scatter, XAxis, YAxis } from "recharts";
import { CO2_KG_PER_UNIT, costPerKm, kmPerUnit, total, type Stretch } from "@convex/lib/mileage";
import { currencyDecimals } from "@convex/lib/money";
import { Card, Empty, Page, PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { day, km, mileage, mileageUnit, mileageValue, money, moneyShort, monthShort, percent, perKm, quantity, todayISO, UNIT } from "@/lib/format";
import { useFuel } from "@/lib/fuel";

const PERIODS = [{ key: "3m", label: "3 months", months: 3 }, { key: "12m", label: "12 months", months: 12 }, { key: "all", label: "All", months: 0 }] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

/** The first day of the period that ends today, or "" for everything. */
function since(months: number): string {
  if (!months) return "";
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return todayISO(d);
}

const config: ChartConfig = { value: { label: "Value", color: "var(--chart-1)" } };
const axis = { tickLine: false, axisLine: false } as const;
const tick = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n * 10) / 10));

function Chart({ title, hint, value, children }: { title: string; hint?: string; value?: string; children: React.ReactElement }) {
  return (
    <Card>
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h2 className="truncate text-sm font-medium">{title}</h2>
        {value ? <span className="shrink-0 text-sm font-semibold tabular">{value}</span> : null}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {/* the chart takes its width from the card and never pushes it wider */}
      <ChartContainer config={config} className="mt-3 h-48 w-full min-w-0 touch-pan-y">{children}</ChartContainer>
    </Card>
  );
}

function Tip({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-pop"><div className="text-muted-foreground">{label}</div><div className="font-medium tabular">{value}</div></div>;
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 py-2">
      <span className="min-w-0 truncate text-sm text-muted-foreground">{label}</span>
      <span className="shrink-0 text-right text-sm font-medium tabular">{value}{sub ? <span className="ml-1.5 font-normal text-muted-foreground">{sub}</span> : null}</span>
    </div>
  );
}

export default function StatsPage() {
  const f = useFuel();
  const [period, setPeriod] = useState<PeriodKey>("12m");
  const from = since(PERIODS.find((p) => p.key === period)!.months);
  const list = f.stretches.filter((s) => s.date >= from);
  const fills = f.done.filter((x) => x.date >= from);
  const months = f.months.filter((m) => m.month >= from.slice(0, 7));
  const one = 10 ** currencyDecimals(f.currency);
  const unit = mileageUnit(f.unit, f.fuel);

  if (!f.loading && !f.done.length) {
    return <><PageHeader title="Stats" /><Empty title="Nothing to chart yet" action={<Button asChild><Link to="/add">Add fill-up</Link></Button>}>Charts appear from your second fill-up.</Empty></>;
  }

  // each stretch with the average of it and the four before, as the headline is worked out
  const points = list.map((s) => {
    const i = f.stretches.indexOf(s);
    const window = f.stretches.slice(Math.max(0, i - 4), i + 1);
    return { label: day(s.date), exact: s.exact ? mileageValue(s, f.unit) : null, estimate: s.exact ? null : mileageValue(s, f.unit), average: mileageValue(total(window)!, f.unit), cost: costPerKm(s) / one, s };
  });
  const prices = [...fills].sort((a, b) => a.date.localeCompare(b.date)).filter((x) => x.quantityMilli > 0).map((x) => ({ label: day(x.date), value: x.amountMinor / (x.quantityMilli / 1000) / one }));
  const monthly = months.map((m) => ({ label: monthShort(m.month), spend: m.spendMinor / one, distance: m.distanceM / 1000 }));
  const overall = total(list);
  const spend = fills.reduce((n, x) => n + x.amountMinor, 0);
  const litres = fills.reduce((n, x) => n + x.quantityMilli, 0);
  const best = [...list].sort((a, b) => kmPerUnit(b) - kmPerUnit(a))[0] as Stretch | undefined;
  const worst = [...list].sort((a, b) => kmPerUnit(a) - kmPerUnit(b))[0] as Stretch | undefined;
  const thisMonth = f.months.find((m) => m.month === todayISO().slice(0, 7));
  const lastMonth = f.months.find((m) => m.month === since(1).slice(0, 7));
  const change = thisMonth && lastMonth?.spendMinor ? thisMonth.spendMinor / lastMonth.spendMinor - 1 : null;

  return (
    <>
      <PageHeader title="Stats" />
      <Page className="space-y-4">
        <ToggleGroup type="single" value={period} onValueChange={(v) => v && setPeriod(v as PeriodKey)} variant="outline" className="w-full" aria-label="Period">
          {PERIODS.map((p) => <ToggleGroupItem key={p.key} value={p.key} className="flex-1">{p.label}</ToggleGroupItem>)}
        </ToggleGroup>

        {points.length ? (
          <>
            <Chart title={`Mileage (${unit})`} hint="Each stretch, with the average of the last five as a line. Estimates are the hollow dots." value={overall ? `${overall.exact ? "" : "≈ "}${mileage(overall, f.unit, f.fuel)}` : undefined}>
              <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" {...axis} tickMargin={8} minTickGap={24} />
                <YAxis {...axis} width={36} tickFormatter={tick} domain={["auto", "auto"]} />
                <ChartTooltip cursor={false} content={({ active, payload }) => (active && payload?.[0] ? <Tip label={payload[0].payload.label} value={`${payload[0].payload.s.exact ? "" : "≈ "}${mileage(payload[0].payload.s, f.unit, f.fuel)}`} /> : null)} />
                <Line dataKey="average" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Scatter dataKey="exact" fill="var(--chart-1)" isAnimationActive={false} />
                <Scatter dataKey="estimate" fill="var(--background)" stroke="var(--chart-1)" strokeWidth={1.5} isAnimationActive={false} />
              </ComposedChart>
            </Chart>
            <Chart title="Cost per km" value={overall ? perKm(overall, f.currency) : undefined}>
              <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" {...axis} tickMargin={8} minTickGap={24} />
                <YAxis {...axis} width={36} tickFormatter={tick} domain={["auto", "auto"]} />
                <ChartTooltip cursor={false} content={({ active, payload }) => (active && payload?.[0] ? <Tip label={payload[0].payload.label} value={perKm(payload[0].payload.s, f.currency)} /> : null)} />
                <Line dataKey="cost" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
              </LineChart>
            </Chart>
          </>
        ) : (
          <Card className="text-sm text-muted-foreground">Mileage and cost per km appear once two fill-ups in this period have an odometer reading.</Card>
        )}

        {prices.length > 1 ? (
          <Chart title={`Price per ${UNIT[f.fuel]}`} value={money(prices[prices.length - 1].value * one, f.currency)}>
            <LineChart data={prices} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis} tickMargin={8} minTickGap={24} />
              <YAxis {...axis} width={36} tickFormatter={tick} domain={["auto", "auto"]} />
              <ChartTooltip cursor={false} content={({ active, payload }) => (active && payload?.[0] ? <Tip label={payload[0].payload.label} value={money(payload[0].payload.value * one, f.currency)} /> : null)} />
              <Line dataKey="value" stroke="var(--chart-3)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </Chart>
        ) : null}

        {monthly.length ? (
          <>
            <Chart title="Spend per month" value={moneyShort(spend, f.currency)}>
              <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%" accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" {...axis} tickMargin={8} minTickGap={8} />
                <YAxis {...axis} width={36} tickFormatter={tick} />
                <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={({ active, payload }) => (active && payload?.[0] ? <Tip label={payload[0].payload.label} value={moneyShort(payload[0].payload.spend * one, f.currency)} /> : null)} />
                <Bar dataKey="spend" fill="var(--chart-4)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </Chart>
            {monthly.some((m) => m.distance) ? (
              <Chart title="Distance per month" value={overall ? km(overall.distanceM) : undefined}>
                <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%" accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" {...axis} tickMargin={8} minTickGap={8} />
                  <YAxis {...axis} width={36} tickFormatter={tick} />
                  <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={({ active, payload }) => (active && payload?.[0] ? <Tip label={payload[0].payload.label} value={km(payload[0].payload.distance * 1000)} /> : null)} />
                  <Bar dataKey="distance" fill="var(--chart-5)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                </BarChart>
              </Chart>
            ) : null}
          </>
        ) : null}

        <Card className="divide-y py-2">
          <Fact label="Spent" value={moneyShort(spend, f.currency)} sub={`${fills.length} ${fills.length === 1 ? "fill-up" : "fill-ups"}`} />
          <Fact label="Fuel" value={quantity(litres, f.fuel)} />
          {overall ? <Fact label="Distance" value={km(overall.distanceM)} /> : null}
          {best && list.length > 1 ? <Fact label="Best tank" value={mileage(best, f.unit, f.fuel)} sub={day(best.date)} /> : null}
          {worst && list.length > 1 ? <Fact label="Worst tank" value={mileage(worst, f.unit, f.fuel)} sub={day(worst.date)} /> : null}
          {f.facts.avgDistanceM ? <Fact label="Between fill-ups" value={km(f.facts.avgDistanceM)} sub={f.facts.avgDays ? `every ${Math.round(f.facts.avgDays)} days` : undefined} /> : null}
          {f.facts.avgFillMinor ? <Fact label="Usual fill-up" value={moneyShort(f.facts.avgFillMinor, f.currency)} /> : null}
          {change !== null ? <Fact label="This month against last" value={`${percent(change)} ${change >= 0 ? "more" : "less"}`} /> : null}
          {f.vehicle?.tankMilli && f.headline ? <Fact label="Range on a full tank" value={`about ${km(kmPerUnit(f.headline) * f.vehicle.tankMilli)}`} /> : null}
          <Fact label="CO₂ from this fuel" value={`about ${Math.round((litres / 1000) * CO2_KG_PER_UNIT[f.fuel])} kg`} />
        </Card>
      </Page>
    </>
  );
}
