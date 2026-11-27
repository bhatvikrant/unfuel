/** One user on the superadmin dashboard: their use over the period, devices, AI reads, what they store, latest sessions. Counts only. */
import { formatDistanceToNowStrict } from "date-fns";
import { TriangleAlert } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/convex";
import { BarList, DayChart, SLOT, Tile } from "./charts";
import { addDays, aiTotals, daySeries, fmtBytes, fmtDuration, fmtNum, fmtPct, fmtUsd, inRange, photoBytes, readQuality, storageOf, streaks, totals, usageGap, type Overview } from "./metrics";

const FEATURE_LABELS: Record<string, string> = {
  aiReading: "AI reading", deviceReading: "Device reading", typedOnly: "Types everything", photosKept: "Photos", location: "Location", stations: "Stations",
  googleStations: "Google stations", fullTankRider: "Fills the tank", severalVehicles: "Several vehicles", notes: "Notes", unmoney: "UnMoney", unmoneyAuto: "UnMoney, automatic",
};

export function UserSheet({ userId, onClose, data, today, days }: { userId: string | null; onClose: () => void; data: Overview; today: string; days: number }) {
  const user = data.users.find((u) => u.id === userId);
  return (
    <Sheet open={!!user} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {user ? <Body user={user} data={data} today={today} days={days} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({ user, data, today, days }: { user: Overview["users"][number]; data: Overview; today: string; days: number }) {
  const sessions = useQuery(api.admin.userSessions, { userId: user.id as Id<"users">, limit: 30 });
  const from = addDays(today, -(days - 1));
  const daily = inRange(data.daily.filter((r) => r.userId === user.id), from, today);
  const stats = data.stats.find((s) => s.userId === user.id);
  const devices = data.devices.filter((d) => d.userId === user.id).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const t = totals(daily);
  const ai = data.ai.filter((r) => r.userId === user.id && r.day >= from && r.day <= today);
  const monthReads = data.ai.filter((r) => r.userId === user.id && r.day.startsWith(today.slice(0, 7))).length;
  const view = { users: [user], devices, daily, stats: stats ? [stats] : [], ai, places: [] };
  const spent = aiTotals(ai);
  const quality = readQuality(ai);
  const series = daySeries(view, from, today);
  const streak = streaks(data.daily.filter((r) => r.userId === user.id).map((r) => r.day), today);
  const gap = usageGap(devices[0]?.lastSeenAt ?? null, user.lastSyncAt);
  const features = stats ? Object.entries(stats.features).filter(([k, on]) => on && FEATURE_LABELS[k]).map(([k]) => FEATURE_LABELS[k]) : [];
  return (
    <>
      <SheetHeader className="flex-row items-center gap-3 space-y-0">
        {user.image ? <img src={user.image} alt="" className="size-11 shrink-0 rounded-full" referrerPolicy="no-referrer" /> : <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary font-medium">{(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}</span>}
        <div className="min-w-0 pr-6">
          <SheetTitle className="truncate">{user.name || user.email || "Unnamed"}</SheetTitle>
          <SheetDescription>
            <span className="block truncate">{user.email}</span>
            Joined {formatDistanceToNowStrict(user.joinedAt, { addSuffix: true })} · AI reading {user.ai ? "on" : "off"}
            {stats?.firstFillDate ? ` · fill-ups back to ${stats.firstFillDate}` : ""}
          </SheetDescription>
        </div>
      </SheetHeader>
      <div className="space-y-5 px-4 pb-8">
        {gap && user.lastSyncAt ? (
          <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <div>
              <div className="font-medium">{gap === "none" ? "No usage reported" : "Usage stopped reporting"} · last fill-up saved {formatDistanceToNowStrict(user.lastSyncAt, { addSuffix: true })}</div>
              <div className="text-muted-foreground">Their app still saves fill-ups but {gap === "none" ? "has never sent" : "no longer sends"} usage counts, most likely an installed copy stuck on an older version. Opens and time here are not real.</div>
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile small label="Opens" value={fmtNum(t.opens)} sub={`${t.userDays} active days`} />
          <Tile small label="Time in app" value={fmtDuration(t.activeMs)} sub={t.opens ? `${fmtDuration(t.activeMs / t.opens)} a session` : undefined} />
          <Tile small label="Streak" value={`${streak.current}d`} sub={`Longest ${streak.longest}d`} />
          <Tile small label="Fill-ups" value={fmtNum(stats?.tables.fillUps?.count ?? 0)} sub={stats ? `${fmtNum(stats.fillUps.photo ?? 0)} by AI · ${fmtNum(stats.fillUps.device ?? 0)} on device` : undefined} />
          <Tile small label="Storage" value={stats ? fmtBytes(storageOf(stats)) : "–"} sub={stats ? `${stats.files.count} photos · ${fmtBytes(stats.files.bytes)}` : "Not counted yet"} />
          <Tile small label="Bandwidth" value={fmtBytes(t.bytesDown + t.bytesUp + photoBytes(daily, stats ? [stats] : []))} sub={`${fmtNum(t.opsSent)} changes synced`} />
        </div>

        <section>
          <h3 className="mb-2 text-sm font-medium">Minutes in app per day</h3>
          <DayChart data={series.map((p) => ({ day: p.day, value: p.activeMin }))} label="Minutes" format={(n) => fmtNum(Math.round(n))} />
        </section>

        <section>
          <h3 className="mb-2 text-sm font-medium">AI reads{spent.calls ? ` · ${fmtUsd(spent.costUsd)}` : ""}</h3>
          <ul className="divide-y rounded-md border text-sm">
            {spent.calls ? (
              <>
                <li className="flex justify-between gap-2 px-3 py-2"><span>Reads in the period</span><span className="tabular-nums">{fmtNum(spent.calls)} · {fmtNum(spent.inputTokens)} tokens in · {fmtNum(spent.outputTokens)} out</span></li>
                <li className="flex justify-between gap-2 px-3 py-2"><span>Saved with nothing typed</span><span className="tabular-nums">{fmtPct(quality.untouchedShare)}</span></li>
                <li className="flex justify-between gap-2 px-3 py-2"><span>Needed a look or failed</span><span className="tabular-nums">{fmtNum(quality.outcomes.review + quality.outcomes.unreadable + quality.outcomes.failed)}</span></li>
              </>
            ) : <li className="px-3 py-3 text-muted-foreground">No AI reads in the period</li>}
            <li className="flex justify-between gap-2 px-3 py-2"><span>This month, against the cap</span><span className="tabular-nums">{fmtNum(monthReads)}</span></li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-medium">Devices ({devices.length})</h3>
          <ul className="divide-y rounded-md border text-sm">
            {devices.map((d) => (
              <li key={d.deviceId} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{d.os} · {d.browser} · {d.formFactor}{d.standalone ? " · installed" : ""}</div>
                  <div className="truncate text-xs text-muted-foreground">{d.sessions} sessions · build {d.appVersion} · UTC{d.tzOffset >= 0 ? "+" : "−"}{fmtOffset(Math.abs(d.tzOffset))}</div>
                </div>
                <span className="text-xs whitespace-nowrap text-muted-foreground">{formatDistanceToNowStrict(d.lastSeenAt, { addSuffix: true })}</span>
              </li>
            ))}
            {!devices.length ? <li className="px-3 py-3 text-muted-foreground">No device has reported usage</li> : null}
          </ul>
        </section>

        {stats ? (
          <section>
            <h3 className="mb-2 text-sm font-medium">What they keep</h3>
            <BarList items={Object.entries(stats.tables).filter(([, x]) => x.count).map(([k, x]) => ({ label: <span className="font-mono text-xs">{k}</span>, value: x.bytes, hint: `${fmtNum(x.count)} ${x.count === 1 ? "doc" : "docs"}` })).sort((a, b) => b.value - a.value)} format={fmtBytes} limit={8} color={SLOT(1)} />
            {features.length ? <div className="mt-3 flex flex-wrap gap-1.5">{features.map((f) => <span key={f} className="rounded-full border px-2 py-0.5 text-xs">{f}</span>)}</div> : null}
          </section>
        ) : null}

        <section>
          <h3 className="mb-2 text-sm font-medium">Latest sessions</h3>
          {sessions === undefined ? <Skeleton className="h-32" /> : (
            <ul className="divide-y rounded-md border text-sm">
              {sessions.map((s) => (
                <li key={s.sessionId} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div>{new Date(s.startedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {fmtDuration(s.totals.activeMs ?? 0)}</div>
                    <div className="truncate text-xs text-muted-foreground">{Object.entries(s.screens).sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 5).join(", ") || "–"}</div>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">↓ {fmtBytes(s.totals.bytesDown ?? 0)}</span>
                </li>
              ))}
              {!sessions.length ? <li className="px-3 py-3 text-muted-foreground">No sessions yet</li> : null}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

const fmtOffset = (min: number) => `${Math.floor(min / 60)}${min % 60 ? `:${String(min % 60).padStart(2, "0")}` : ""}`;
