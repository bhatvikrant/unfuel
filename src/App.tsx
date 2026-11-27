import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, useLocation, useRouteError } from "react-router";
import { isSuperadmin } from "@convex/lib/admin";
import AppShell from "@/components/shell/AppShell";
import { FullPageLoader, useAuthDecision } from "@/components/shell/Gate";
import { Empty } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { useFuel } from "@/lib/fuel";
import AddPage from "@/pages/Add";
import FillPage from "@/pages/FillPage";
import HistoryPage from "@/pages/History";
import HomePage from "@/pages/Home";
import Landing from "@/pages/Landing";
import MorePage from "@/pages/More";
import Privacy from "@/pages/Privacy";
import { StationPage, StationsPage } from "@/pages/Stations";
import VehiclesPage from "@/pages/Vehicles";

// Charts (Recharts) load with the screen that draws them, not with the first paint.
const StatsPage = lazy(() => import("@/pages/Stats"));
// Its own chunk (AdminPage-*.js), left out of the service worker's precache (vite.config.ts): only the superadmin ever downloads it.
const AdminPage = lazy(() => import("@/pages/admin/AdminPage"));

const screen = (node: ReactNode) => <Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>}>{node}</Suspense>;

/** Signed out, "/" is the landing page and everything else leads to it. Signed in, the app. */
function Root() {
  const state = useAuthDecision();
  const { pathname } = useLocation();
  if (state === "loading") return <FullPageLoader />;
  if (state === "out") return pathname === "/" ? <Landing /> : <Navigate to="/" replace />;
  return <AppShell />;
}

/** The server answers only the superadmin too (convex/admin.ts); here it keeps everyone else from fetching the page's code. */
function AdminOnly() {
  const { me, loading } = useFuel();
  if (loading) return null;
  return isSuperadmin(me?.email) ? screen(<AdminPage />) : <Navigate to="/" replace />;
}

function NotFound() {
  return <Empty title="There is nothing at this address" action={<Button asChild><a href="/">Go home</a></Button>} />;
}

function RouteError() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);
  return <Empty title="This screen could not be shown" action={<Button onClick={() => window.location.assign("/")}>Go home</Button>}>Your changes on this device are kept. Going home usually fixes it.</Empty>;
}

export const router = createBrowserRouter([
  { path: "/privacy", element: <Privacy /> },
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      {
        // A page that throws shows this inside the shell instead of react-router's bare error screen.
        errorElement: <RouteError />,
        children: [
          { path: "/", element: <HomePage /> },
          { path: "/add", element: <AddPage /> },
          { path: "/history", element: <HistoryPage /> },
          { path: "/fill/:id", element: <FillPage /> },
          { path: "/stats", element: screen(<StatsPage />) },
          { path: "/stations", element: <StationsPage /> },
          { path: "/stations/:id", element: <StationPage /> },
          { path: "/vehicles", element: <VehiclesPage /> },
          { path: "/more", element: <MorePage /> },
          { path: "/admin", element: <AdminOnly /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);
