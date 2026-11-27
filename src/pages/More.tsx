/** Everything that is not a fill-up: vehicles, stations, how figures are shown, UnMoney, installing, exporting, the account. */
import { useAuthActions } from "@convex-dev/auth/react";
import { ChevronRight, Download, LogOut, MapPin, ShieldCheck, Smartphone, Trash2, Truck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { CURRENCIES } from "@convex/lib/currencies";
import { useConfirm } from "@/components/ConfirmDialog";
import { Card, Page, PageHeader } from "@/components/shell/PageHeader";
import { useSyncText } from "@/components/shell/SyncStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useConvex, useMutation, useOffline, useOfflineStatus, useRequireOnline } from "@/lib/convex";
import { errorText } from "@/lib/format";
import { useFuel } from "@/lib/fuel";
import { useInstall } from "@/lib/install";

function Row({ label, sub, children }: { label: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0"><div className="truncate text-sm font-medium">{label}</div>{sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
function Nav({ to, icon: Icon, label, sub }: { to: string; icon: typeof Truck; label: string; sub?: string }) {
  return (
    <Link to={to} className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-muted/60">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{label}</span>{sub ? <span className="block truncate text-xs text-muted-foreground">{sub}</span> : null}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section><h2 className="px-1 pb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2><Card className="divide-y p-0">{children}</Card></section>
);

/** RFC 4180: a field with a comma, a quote or a line break is quoted, and quotes inside it doubled. */
const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export default function MorePage() {
  const f = useFuel();
  const { signOut } = useAuthActions();
  const convex = useConvex();
  const { store } = useOffline();
  const status = useOfflineStatus();
  const sync = useSyncText();
  const confirm = useConfirm();
  const requireOnline = useRequireOnline();
  const install = useInstall();
  const update = useMutation(api.settings.update);
  const setUnmoney = useMutation(api.settings.setUnmoney);
  const removeAccount = useMutation(api.account.remove);
  const [link, setLink] = useState("");
  const s = f.settings;
  const run = (work: () => Promise<unknown>, ok?: string) => void work().then(() => ok && toast.success(ok)).catch((e) => toast.error(errorText(e)));

  async function exportCsv() {
    try {
      requireOnline();
      const rows = await convex.query(api.exports.rows, {});
      if (!rows.length) { toast.message("There is nothing to export yet"); return; }
      const head = Object.keys(rows[0]) as (keyof (typeof rows)[number])[];
      const csv = [head.join(","), ...rows.map((r) => head.map((k) => csvCell(String(r[k]))).join(","))].join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `unfuel-${new Date().toISOString().slice(0, 10)}.csv` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function leave() {
    const waiting = await store.pendingOnDisk();
    const kept = store.failed.length;
    if (waiting + kept && !(await confirm({ title: "Sign out and lose what has not synced?", description: `${waiting + kept} ${waiting + kept === 1 ? "change has" : "changes have"} not reached the server yet, with any photos. Signing out deletes them from this device.`, action: "Sign out anyway" }))) return;
    await signOut();
  }

  async function deleteAccount() {
    if (!(await confirm({ title: "Delete your account?", description: "Every fill-up, photo, vehicle and station is deleted for good. This cannot be undone.", action: "Delete everything" }))) return;
    try {
      requireOnline();
      await removeAccount({ confirm: "DELETE" });
      await signOut();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <>
      <PageHeader title="More" />
      <Page className="space-y-5">
        <Card className="flex min-w-0 items-center gap-3">
          {f.me?.image ? <img src={f.me.image} alt="" className="size-10 shrink-0 rounded-full" referrerPolicy="no-referrer" /> : <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium">{(f.me?.name ?? f.me?.email ?? "?").slice(0, 1).toUpperCase()}</span>}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{f.me?.name ?? "Your account"}</div>
            <div className="truncate text-xs text-muted-foreground">{f.me?.email}</div>
          </div>
        </Card>

        <Group title="Your log">
          <Nav to="/vehicles" icon={Truck} label="Vehicles" sub={f.vehicle ? `Current: ${f.vehicle.name}` : undefined} />
          <Nav to="/stations" icon={MapPin} label="Stations" sub={`${f.stations.length} ${f.stations.length === 1 ? "station" : "stations"}`} />
          {f.me?.superadmin ? <Nav to="/admin" icon={ShieldCheck} label="Superadmin" sub="Usage, AI cost and access" /> : null}
        </Group>

        <Group title="Reading photos">
          <Row label={f.me?.ai ? "AI reading is on" : "AI reading is off for this account"} sub={f.me?.ai ? "Photos are read for you, up to 60 fill-ups a month." : "Photos are still kept, and read on this device as far as it can."} />
        </Group>

        <Group title="How figures are shown">
          <Row label="Mileage as">
            <Select value={s?.efficiencyUnit ?? "km/l"} onValueChange={(v) => run(() => update({ efficiencyUnit: v as "km/l" | "l/100km" }))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="km/l">km per litre</SelectItem><SelectItem value="l/100km">L per 100 km</SelectItem></SelectContent>
            </Select>
          </Row>
          <Row label="Currency">
            <Select value={s?.currency ?? "INR"} onValueChange={(v) => run(() => update({ currency: v }))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} · {c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Row>
          <Row label="Theme">
            <Select value={s?.theme ?? "system"} onValueChange={(v) => run(() => update({ theme: v as "system" | "light" | "dark" }))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem></SelectContent>
            </Select>
          </Row>
          <Row label="I usually fill the tank" sub="New fill-ups start with Full tank on.">
            <Switch checked={s?.fullTankDefault ?? false} onCheckedChange={(v) => run(() => update({ fullTankDefault: v }))} aria-label="I usually fill the tank" />
          </Row>
        </Group>

        <Group title="UnMoney">
          {s?.unmoney ? (
            <>
              <Row label="Connected" sub={`Link ending ${s.unmoney.tail}`}><Button variant="outline" size="sm" onClick={() => run(() => setUnmoney({ clear: true }), "UnMoney disconnected")}>Disconnect</Button></Row>
              <Row label="Send every fill-up" sub="Each fill-up becomes an expense in UnMoney as soon as it is complete.">
                <Switch checked={s.unmoney.auto} onCheckedChange={(v) => run(() => setUnmoney({ auto: v }))} aria-label="Send every fill-up to UnMoney" />
              </Row>
            </>
          ) : (
            <div className="space-y-2 px-4 py-3">
              <p className="text-sm text-muted-foreground">Log fill-ups in UnMoney as expenses, one at a time or all of them. Paste your UnMoney link here.</p>
              <div className="flex min-w-0 gap-2">
                <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/unfuel/…" aria-label="UnMoney link" autoComplete="off" className="min-w-0" />
                <Button disabled={!link.trim() || !status.connected} onClick={() => run(async () => { await setUnmoney({ url: link }); setLink(""); }, "UnMoney connected")}>Connect</Button>
              </div>
            </div>
          )}
        </Group>

        <Group title="This device">
          {!install.installed ? (
            <Row label="Install Unfuel" sub={install.manual ? "In Safari: Share, then Add to Home Screen." : install.canPrompt ? "Opens full screen from your home screen and works offline." : "Use your browser's menu: Install app, or Add to Home Screen."}>
              {install.canPrompt ? <Button variant="outline" size="sm" onClick={() => void install.install()}><Smartphone />Install</Button> : null}
            </Row>
          ) : <Row label="Installed" sub="Unfuel is running as an app on this device." />}
          <Row label="Sync" sub={sync?.text ?? "Everything is synced"} />
          <Row label="Version" sub={import.meta.env.VITE_APP_VERSION ?? "dev"} />
        </Group>

        <Group title="Your data">
          <Row label="Export as a spreadsheet" sub="Every fill-up, as a CSV file."><Button variant="outline" size="sm" onClick={() => void exportCsv()}><Download />Export</Button></Row>
          <Link to="/privacy" className="flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/60">Privacy <ChevronRight className="size-4 text-muted-foreground" /></Link>
          <Row label="Sign out"><Button variant="outline" size="sm" onClick={() => void leave()}><LogOut />Sign out</Button></Row>
          <Row label="Delete account" sub="Everything is deleted for good."><Button variant="destructive" size="sm" onClick={() => void deleteAccount()}><Trash2 />Delete</Button></Row>
        </Group>
      </Page>
    </>
  );
}
