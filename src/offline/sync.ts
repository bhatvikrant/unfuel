/**
 * The sync engine. Every write goes through `submit`: it lands in the durable
 * outbox first, then is sent to Convex in order whenever the socket is up.
 * Online, callers wait for the server's answer (so forms can show validation
 * errors inline). Offline, or if the connection drops while waiting, callers
 * get the optimistic result straight away and the op stays queued.
 */
import { ConvexError } from "convex/values";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import type { ConvexReactClient } from "convex/react";
import { toast } from "sonner";
import { containsTempId, rewriteIds, tempId } from "./ids";
import { bump } from "@/lib/counters";
import { SPECS, type PrepareCtx } from "./specs";
import type { OfflineStore } from "./store";
import { OfflineError, type Op, type SyncStatus } from "./types";

type Waiter = { resolve: (v: unknown) => void; reject: (e: unknown) => void; optimistic: unknown };

/**
 * How long the socket may be down before the UI calls it offline. The socket
 * closes and reopens on every launch (the auth token is applied after the
 * first connect) and on quick reconnects; neither should flash the banner.
 * No network (`navigator.onLine` false) still shows at once.
 */
const OFFLINE_GRACE_MS = 4000;

function errorText(e: unknown): string {
  if (e instanceof ConvexError) return typeof e.data === "string" ? e.data : "Something went wrong";
  if (e instanceof Error) {
    const m = e.message.match(/Uncaught (?:ConvexError|Error): ([^\n]+)/);
    if (m) return m[1];
    return e.message.length > 200 ? "Something went wrong" : e.message;
  }
  return "Something went wrong";
}

export class SyncEngine {
  private listeners = new Set<() => void>();
  private waiters = new Map<string, Waiter>();
  private draining = false;
  private socketUp = false;
  /** The socket has been down for longer than the grace period. */
  private stale = false;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private client: ConvexReactClient;
  private store: OfflineStore;
  status: SyncStatus;

  constructor(client: ConvexReactClient, store: OfflineStore) {
    this.client = client;
    this.store = store;
    this.status = { online: typeof navigator === "undefined" ? true : navigator.onLine, connected: false, offline: false, syncing: false, pending: 0, lastError: null };
    this.socketUp = client.connectionState().isWebSocketConnected;
    this.watchStale();
    client.subscribeToConnectionState((s) => {
      const was = this.socketUp;
      this.socketUp = s.isWebSocketConnected;
      if (was !== this.socketUp) this.watchStale();
      this.recompute();
      if (!was && this.socketUp) void this.drain();
      if (was && !this.socketUp) this.releaseWaiters();
    });
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        this.recompute();
        void this.drain();
      });
      window.addEventListener("offline", () => {
        this.recompute();
        this.releaseWaiters();
      });
    }
    store.subscribe(() => this.recompute());
    void store.hydrated.then(() => {
      this.recompute();
      void this.drain();
    });
    this.recompute();
  }

  // ---------- status ----------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Socket down: count it as offline only once it has stayed down for the grace period. Socket up: never. */
  private watchStale() {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = null;
    this.stale = false;
    if (this.socketUp) return;
    this.staleTimer = setTimeout(() => {
      this.staleTimer = null;
      this.stale = true;
      this.recompute();
    }, OFFLINE_GRACE_MS);
  }

  private recompute() {
    const online = typeof navigator === "undefined" ? true : navigator.onLine;
    const connected = this.socketUp;
    const next: SyncStatus = {
      online,
      connected,
      offline: !online || (!connected && this.stale),
      syncing: this.draining && connected && this.store.outbox.length > 0,
      pending: this.store.outbox.length,
      lastError: this.status.lastError,
    };
    const s = this.status;
    if (s.online === next.online && s.connected === next.connected && s.offline === next.offline && s.syncing === next.syncing && s.pending === next.pending && s.lastError === next.lastError) return;
    this.status = next;
    for (const l of this.listeners) l();
  }

  /** Writes can be sent right now. */
  isConnected(): boolean {
    return this.status.online && this.socketUp;
  }

  // ---------- submit ----------

  async submit(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const spec = SPECS[fn];
    if (!spec) {
      if (!this.isConnected()) throw new OfflineError();
      return this.client.mutation(makeFunctionReference<"mutation">(fn) as FunctionReference<"mutation">, args);
    }
    await this.store.hydrated;
    const me = this.store.me();
    if (!me) throw new Error("Still loading your account. Try again in a moment.");
    const ctx: PrepareCtx = { me, read: (name, a) => this.store.readView(name, a) };
    const prepared = spec.prepare(args, ctx);
    const op: Op = {
      id: `op_${tempId("op").slice(4)}`,
      seq: this.store.nextSeq(),
      fn,
      args: prepared.args,
      tempId: prepared.tempId,
      extra: prepared.extra,
      me,
      createdAt: Date.now(),
      attempts: 0,
    };
    const durable = await this.store.enqueue(op);
    if (!durable && !this.isConnected()) {
      toast.warning("This change couldn't be saved on this device. Keep the app open until you're back online, or it will be lost.", { id: "outbox-volatile", duration: 8000 });
    }
    if (!this.isConnected()) {
      bump("opsQueuedOffline");
      void this.drain();
      return prepared.result;
    }
    return new Promise((resolve, reject) => {
      this.waiters.set(op.id, { resolve, reject, optimistic: prepared.result });
      void this.drain();
    });
  }

  /** The connection went away: callers stop waiting and get the optimistic value. The ops stay queued. */
  private releaseWaiters() {
    for (const [id, w] of this.waiters) {
      this.waiters.delete(id);
      w.resolve(w.optimistic);
    }
  }

  // ---------- drain ----------

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    this.recompute();
    try {
      await this.store.hydrated;
      while (this.isConnected() && this.store.outbox.length > 0) {
        const op = this.store.outbox[0];
        const args = rewriteIds(op.args, this.store.idMap);
        if (containsTempId(args)) {
          await this.fail(op, "it depends on an earlier change that didn't go through");
          continue;
        }
        const spec = SPECS[op.fn];
        // photos that waited on the device go up first; their ids take the place of the keys
        let photoIds: string[] | null;
        try {
          photoIds = await this.uploadPhotos(op);
        } catch (e) {
          if (!this.isConnected()) break;
          await this.fail(op, errorText(e), e);
          continue;
        }
        const withPhotos = photoIds ? { ...args, photoIds: [...((args.photoIds as string[] | undefined) ?? []), ...photoIds] } : args;
        const sendArgs = spec?.clientKey ? { ...withPhotos, clientKey: op.id } : withPhotos;
        // Bookkeeping only: the mutation is not held up waiting for the disk.
        void this.store.updateOp(op.id, { attempts: op.attempts + 1 });
        let result: unknown;
        try {
          result = await this.client.mutation(makeFunctionReference<"mutation">(op.fn) as FunctionReference<"mutation">, sendArgs);
        } catch (e) {
          if (!this.isConnected()) break; // transient: keep it for the next connection
          await this.fail(op, errorText(e), e);
          continue;
        }
        bump("opsSent");
        bump("bytesUp", JSON.stringify(sendArgs).length);
        if (!this.waiters.has(op.id)) bump("queueWaitMs", Date.now() - op.createdAt);
        // complete() updates memory at once and then writes to disk; the form hears back without waiting for the disk.
        const saved = this.store.complete(op.id, spec?.mapResult?.(op, result) ?? []);
        // only now, with the fill-up on the server, do its photos leave the device
        void this.store.deleteBlobs((op.extra?.blobKeys as string[] | undefined) ?? []);
        const w = this.waiters.get(op.id);
        if (w) {
          this.waiters.delete(op.id);
          w.resolve(result);
        }
        await saved;
        this.status = { ...this.status, lastError: null };
      }
    } finally {
      this.draining = false;
      this.recompute();
    }
  }

  /**
   * Upload the photos a queued fill-up carries, one at a time: ask for an address, send the bytes,
   * claim the file. Each id is written to the op as soon as it is known, so a reload half way
   * through resumes from there instead of uploading again. Null when the op has no photos.
   */
  private async uploadPhotos(op: Op): Promise<string[] | null> {
    const keys = (op.extra?.blobKeys as string[] | undefined) ?? [];
    if (!keys.length) return null;
    const uploaded: Record<string, string> = { ...((op.extra?.uploaded as Record<string, string> | undefined) ?? {}) };
    const call = (fn: string, args: Record<string, unknown>) => this.client.mutation(makeFunctionReference<"mutation">(fn) as FunctionReference<"mutation">, args);
    for (const key of keys) {
      if (uploaded[key]) continue;
      const blob = await this.store.getBlob(key);
      // gone from the device (storage cleared): the fill-up still goes, without that photo
      if (!blob) continue;
      const url = (await call("files:generateUploadUrl", {})) as string;
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
      if (!res.ok) throw new Error("A photo could not be uploaded");
      const { storageId } = (await res.json()) as { storageId: string };
      // anything but an optimised image is deleted by the server and refused (convex/files.ts)
      if ((await call("files:claim", { storageId })) !== "ok") throw new Error("A photo was not accepted: photos must be images of at most 2 MB");
      uploaded[key] = storageId;
      bump("bytesUp", blob.size);
      await this.store.updateOp(op.id, { extra: { ...op.extra, uploaded } });
    }
    return keys.map((k) => uploaded[k]).filter(Boolean);
  }

  private async fail(op: Op, reason: string, error?: unknown) {
    const spec = SPECS[op.fn];
    bump("opsRejected");
    // a new fill-up nobody is waiting on (made offline) is never dropped: it is kept, with its photos, to be fixed
    if (op.fn.startsWith("fillUps:create") && !this.waiters.has(op.id)) await this.store.park(op, reason);
    else await this.store.removeOp(op.id);
    const w = this.waiters.get(op.id);
    if (w) {
      this.waiters.delete(op.id);
      w.reject(error ?? new Error(reason));
    } else {
      // Nobody is waiting (it was queued offline): say so, since the UI showed it as done.
      const label = spec?.label ?? "A change";
      const what = typeof op.args.date === "string" ? `${label} of ${op.args.date}` : label;
      toast.error(`${what} couldn't be synced: ${reason}`, { duration: 8000 });
    }
    this.status = { ...this.status, lastError: reason };
  }
}
