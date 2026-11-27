/**
 * The superadmin dashboard (/admin): who uses Unfuel, how much, on what, what AI reading costs and
 * how well it reads, and who has it. Only the superadmin reaches this page (App.tsx) or its data
 * (convex/admin.ts), and its code is a chunk of its own that nobody else downloads. Filters live in
 * the address, so a view can be bookmarked. Modelled on UnMoney's dashboard.
 */
import { formatDistanceToNowStrict } from "date-fns";
import { RefreshCw, Search, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LENGTH_BUCKETS } from "@convex/lib/admin";
import { AI_FEATURES, AI_FEATURE_KEYS, PRICES } from "@convex/lib/aiCost";
import { AI_MODEL, ISSUES, READ_MONTHLY_CAP } from "@convex/lib/fuelRead";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useConvex, useMutation, useQuery } from "@/lib/convex";
import { errorText } from "@/lib/format";
import { useFuel } from "@/lib/fuel";
import { cn } from "@/lib/utils";
import { BarList, Card, CohortGrid, Columns, DayChart, Group, Heatmap, SLOT, StackedDayBars, Tile } from "./charts";
import {
  ALL, addDays, aiByModel, aiByUser, aiSeries, aiTotals, applyFilters, change, cohorts, dayKey, daySeries, fmtBytes, fmtDuration, fmtNum, fmtPct, fmtUsd, hourOfWeek, inRange,
  monthProjection, photoBytes, placesTotals, readQuality, sumOf, sumRecords, tally, totals, userRows, type DayPoint, type Filters, type Overview, type UserRow,
} from "./metrics";
import { UserSheet } from "./UserSheet";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "ai", label: "AI" },
  { value: "engagement", label: "Usage" },
  { value: "devices", label: "Devices" },
  { value: "features", label: "Features" },
  { value: "data", label: "Data" },
  { value: "users", label: "Users" },
] as const;
type Tab = (typeof TABS)[number]["value"];

const RANGES = [{ days: 7, label: "7d" }, { days: 30, label: "30d" }, { days: 90, label: "90d" }, { days: 365, label: "1y" }];

const METRICS: { key: keyof DayPoint | "users"; label: string; format?: (n: number) => string }[] = [
  { key: "activeUsers", label: "Active users" },
  { key: "opens", label: "Opens" },
  { key: "activeMin", label: "Minutes in app", format: (n) => fmtNum(Math.round(n)) },
  { key: "entries", label: "Fill-ups added" },
  { key: "opsSent", label: "Changes synced" },
  { key: "signups", label: "Sign-ups" },
  { key: "users", label: "Total users" },
];

const FEATURES: Record<string, string> = {
  aiReading: "Photos read by AI", deviceReading: "Photos read on the device", typedOnly: "Types everything", photosKept: "Keeps photos",
  location: "Location allowed", stations: "Stations", googleStations: "Google Maps stations", fullTankRider: "Fills the tank (not by amount)",
  severalVehicles: "More than one vehicle", notes: "Notes", unmoney: "UnMoney connected", unmoneyAuto: "UnMoney, every fill-up",
};
const SOURCES = [{ key: "photo", label: "Read by AI" }, { key: "device", label: "Read on the device" }, { key: "manual", label: "Typed in" }];
const OUTCOMES = [
  { key: "untouched", label: "Saved, nothing typed" }, { key: "corrected", label: "Saved, then corrected" }, { key: "review", label: "Needed a look" },
  { key: "unreadable", label: "Unreadable" }, { key: "failed", label: "Failed or refused" },
] as const;
const FIELDS: Record<string, string> = { amountMinor: "Amount", quantityMilli: "Fuel quantity", odometerM: "Odometer", date: "Date", stationId: "Station" };
const PLACES: Record<string, string> = { nearby: "Nearby search", autocomplete: "Type-ahead", details: "Place details", text: "Text search" };
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nameOf = (u: { name: string | null; email: string | null }) => u.name || u.email || "Unnamed";
const AI_LIST = AI_FEATURE_KEYS.map((key) => ({ key, label: AI_FEATURES[key] }));

function useFilters(): [Filters, (patch: Partial<Filters>) => void] {
  const [params, setParams] = useSearchParams();
  const f: Filters = {
    days: Number(params.get("days")) || 30,
    userId: params.get("user") ?? ALL,
    os: params.get("os") ?? ALL,
    mode: (params.get("mode") as Filters["mode"]) ?? "all",
    includeMe: params.get("me") === "1",
  };
  const set = (patch: Partial<Filters>) => {
    const next = { ...f, ...patch };
    const p = new URLSearchParams();
    // the open section stays where it is
    if (params.get("tab")) p.set("tab", params.get("tab")!);
    if (next.days !== 30) p.set("days", String(next.days));
    if (next.userId !== ALL) p.set("user", next.userId);
    if (next.os !== ALL) p.set("os", next.os);
    if (next.mode !== "all") p.set("mode", next.mode);
    if (next.includeMe) p.set("me", "1");
    setParams(p, { replace: true });
  };
  return [f, set];
}

export default function AdminPage() {
  const meId = useFuel().me?.id ?? null;
  const [f, setF] = useFilters();
  // fixed for the page's life: a new day starts with a reload
  const [today] = useState(() => dayKey(new Date()));
  // twice the period, for "compared with the previous one"; at least 9 weeks, for the cohorts
  const fetchFrom = addDays(today, -(Math.max(f.days * 2, 63) - 1));
  // Read once, and again when something here changes it, rather than followed live: as a live query it
  // ran again on every usage ping and every save from any user, for as long as this page stayed open.
  const convex = useConvex();
  const [data, setData] = useState<Overview>();
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((n) => n + 1), []);
  useEffect(() => {
    let stale = false;
    convex.query(api.admin.overview, { from: fetchFrom, to: today, now: Date.now() })
      .then((d) => { if (!stale) setData(d); })
      .catch((e) => { if (!stale) toast.error(errorText(e)); });
    return () => { stale = true; };
  }, [convex, fetchFrom, today, reloads]);
  const refresh = useMutation(api.admin.refresh);
  const recounted = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(recounted.current), []);
  const [picked, setPicked] = useState<string | null>(null);
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("activeUsers");

  const onRefresh = async () => {
    try {
      await refresh({});
      // each user is counted a second after the one before (convex/admin.ts refreshStats): read the result once they all are
      const seconds = (data?.users.length ?? 0) + 30;
      clearTimeout(recounted.current);
      recounted.current = setTimeout(reload, seconds * 1000);
      toast.success(`Counting everyone's data again. The numbers update in about ${Math.ceil(seconds / 60)} min.`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const header = <PageHeader title="Superadmin" back="/more" right={<Button variant="ghost" size="icon" aria-label="Count storage again" title="Count storage again" onClick={() => void onRefresh()}><RefreshCw className="size-4" /></Button>} />;
  if (data === undefined) {
    return (
      <>
        {header}
        <div className="mx-auto max-w-6xl space-y-4 px-4 pt-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
          <Skeleton className="h-72" />
        </div>
      </>
    );
  }
  return (
    <>
      {header}
      <Dashboard data={data} f={f} setF={setF} meId={meId} today={today} metric={metric} setMetric={setMetric} onPick={setPicked} reload={reload} />
      <UserSheet userId={picked} onClose={() => setPicked(null)} data={data} today={today} days={f.days} />
    </>
  );
}

function Dashboard({ data, f, setF, meId, today, metric, setMetric, onPick, reload }: {
  data: Overview; reload: () => void;
  f: Filters; setF: (p: Partial<Filters>) => void; meId: string | null; today: string;
  metric: (typeof METRICS)[number]["key"]; setMetric: (m: (typeof METRICS)[number]["key"]) => void; onPick: (id: string) => void;
}) {
  const m = useMemo(() => {
    const view = applyFilters(data, f, meId);
    const from = addDays(today, -(f.days - 1));
    const prevFrom = addDays(from, -f.days);
    const prevTo = addDays(from, -1);
    const cur = inRange(view.daily, from, today);
    const prev = inRange(view.daily, prevFrom, prevTo);
    const tc = totals(cur);
    const tp = totals(prev);
    const series = daySeries(view, from, today);
    const prevSeries = daySeries(view, prevFrom, prevTo);
    const startMs = new Date(`${from}T00:00:00`).getTime();
    const prevStartMs = new Date(`${prevFrom}T00:00:00`).getTime();
    const signups = view.users.filter((u) => u.joinedAt >= startMs).length;
    const signupsPrev = view.users.filter((u) => u.joinedAt >= prevStartMs && u.joinedAt < startMs).length;
    const avgDau = series.reduce((s, p) => s + p.activeUsers, 0) / series.length;
    const avgDauPrev = prevSeries.reduce((s, p) => s + p.activeUsers, 0) / prevSeries.length;
    const entries = series.reduce((s, p) => s + p.entries, 0);
    const entriesPrev = prevSeries.reduce((s, p) => s + p.entries, 0);
    const bandwidth = tc.bytesDown + tc.bytesUp + photoBytes(cur, view.stats);
    const bandwidthPrev = tp.bytesDown + tp.bytesUp + photoBytes(prev, view.stats);
    const docsBytes = view.stats.reduce((s, x) => s + Object.values(x.tables).reduce((n, t) => n + t.bytes, 0), 0);
    const fileBytes = view.stats.reduce((s, x) => s + x.files.bytes, 0);
    const fileCount = view.stats.reduce((s, x) => s + x.files.count, 0);
    const curAi = view.ai.filter((r) => r.day >= from && r.day <= today);
    const ai = aiTotals(curAi);
    const aiPrev = aiTotals(view.ai.filter((r) => r.day >= prevFrom && r.day <= prevTo));
    const rows = userRows(view, cur, today, curAi);

    // devices seen in the period, and which build each is on (versions sort as text: YYYY.MM.DD-HH:MM)
    const activeKeys = new Set(cur.map((r) => `${r.userId}|${r.deviceId}`));
    const activeDevices = view.devices.filter((d) => activeKeys.has(`${d.userId}|${d.deviceId}`));
    const latest = activeDevices.reduce((v, d) => (d.appVersion > v ? d.appVersion : v), "");
    const fills = sumRecords(view.stats.map((s) => s.fillUps));
    const usersBefore = view.users.filter((u) => u.joinedAt < startMs).length;
    const cumulative = series.map((_, i) => usersBefore + series.slice(0, i + 1).reduce((n, p) => n + p.signups, 0));
    const thisMonth = today.slice(0, 7);
    const monthReads = (id: string) => view.ai.filter((r) => r.userId === id && r.day.startsWith(thisMonth)).length;

    return {
      view, cur, tc, tp, ai, aiPrev, curAi, series, rows, signups, signupsPrev, avgDau, avgDauPrev, entries, entriesPrev, bandwidth, bandwidthPrev, docsBytes, fileBytes, fileCount,
      activeDevices, latest, fills,
      behind: activeDevices.filter((d) => d.appVersion !== latest).length,
      aiDays: aiSeries(curAi, from, today),
      aiUsers: aiByUser(view.users, curAi),
      aiModels: aiByModel(curAi),
      quality: readQuality(curAi),
      month: monthProjection(view.ai, today),
      nearCap: view.users.map((u) => ({ u, n: monthReads(u.id) })).filter((x) => x.n >= READ_MONTHLY_CAP * 0.8).sort((a, b) => b.n - a.n),
      places: placesTotals(view.places.filter((r) => r.day >= from && r.day <= today)),
      placesMonth: placesTotals(view.places.filter((r) => r.day.startsWith(thisMonth))),
      chartSeries: series.map((p, i) => {
        const pp = prevSeries[i];
        return { day: p.day, value: metric === "users" ? cumulative[i] : (p[metric] as number), prev: metric === "users" ? undefined : (pp?.[metric] as number | undefined), prevDay: pp?.day };
      }),
      tableBytes: sumRecords(view.stats.map((s) => Object.fromEntries(Object.entries(s.tables).map(([k, t]) => [k, t.bytes])))),
      createdByHour: sumRecords(view.stats.map((s) => s.createdByHour)),
      lengths: sumRecords(cur.map((r) => r.lengths)),
      screens: sumRecords(cur.map((r) => r.screens)),
      heat: hourOfWeek(cur),
      cohorts: cohorts(view.users, view.daily, today, 8),
      features: Object.entries(FEATURES).map(([k, label]) => ({ key: k, label, value: view.stats.filter((s) => s.features[k]).length })).sort((a, b) => b.value - a.value),
      staleStats: view.stats.reduce((t, s) => Math.min(t, s.computedAt), Infinity),
      offline: { queued: sumOf(cur, "opsQueuedOffline"), rejected: sumOf(cur, "opsRejected"), waitMs: sumOf(cur, "queueWaitMs"), sent: sumOf(cur, "opsSent") },
      device: { reads: sumOf(cur, "deviceReads"), found: sumOf(cur, "deviceFieldsFound"), kept: sumOf(cur, "deviceFieldsKept") },
      photos: { n: sumOf(cur, "photos"), before: sumOf(cur, "photoBytesBefore"), after: sumOf(cur, "photoBytesAfter") },
    };
  }, [data, f, meId, today, metric]);

  const allOs = [...new Set(data.devices.map((d) => d.os))].sort();
  const metricDef = METRICS.find((x) => x.key === metric)!;
  const periodLabel = RANGES.find((r) => r.days === f.days)?.label ?? `${f.days}d`;
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.value === params.get("tab"))?.value ?? "overview";
  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params);
    if (t === "overview") p.delete("tab");
    else p.set("tab", t);
    setParams(p, { replace: true });
    window.scrollTo(0, 0);
  };
  const q = m.quality;
  const noPrice = m.aiModels.filter((x) => !PRICES[x.model]);

  const aiInfo = "Each read is priced from the tokens Anthropic reports, at list prices (convex/lib/aiCost.ts), when it is made.";
  const aiTiles = (
    <>
      <Tile label="AI cost" value={fmtUsd(m.ai.costUsd)} sub={`${fmtNum(m.ai.calls)} ${m.ai.calls === 1 ? "read" : "reads"} · ${m.ai.users} of ${m.view.users.length} users`} delta={change(m.ai.costUsd, m.aiPrev.costUsd)} info={aiInfo} />
      <Tile label="Cost per read" value={m.ai.calls ? fmtUsd(m.ai.costUsd / m.ai.calls) : "–"} sub={m.ai.calls ? `${fmtNum(q.inputPerRead)} in · ${fmtNum(q.outputPerRead)} out tokens` : "No reads in the period"} />
    </>
  );

  const tiles = (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4 lg:grid-cols-5">
      <Tile label="Users" value={fmtNum(m.view.users.length)} sub={`${m.signups} new in ${periodLabel}`} delta={change(m.signups, m.signupsPrev)} info="Accounts that exist now. The change is in sign-ups against the period before." />
      <Tile label="Active users" value={fmtNum(m.tc.activeUsers)} sub={`${fmtNum(m.avgDau)} a day on average`} delta={change(m.tc.activeUsers, m.tp.activeUsers)} />
      <Tile label="Stickiness" value={m.tc.activeUsers ? fmtPct(m.avgDau / m.tc.activeUsers) : "–"} sub="Daily ÷ period users" delta={change(m.avgDau, m.avgDauPrev)} info="How many of the period's users come back on a typical day. A fuel log is opened at each fill-up, so a low figure is normal here." />
      <Tile label="Opens" value={fmtNum(m.tc.opens)} sub={m.tc.activeUsers ? `${fmtNum(m.tc.opens / m.tc.activeUsers)} per user` : undefined} delta={change(m.tc.opens, m.tp.opens)} info="A session starts when the app is opened, or comes back after 30 minutes away." />
      <Tile label="Avg session" value={m.tc.opens ? fmtDuration(m.tc.activeMs / m.tc.opens) : "–"} sub={`${fmtDuration(m.tc.activeMs)} in total`} delta={change(m.tc.opens ? m.tc.activeMs / m.tc.opens : 0, m.tp.opens ? m.tp.activeMs / m.tp.opens : 0)} info="Time the app was on screen, not just open in a background tab." />
      <Tile label="Fill-ups added" value={fmtNum(m.entries)} sub={`${fmtNum(m.view.stats.reduce((n, s) => n + (s.tables.fillUps?.count ?? 0), 0))} stored in all`} delta={change(m.entries, m.entriesPrev)} />
      <Tile label="Bandwidth" value={fmtBytes(m.bandwidth)} sub={`↓ ${fmtBytes(m.tc.bytesDown)} · ↑ ${fmtBytes(m.tc.bytesUp)}`} delta={change(m.bandwidth, m.bandwidthPrev)} info="Measured on each device: query results as JSON, uploads by size, photo downloads estimated from each user's average photo. An estimate, not Convex's bill." />
      <Tile label="Storage" value={fmtBytes(m.docsBytes + m.fileBytes)} sub={`Docs ${fmtBytes(m.docsBytes)} · photos ${fmtBytes(m.fileBytes)}`} info="Exact sizes of every document and photo the users keep, counted weekly (or with the refresh button)." />
      {aiTiles}
    </div>
  );

  const overTime = (
    <Card title="Over time" hint={`${metricDef.label} per day, last ${periodLabel}`}
      right={(
        <Select value={metric} onValueChange={(v) => setMetric(v as typeof metric)}>
          <SelectTrigger aria-label="Measure" className="h-8 w-36 sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>{METRICS.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
        </Select>
      )}>
      <DayChart data={m.chartSeries} label={metricDef.label} format={metricDef.format} />
    </Card>
  );

  const health = (
    <Card title="Health" hint="Things worth a look">
      <ul className="divide-y text-sm">
        <Health label="AI reads saved with nothing typed" value={q.reads ? fmtPct(q.untouchedShare) : "No reads yet"} bad={q.reads >= 10 && q.untouchedShare < 0.8} />
        <Health label="AI reads that failed or were refused" value={fmtNum(q.outcomes.failed)} bad={q.outcomes.failed > 0} />
        <Health label="Changes the server refused" value={`${fmtNum(m.offline.rejected)} of ${fmtNum(m.offline.sent + m.offline.rejected)}`} bad={m.offline.rejected > 0} />
        <Health label="Fill-ups waiting for a look" value={fmtNum(m.fills.review ?? 0)} bad={(m.fills.review ?? 0) > 0} />
        <Health label="Devices on an older build" value={fmtNum(m.behind)} bad={m.behind > 0} />
        <Health label="Accounts near this month's AI cap" value={fmtNum(m.nearCap.length)} bad={m.nearCap.length > 0} />
        <Health label="Models with no price set" value={noPrice.length ? noPrice.map((x) => x.model).join(", ") : "None"} bad={noPrice.length > 0} />
        <Health label="Storage last counted" value={Number.isFinite(m.staleStats) ? `${formatDistanceToNowStrict(m.staleStats)} ago` : "Never: tap refresh"} bad={!Number.isFinite(m.staleStats) || data.now - m.staleStats > 8 * 86_400_000} />
      </ul>
    </Card>
  );

  const sections: Record<Tab, ReactNode> = {
    overview: (
      <>
        {tiles}
        {overTime}
        <div className="grid gap-4 lg:grid-cols-2">
          {health}
          <Card title="Retention" hint="Share of each sign-up week back in each week after (W0: the sign-up week)"><CohortGrid cohorts={m.cohorts} /></Card>
        </div>
      </>
    ),
    ai: (
      <>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
          {aiTiles}
          <Tile label="This month" value={fmtUsd(m.month.soFar)} sub={`Heading for ${fmtUsd(m.month.projected)}`} info="This calendar month's cost so far, and where it ends at the same pace." />
          <Tile label="Saved, nothing typed" value={q.reads ? fmtPct(q.untouchedShare) : "–"} sub={`${fmtNum(q.outcomes.untouched)} of ${fmtNum(q.reads)} reads · target 80%`} info="Reads that passed every check and that the rider did not change afterwards. This is the number photo reading is judged by." />
        </div>
        <AiAccess users={m.view.users} reload={reload} onPick={onPick} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="How reads end" hint={`${fmtNum(q.reads)} reads, last ${periodLabel}`}>
            <BarList items={OUTCOMES.map((o) => ({ label: o.label, value: q.outcomes[o.key] })).filter((x) => x.value)} of={q.reads} empty="No reads in the period" />
          </Card>
          <Card title="Why reads need a look" hint="The check that failed, most common first">
            <BarList items={Object.entries(q.issues).map(([k, value]) => ({ label: ISSUES[k] ?? k, value })).sort((a, b) => b.value - a.value)} color={SLOT(3)} empty="No read needed a look" />
          </Card>
          <Card title="What riders correct" hint="Fields changed after a read filled them">
            <BarList items={Object.entries(q.corrected).map(([k, value]) => ({ label: FIELDS[k] ?? k, value })).sort((a, b) => b.value - a.value)} of={q.reads} color={SLOT(4)} empty="Nothing corrected" />
          </Card>
          <Card title="The photos" hint={q.reads ? `${fmtNum(q.photosPerRead)} per read on average` : "What was photographed"}>
            <BarList items={Object.entries(q.kinds).map(([k, value]) => ({ label: capital(k === "pump" ? "pump display" : k), value })).sort((a, b) => b.value - a.value)} color={SLOT(5)} empty="No photos read yet" />
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Mini label="Typical read" value={q.typicalMs ? fmtDuration(q.typicalMs) : "–"} />
              <Mini label="Slowest 5%" value={q.slowMs ? fmtDuration(q.slowMs) : "–"} />
              <Mini label="Retried" value={fmtNum(q.retried)} />
            </div>
          </Card>
          <Card title="AI cost per day" hint={`What Claude cost per day, last ${periodLabel}`} className="lg:col-span-2" info={aiInfo}>
            <StackedDayBars data={m.aiDays} series={AI_LIST.map((x) => ({ key: x.key, label: x.label }))} format={fmtUsd} />
          </Card>
          <Card title="AI cost by model" hint={`Default ${AI_MODEL}; ANTHROPIC_MODEL overrides it`}>
            <BarList items={m.aiModels.map((x) => ({ label: <span className="font-mono text-xs">{x.model}</span>, value: x.costUsd, hint: `${fmtNum(x.calls)} reads · ${fmtUsd(x.costUsd / x.calls)} each` }))} format={fmtUsd} of={m.ai.costUsd} color={SLOT(2)} empty="No reads in the period" />
          </Card>
          <Card title="Read on the device (no AI)" hint={`For accounts without AI, last ${periodLabel}`} info="Counted on each device: how often the on-device reader ran, how many fields it filled, and how many of those the rider saved unchanged.">
            <div className="grid grid-cols-3 gap-2">
              <Mini label="Reads" value={fmtNum(m.device.reads)} />
              <Mini label="Fields filled" value={fmtNum(m.device.found)} />
              <Mini label="Kept as filled" value={m.device.found ? fmtPct(m.device.kept / m.device.found) : "–"} />
            </div>
          </Card>
        </div>
        <AiUsers rows={m.aiUsers} nearCap={m.nearCap} onPick={onPick} period={periodLabel} />
        <BadReads />
      </>
    ),
    engagement: (
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="When people open it" hint="Opens by weekday and hour, in each device's own time"><Heatmap grid={m.heat} /></Card>
        <Card title="When fill-ups get logged" hint="Every stored fill-up, by the hour it was added (user's local time)">
          <Columns data={Array.from({ length: 24 }, (_, h) => ({ label: String(h), value: m.createdByHour[`h${h}`] ?? 0 }))} label="Fill-ups" color={SLOT(2)} />
        </Card>
        <Card title="Session length" hint="How long the app stays on screen per open">
          <Columns data={LENGTH_BUCKETS.map((b) => ({ label: b.label, value: m.lengths[b.key] ?? 0 }))} label="Sessions" height="h-48" color={SLOT(6)} />
        </Card>
        <Card title="Screens" hint="Visits in the period">
          <BarList items={Object.entries(m.screens).map(([label, value]) => ({ label: <span className="font-mono text-xs">{label}</span>, value })).sort((a, b) => b.value - a.value)} limit={10} color={SLOT(2)} />
        </Card>
        <Leaderboards rows={m.rows} onPick={onPick} period={periodLabel} />
      </div>
    ),
    devices: (
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Platforms" hint={`Devices used in the last ${periodLabel}`}><BarList items={tally(m.activeDevices, (d) => d.os)} of={m.activeDevices.length} /></Card>
        <Card title="Installed or browser" hint="How each device opens Unfuel">
          <Group title="Opens as"><BarList items={tally(m.activeDevices, (d) => (d.standalone ? "Installed app" : "Browser tab"))} of={m.activeDevices.length} /></Group>
          <Group title="Device type"><BarList items={tally(m.activeDevices, (d) => capital(d.formFactor))} of={m.activeDevices.length} color={SLOT(1)} /></Group>
        </Card>
        <Card title="Browsers"><BarList items={tally(m.activeDevices, (d) => d.browser)} of={m.activeDevices.length} color={SLOT(2)} /></Card>
        <Card title="App versions" hint={m.behind ? `${m.behind} of ${m.activeDevices.length} devices are not on the newest build` : "Every active device is on the newest build"}>
          <BarList items={tally(m.activeDevices, (d) => d.appVersion).sort((a, b) => b.label.localeCompare(a.label)).map((x) => ({ ...x, label: <span className="font-mono text-xs">{x.label}</span> }))} of={m.activeDevices.length} color={SLOT(3)} />
        </Card>
      </div>
    ),
    features: (
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Feature adoption" hint="Users with the feature in use" className="md:row-span-2"><BarList items={m.features} of={m.view.stats.length} limit={20} /></Card>
        <Card title="How fill-ups come in" hint="Every stored fill-up">
          <BarList items={SOURCES.map((s) => ({ label: s.label, value: m.fills[s.key] ?? 0 })).filter((x) => x.value)} of={SOURCES.reduce((n, s) => n + (m.fills[s.key] ?? 0), 0)} color={SLOT(1)} empty="No fill-ups yet" />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Mini label="With photos" value={fmtNum(m.fills.withPhotos ?? 0)} />
            <Mini label="With a place" value={fmtNum(m.fills.withLocation ?? 0)} />
            <Mini label="Sent to UnMoney" value={fmtNum(m.fills.handedOff ?? 0)} />
          </div>
        </Card>
        <Card title="Vehicles" hint="Kinds and fuels users keep">
          <Group title="Kind"><BarList items={Object.entries(sumRecords(m.view.stats.map((s) => s.vehicleKinds))).map(([k, value]) => ({ label: capital(k), value })).sort((a, b) => b.value - a.value)} color={SLOT(3)} /></Group>
          <Group title="Fuel"><BarList items={Object.entries(sumRecords(m.view.stats.map((s) => s.fuelTypes))).map(([k, value]) => ({ label: k === "cng" ? "CNG" : capital(k), value })).sort((a, b) => b.value - a.value)} color={SLOT(4)} /></Group>
        </Card>
        <Card title="Preferences" hint="Currency, theme, how mileage is shown">
          <Group title="Currency"><BarList items={tally(m.view.stats, (s) => s.prefs.currency)} of={m.view.stats.length} limit={4} color={SLOT(4)} /></Group>
          <Group title="Theme"><BarList items={tally(m.view.stats, (s) => s.prefs.theme && capital(s.prefs.theme))} of={m.view.stats.length} limit={3} color={SLOT(4)} /></Group>
          <Group title="Mileage as"><BarList items={tally(m.view.stats, (s) => s.prefs.efficiencyUnit)} of={m.view.stats.length} limit={2} color={SLOT(4)} /></Group>
        </Card>
      </div>
    ),
    data: (
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Bandwidth" hint="Data down and up per day" className="lg:col-span-2">
          <StackedDayBars data={m.series.map((p) => ({ day: p.day, down: p.bytesDown, up: p.bytesUp }))} series={[{ key: "down", label: "Downloaded" }, { key: "up", label: "Uploaded" }]} format={fmtBytes} />
        </Card>
        <Card title="Photos" hint={`Stored now, and what optimising saved in the last ${periodLabel}`} info="Every photo is shrunk on the device before upload (src/lib/image.ts). Sizes before and after are counted there.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Mini label="Stored" value={fmtNum(m.fileCount)} />
            <Mini label="Average size" value={m.fileCount ? fmtBytes(m.fileBytes / m.fileCount) : "–"} />
            <Mini label="Uploaded" value={fmtNum(m.photos.n)} />
            <Mini label="Saved by optimising" value={m.photos.before ? fmtPct(1 - m.photos.after / m.photos.before) : "–"} />
          </div>
        </Card>
        <Card title="Offline" hint={`Changes made with no connection, last ${periodLabel}`}>
          <div className="grid grid-cols-3 gap-2">
            <Mini label="Queued offline" value={fmtNum(m.offline.queued)} />
            <Mini label="Average wait" value={m.offline.queued ? fmtDuration(m.offline.waitMs / m.offline.queued) : "–"} />
            <Mini label="Refused" value={fmtNum(m.offline.rejected)} />
          </div>
        </Card>
        <Card title="Google Places calls" hint={`Last ${periodLabel}: ${fmtNum(m.places.calls)} · this month: ${fmtNum(m.placesMonth.calls)}`} info="Each kind is billed separately by Google, with a free monthly allowance: 35,000 nearby or text searches and place details and 70,000 type-ahead requests on an Indian billing account; 5,000 and 10,000 elsewhere.">
          <BarList items={Object.entries(m.places.bySku).map(([k, value]) => ({ label: PLACES[k] ?? k, value, hint: `${fmtNum(m.placesMonth.bySku[k] ?? 0)} this month` })).sort((a, b) => b.value - a.value)} color={SLOT(5)} empty="No station searches in the period" />
        </Card>
        <Card title="Storage by user" hint="Documents and photos each user keeps · tap for more">
          <BarList items={m.rows.filter((u) => u.storage).sort((a, b) => b.storage - a.storage).map((u) => ({ key: u.id, label: nameOf(u), value: u.storage, hint: `${fmtNum(u.entries)} fill-ups` }))} format={fmtBytes} onPick={onPick} />
        </Card>
        <Card title="Storage by table" hint={`Across every user · photos ${fmtBytes(m.fileBytes)}`}>
          <BarList items={Object.entries(m.tableBytes).filter(([, n]) => n).map(([label, value]) => ({ label: <span className="font-mono text-xs">{label}</span>, value })).sort((a, b) => b.value - a.value)} format={fmtBytes} limit={10} color={SLOT(1)} />
        </Card>
      </div>
    ),
    users: <UsersTable rows={m.rows} onPick={onPick} period={periodLabel} />,
  };

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-4 px-3 pt-3 pb-6 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(f.days)} onValueChange={(v) => setF({ days: Number(v) })}>
          <SelectTrigger aria-label="Period" className="h-8 w-28"><SelectValue /></SelectTrigger>
          <SelectContent>{RANGES.map((r) => <SelectItem key={r.days} value={String(r.days)}>Last {r.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={f.userId} onValueChange={(v) => setF({ userId: v })}>
          <SelectTrigger aria-label="User" className="h-8 w-36 sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>Every user</SelectItem>{data.users.map((u) => <SelectItem key={u.id} value={u.id}>{nameOf(u)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={f.os} onValueChange={(v) => setF({ os: v })}>
          <SelectTrigger aria-label="Platform" className="h-8 w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>Every platform</SelectItem>{allOs.map((os) => <SelectItem key={os} value={os}>{os}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={f.mode} onValueChange={(v) => setF({ mode: v as Filters["mode"] })}>
          <SelectTrigger aria-label="Installed or browser" className="h-8 w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">App and browser</SelectItem><SelectItem value="installed">Installed app</SelectItem><SelectItem value="browser">Browser tab</SelectItem></SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground"><Switch checked={f.includeMe} onCheckedChange={(v) => setF({ includeMe: v })} aria-label="Include my own use" />Include me</label>
      </div>
      {data.truncated ? <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400"><TriangleAlert className="size-4 shrink-0" />There is more usage in this range than one read takes. Pick a shorter period for exact totals.</p> : null}
      {/* seven sections on one row: it scrolls sideways inside itself on a phone, never the page */}
      <div role="tablist" aria-label="Sections" className="no-scrollbar -mx-3 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button key={t.value} role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)}
            className={cn("shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors", tab === t.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>{t.label}</button>
        ))}
      </div>
      <div className="space-y-4">{sections[tab]}</div>
    </div>
  );
}

/** Who may have their photos read by AI. Off for everyone until switched on here; the superadmin always has it. */
function AiAccess({ users, reload, onPick }: { users: Overview["users"]; reload: () => void; onPick: (id: string) => void }) {
  const setAi = useMutation(api.admin.setAi);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const on = (u: Overview["users"][number]) => local[u.id] ?? u.ai;
  const shown = users.filter((u) => !search.trim() || `${u.name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => Number(on(b)) - Number(on(a)) || b.joinedAt - a.joinedAt);
  const apply = async (ids: string[], value: boolean) => {
    setLocal((l) => ({ ...l, ...Object.fromEntries(ids.map((id) => [id, value])) }));
    try {
      await setAi({ userIds: ids as Id<"users">[], on: value });
      setPicked(new Set());
      reload();
    } catch (e) {
      setLocal((l) => ({ ...l, ...Object.fromEntries(ids.map((id) => [id, !value])) }));
      toast.error(errorText(e));
    }
  };
  return (
    <Card title={`AI access (${users.filter(on).length} of ${users.length} on)`} hint="AI reading is off for everyone until you turn it on here. You always have it. Accounts without it get their photos read on their own device.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a user" aria-label="Find a user" className="h-8 pl-8" />
        </div>
        {picked.size ? (
          <>
            <Button size="sm" onClick={() => void apply([...picked], true)}>Turn on for {picked.size}</Button>
            <Button size="sm" variant="outline" onClick={() => void apply([...picked], false)}>Turn off</Button>
          </>
        ) : null}
      </div>
      <ul className="max-h-80 divide-y overflow-y-auto text-sm">
        {shown.map((u) => (
          <li key={u.id} className="flex min-w-0 items-center gap-3 py-2">
            <Checkbox checked={picked.has(u.id)} onCheckedChange={(c) => setPicked((s) => { const n = new Set(s); if (c) n.add(u.id); else n.delete(u.id); return n; })} aria-label={`Select ${nameOf(u)}`} />
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onPick(u.id)}>
              <span className="block truncate font-medium">{nameOf(u)}</span>
              <span className="block truncate text-xs text-muted-foreground">{u.email} · joined {formatDistanceToNowStrict(u.joinedAt, { addSuffix: true })}</span>
            </button>
            <Switch checked={on(u)} onCheckedChange={(v) => void apply([u.id], v)} aria-label={`AI reading for ${nameOf(u)}`} />
          </li>
        ))}
        {!shown.length ? <li className="py-6 text-center text-muted-foreground">Nobody by that name</li> : null}
      </ul>
    </Card>
  );
}

function AiUsers({ rows, nearCap, onPick, period }: { rows: ReturnType<typeof aiByUser<Overview["users"][number]>>; nearCap: { u: Overview["users"][number]; n: number }[]; onPick: (id: string) => void; period: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={`AI cost by user (${rows.length})`} hint={`Last ${period}, dearest first. Tap a user for more.`}>
        <BarList items={rows.map(({ u, t }) => ({ key: u.id, label: nameOf(u), value: t.costUsd, hint: `${fmtNum(t.calls)} reads` }))} format={fmtUsd} onPick={onPick} limit={12} color={SLOT(3)} empty="No reads in the period" />
      </Card>
      <Card title="Near this month's cap" hint={`${READ_MONTHLY_CAP} reads a month per account; past it, photos are read on the device`}>
        <BarList items={nearCap.map(({ u, n }) => ({ key: u.id, label: nameOf(u), value: n, hint: n >= READ_MONTHLY_CAP ? "at the cap" : undefined }))} of={READ_MONTHLY_CAP} onPick={onPick} color={SLOT(6)} empty="Nobody is near the cap" />
      </Card>
    </div>
  );
}

/** Reads that went wrong, with their photos: the one place the dashboard shows a rider's own data, so wrong reads can be fixed. */
function BadReads() {
  const reads = useQuery(api.admin.badReads, {});
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card title="Reads that went wrong" hint="Needed a look, unreadable, failed, or corrected by the rider. Newest first. Tap one for its photos and what was read."
      info="This is the only part of the dashboard that shows a rider's own data: the photos and the reading of a read that went wrong. The privacy page says so.">
      {reads === undefined ? <Skeleton className="h-24" /> : !reads.length ? <p className="py-6 text-center text-sm text-muted-foreground">No read has gone wrong</p> : (
        <ul className="divide-y text-sm">
          {reads.map((r) => (
            <li key={r.id} className="py-2">
              <button type="button" className="flex w-full min-w-0 items-center gap-3 text-left" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{[...r.issues.map((i) => ISSUES[i] ?? i), ...(r.corrected.length ? [`Corrected: ${r.corrected.map((c) => FIELDS[c] ?? c).join(", ")}`] : [])].join(" · ") || capital(r.outcome)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.user ? nameOf(r.user) : "Deleted account"} · {formatDistanceToNowStrict(r.at, { addSuffix: true })} · {r.model}</span>
                </span>
                <span className="shrink-0 text-xs tabular text-muted-foreground">{fmtUsd(r.costUsd)}</span>
              </button>
              {open === r.id ? (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {r.photoUrls.filter((u): u is string => !!u).map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="block size-28 overflow-hidden rounded-md border bg-muted"><img src={u} alt="A photo of this read" className="size-full object-cover" /></a>)}
                    {!r.photoUrls.length ? <span className="text-xs text-muted-foreground">The fill-up or its photos are gone.</span> : null}
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    {Object.entries(r.printed).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words tabular">{v}</dd></div>)}
                    {!Object.keys(r.printed).length ? <dd className="col-span-2 text-muted-foreground">Nothing was read.</dd> : null}
                  </dl>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/50 px-3 py-2">
      <div className="truncate text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Health({ label, value, bad }: { label: string; value: ReactNode; bad?: boolean }) {
  return (
    <li className="flex min-w-0 items-center gap-2 py-2">
      {bad ? <TriangleAlert className="size-4 shrink-0 text-amber-600" aria-label="Needs a look" /> : <span className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1">{label}</span>
      <span className="shrink-0 text-right tabular-nums text-muted-foreground">{value}</span>
    </li>
  );
}

function Leaderboards({ rows, onPick, period }: { rows: UserRow[]; onPick: (id: string) => void; period: string }) {
  const boards: { title: string; hint: string; pick: (u: UserRow) => number; format: (n: number) => string }[] = [
    { title: "Most days in", hint: `Active days, last ${period}`, pick: (u) => u.activeDays, format: fmtNum },
    { title: "Longest logs", hint: "Fill-ups stored", pick: (u) => u.entries, format: fmtNum },
    { title: "Most time in app", hint: `Last ${period}`, pick: (u) => u.activeMs, format: fmtDuration },
    { title: "Dearest on AI", hint: `Last ${period}`, pick: (u) => u.aiCost, format: fmtUsd },
  ];
  return (
    <>
      {boards.map((b, i) => (
        <Card key={b.title} title={b.title} hint={b.hint}>
          <BarList items={rows.filter((u) => b.pick(u) > 0).sort((x, y) => b.pick(y) - b.pick(x)).map((u) => ({ key: u.id, label: nameOf(u), value: b.pick(u) }))} format={b.format} onPick={onPick} limit={5} color={SLOT(i)} />
        </Card>
      ))}
    </>
  );
}

type SortKey = "name" | "lastSeenAt" | "opens" | "activeMs" | "entries" | "storage" | "aiCost" | "joinedAt";

function UsersTable({ rows, onPick, period }: { rows: UserRow[]; onPick: (id: string) => void; period: string }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "lastSeenAt", desc: true });
  const [search, setSearch] = useState("");
  const value = (u: UserRow, k: SortKey) => (k === "name" ? nameOf(u).toLowerCase() : u[k] ?? 0);
  const sorted = rows.filter((u) => !search.trim() || `${u.name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => { const x = value(a, sort.key), y = value(b, sort.key); return (x < y ? -1 : x > y ? 1 : 0) * (sort.desc ? -1 : 1); });
  const th = (key: SortKey, label: string, right = true) => (
    <th scope="col" className={cn("px-2 py-2 font-medium whitespace-nowrap", right && "text-right")} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
      <button type="button" className="hover:text-foreground" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}>{label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}</button>
    </th>
  );
  return (
    <Card title={`Users (${rows.length})`} hint={`Usage covers the last ${period}. Tap a user for more.`}
      right={<Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a user" aria-label="Find a user" className="h-8 w-40" />}>
      {/* a wide table scrolls inside its card, never the page */}
      <div className="-mx-3 overflow-x-auto sm:-mx-4">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">{th("name", "User", false)}{th("lastSeenAt", "Last seen")}{th("opens", "Opens")}{th("activeMs", "Time")}{th("entries", "Fill-ups")}{th("storage", "Storage")}{th("aiCost", "AI")}{th("joinedAt", "Joined")}</tr>
          </thead>
          <tbody className="divide-y">
            {sorted.map((u) => (
              <tr key={u.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onPick(u.id)}>
                <td className="max-w-56 px-2 py-2 pl-3 sm:pl-4">
                  <div className="truncate font-medium">{nameOf(u)}{u.ai ? <span className="ml-1.5 rounded bg-secondary px-1 py-0.5 text-[10px] font-normal">AI</span> : null}</div>
                  <div className="truncate text-xs text-muted-foreground">{u.email}{u.gap ? " · usage not reported" : ""}</div>
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap text-muted-foreground">{u.lastSeenAt ? formatDistanceToNowStrict(u.lastSeenAt, { addSuffix: true }) : "never"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtNum(u.opens)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtDuration(u.activeMs)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtNum(u.entries)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtBytes(u.storage)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{u.aiCalls ? fmtUsd(u.aiCost) : "–"}</td>
                <td className="px-2 py-2 pr-3 text-right whitespace-nowrap text-muted-foreground sm:pr-4">{formatDistanceToNowStrict(u.joinedAt, { addSuffix: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!sorted.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nobody by that name</p> : null}
    </Card>
  );
}
