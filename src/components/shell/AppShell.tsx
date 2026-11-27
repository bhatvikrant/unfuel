import { BarChart3, Fuel as FuelIcon, History, Home, MapPin, MoreHorizontal, Plus, ShieldCheck, Truck } from "lucide-react";
import { useEffect, useRef } from "react";
import { NavLink, Outlet, ScrollRestoration, useLocation } from "react-router";
import { api } from "@convex/_generated/api";
import { useConvex, useOfflineStatus } from "@/lib/convex";
import { FuelProvider, useFuel } from "@/lib/fuel";
import { applyTheme } from "@/lib/theme";
import { useUsage } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";
import { SyncStrip } from "./SyncStatus";

const tabs = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/history", icon: History, label: "History" },
  { to: "/stats", icon: BarChart3, label: "Stats" },
  { to: "/more", icon: MoreHorizontal, label: "More" },
];
/** The desktop sidebar's second group: pages a phone reaches from More. */
const shortcuts = [
  { to: "/stations", icon: MapPin, label: "Stations" },
  { to: "/vehicles", icon: Truck, label: "Vehicles" },
];

const under = (pathname: string, pages: string[]) => pages.some((p) => pathname === p || pathname.startsWith(`${p}/`));
/** The tab a page is reached from. */
function isActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  if (to === "/history") return under(pathname, ["/history", "/fill"]);
  if (to === "/more") return under(pathname, ["/more", "/stations", "/vehicles", "/admin"]);
  return under(pathname, [to]);
}

function Shell() {
  const { pathname } = useLocation();
  const fuel = useFuel();
  const convex = useConvex();
  const { connected } = useOfflineStatus();
  useUsage();

  // screens with a header name themselves (PageHeader); Home has none
  useEffect(() => { if (pathname === "/") document.title = "Unfuel"; }, [pathname]);

  // the rider's theme, once their settings are known (the device's last one painted before that)
  const theme = fuel.settings?.theme;
  useEffect(() => { if (theme) applyTheme(theme); }, [theme]);

  // a new account gets its first vehicle here, online, so nothing later has to ask for one
  const ensured = useRef(false);
  useEffect(() => {
    if (ensured.current || fuel.loading || fuel.vehicles.length || !connected) return;
    ensured.current = true;
    void convex.mutation(api.vehicles.ensure, {}).catch(() => { ensured.current = false; });
  }, [fuel.loading, fuel.vehicles.length, connected, convex]);

  const link = (active: boolean) => cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors", active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60");
  return (
    <div className="flex min-h-dvh bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring">Skip to content</a>
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 self-start border-r bg-sidebar px-3 py-5 md:flex">
        <div className="px-3 pb-4"><Logo /></div>
        <NavLink to="/add" className="mb-2 flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80">
          <Plus className="size-4" /> Add fill-up
        </NavLink>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} className={link(isActive(pathname, t.to))}>
              <t.icon className="size-4" />
              <span className="min-w-0 truncate">{t.label}</span>
              {t.to === "/" && fuel.pending.length ? <span className="ml-auto text-xs tabular text-muted-foreground" aria-label={`${fuel.pending.length} fill-ups waiting`}>{fuel.pending.length}</span> : null}
            </NavLink>
          ))}
          <div className="mt-4 px-3 pb-1 text-xs uppercase tracking-wide text-muted-foreground">Shortcuts</div>
          {shortcuts.map((t) => (
            <NavLink key={t.to} to={t.to} className={link(under(pathname, [t.to]))}><t.icon className="size-4" />{t.label}</NavLink>
          ))}
          {fuel.me?.superadmin ? <NavLink to="/admin" className={link(under(pathname, ["/admin"]))}><ShieldCheck className="size-4" />Superadmin</NavLink> : null}
        </nav>
        <div className="mt-auto flex min-w-0 items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
          <FuelIcon className="size-4 shrink-0" />
          <span className="min-w-0 truncate">{fuel.vehicle?.name ?? "No vehicle yet"}</span>
        </div>
      </aside>
      {/* room below the last row for the tab bar on a phone */}
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 pb-[calc(var(--tabbar-h)+1.5rem)] outline-none md:pb-6">
        <SyncStrip />
        <Outlet />
      </main>
      <nav aria-label="Tabs" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-background md:hidden">
        <div className="grid h-14 grid-cols-5">
          {tabs.slice(0, 2).map((t) => <Tab key={t.to} {...t} active={isActive(pathname, t.to)} badge={t.to === "/" ? fuel.pending.length : 0} />)}
          <NavLink to="/add" aria-label="Add fill-up" className="flex items-center justify-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-pop"><Plus className="size-6" /></span>
          </NavLink>
          {tabs.slice(2).map((t) => <Tab key={t.to} {...t} active={isActive(pathname, t.to)} badge={0} />)}
        </div>
      </nav>
      {/* Back to a long list lands where it was left; a new page starts at the top. */}
      <ScrollRestoration />
    </div>
  );
}

function Tab({ to, icon: Icon, label, active, badge }: { to: string; icon: typeof Home; label: string; active: boolean; badge: number }) {
  return (
    <NavLink to={to} className={cn("flex min-w-0 flex-col items-center justify-center gap-0.5 text-[11px]", active ? "text-primary" : "text-muted-foreground")}>
      <span className="relative">
        <Icon className="size-5" strokeWidth={active ? 2.4 : 1.8} />
        {badge ? <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-medium text-primary-foreground tabular" aria-label={`${badge} fill-ups waiting`}>{badge > 99 ? "99+" : badge}</span> : null}
      </span>
      <span className="whitespace-nowrap">{label}</span>
    </NavLink>
  );
}

export default function AppShell() {
  return <FuelProvider><Shell /></FuelProvider>;
}
