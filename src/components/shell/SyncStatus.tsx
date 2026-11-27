import { CloudOff, RefreshCw } from "lucide-react";
import { useOfflineStatus } from "@/lib/convex";
import { cn } from "@/lib/utils";

/** What the queue is doing, in words: nothing when all is synced and online. */
export function useSyncText(): { text: string; offline: boolean } | null {
  const s = useOfflineStatus();
  if (s.offline) return { text: s.pending ? `Offline · ${s.pending} waiting` : "Offline", offline: true };
  if (s.pending) return { text: s.syncing ? `Syncing ${s.pending}…` : `${s.pending} waiting to sync`, offline: false };
  return null;
}

/** A thin strip under the header while offline or syncing, so a rider at a pump with no signal knows nothing is lost. */
export function SyncStrip({ className }: { className?: string }) {
  const s = useSyncText();
  if (!s) return null;
  return (
    <div role="status" className={cn("flex items-center justify-center gap-1.5 bg-muted px-3 py-1 text-xs text-muted-foreground", className)}>
      {s.offline ? <CloudOff className="size-3.5 shrink-0" /> : <RefreshCw className="size-3.5 shrink-0 animate-spin" />}
      <span className="truncate">{s.text}{s.offline ? ". Changes are kept on this device." : ""}</span>
    </div>
  );
}
