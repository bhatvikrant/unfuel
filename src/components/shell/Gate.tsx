import { useConvexAuth as useTokenAuth } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useOfflineStatus } from "@/offline/context";
import { Logo } from "./Logo";

export function FullPageLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center" aria-busy="true" aria-label="Loading Unfuel">
      <div className="animate-pulse"><Logo size={32} /></div>
    </div>
  );
}

/**
 * Two views of "signed in": the token stored on this device, and the server having accepted it.
 * Online we wait for the server. Offline the stored token is all there is, so it decides; if it
 * turns out to be stale, the refresh on reconnect fails, the token is cleared and the app shows the
 * landing page. (UnSplit's rule.)
 */
export function useAuthDecision(): "loading" | "in" | "out" {
  const token = useTokenAuth();
  const server = useConvexAuth();
  const { offline } = useOfflineStatus();
  if (server.isAuthenticated) return "in";
  if (!token.isLoading && !token.isAuthenticated) return "out";
  if (token.isAuthenticated && offline) return "in";
  return "loading";
}
