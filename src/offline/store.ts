/**
 * In-memory mirror of the offline database, with change notification for
 * React. Holds the last server result of every query, the outbox of pending
 * mutations, and the temp-id → real-id map.
 *
 * Reads go through `getView`, which lays the pending outbox over the server
 * value so the UI shows what the user did even before the server has it.
 */
import { idb } from "./db";
import { queryKey, rewriteIds } from "./ids";
import { applyOp, withMappedIds, type Query } from "./overlay";
import { bump } from "@/lib/counters";
import type { FailedOp, MeInfo, Op, QueryEntry } from "./types";

type Listener = () => void;
type ViewEntry = { base: unknown; opsVersion: number; value: unknown };

/** A cached result nobody has looked at for this long is dropped at launch instead of loaded. */
const KEEP_QUERIES_MS = 30 * 24 * 3600_000;

export class OfflineStore {
  private server = new Map<string, QueryEntry>();
  private ops: Op[] = [];
  private _failed: FailedOp[] = [];
  private _idMap: Record<string, string> = {};
  private ownerId: string | null = null;
  private seq = 0;
  private listeners = new Set<Listener>();
  private views = new Map<string, ViewEntry>();

  /** Bumped when the outbox or the id map changes; views depend on this. */
  opsVersion = 0;
  isHydrated = false;
  readonly hydrated: Promise<void>;

  constructor() {
    this.hydrated = this.hydrate();
  }

  private async hydrate() {
    const [queries, outbox, meta] = await Promise.all([idb.getAll<QueryEntry>("queries"), idb.getAll<Op>("outbox"), idb.getAll<unknown>("meta")]);
    const stale = Date.now() - KEEP_QUERIES_MS;
    for (const q of queries) {
      if (!(q.value && typeof q.value === "object" && "name" in q.value)) continue;
      if (q.value.at < stale) void idb.delete("queries", q.key);
      else this.server.set(q.key, q.value);
    }
    this.ops = outbox.map((o) => o.value).filter((o) => o && typeof o === "object" && "fn" in o).sort((a, b) => a.seq - b.seq);
    for (const op of this.ops) this.seq = Math.max(this.seq, op.seq);
    for (const m of meta) {
      if (m.key === "idMap" && m.value && typeof m.value === "object") this._idMap = m.value as Record<string, string>;
      if (m.key === "ownerId" && typeof m.value === "string") this.ownerId = m.value;
      if (m.key === "failed" && Array.isArray(m.value)) this._failed = m.value as FailedOp[];
    }
    this.isHydrated = true;
    this.opsVersion++;
    this.notify();
  }

  // ---------- subscriptions ----------

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private notify() {
    for (const l of this.listeners) l();
  }

  // ---------- server values ----------

  setServerValue(name: string, args: Record<string, unknown>, value: unknown) {
    const key = queryKey(name, args);
    const prev = this.server.get(key);
    if (prev && prev.value === value) return;
    const entry: QueryEntry = { name, args, value, at: Date.now() };
    this.server.set(key, entry);
    bump("bytesDown", JSON.stringify(value ?? null).length);
    // the superadmin's dashboard is never kept on the device: it is other people's usage, and large
    if (!name.startsWith("admin:")) void idb.put("queries", key, entry);
    if (name === "users:me" && value && typeof value === "object" && "id" in value) void this.setOwner((value as { id: string }).id);
    this.notify();
  }

  getServerValue(name: string, args: Record<string, unknown>): unknown {
    return this.server.get(queryKey(name, args))?.value;
  }

  /** The signed-in user, from the cached `users.me`. */
  me(): MeInfo | null {
    const v = this.getServerValue("users:me", {}) as { id: string; ai: boolean } | null | undefined;
    return v ? { id: v.id, ai: v.ai } : null;
  }

  /** The cache belongs to one account. A different account signing in on this browser starts clean. */
  async setOwner(userId: string) {
    if (this.ownerId === userId) return;
    if (this.ownerId !== null) {
      await this.wipe({ keepMe: true });
    }
    this.ownerId = userId;
    await idb.put("meta", "ownerId", userId);
  }

  // ---------- views ----------

  /** Server value with the outbox applied on top. Stable identity while nothing relevant changes. */
  getView(name: string, args: Record<string, unknown>, live: unknown): unknown {
    const key = queryKey(name, args);
    const base = live !== undefined ? live : this.server.get(key)?.value;
    const cached = this.views.get(key);
    if (cached && cached.base === base && cached.opsVersion === this.opsVersion) return cached.value;
    const value = this.ops.length === 0 ? base : this.compute({ name, args }, base);
    this.views.set(key, { base, opsVersion: this.opsVersion, value });
    return value;
  }

  private compute(q: Query, base: unknown): unknown {
    let v = base;
    for (const op of this.ops) {
      try {
        v = applyOp(withMappedIds(op, this._idMap), q, v);
      } catch (e) {
        if (import.meta.env.DEV) console.warn("offline overlay failed", op.fn, e);
      }
    }
    return v;
  }

  /** Read a query through the overlay without subscribing (used when preparing a mutation). */
  readView(name: string, args: Record<string, unknown>): unknown {
    return this.getView(name, rewriteIds(args, this._idMap), undefined);
  }

  entries(): Iterable<QueryEntry> {
    return this.server.values();
  }

  // ---------- outbox ----------

  get outbox(): readonly Op[] {
    return this.ops;
  }

  /** Ops queued by any tab of this browser, from the database itself. */
  async pendingOnDisk(): Promise<number> {
    return Math.max(this.ops.length, (await idb.getAll("outbox")).length);
  }

  nextSeq(): number {
    return ++this.seq;
  }

  /**
   * Durable first, visible second: once the UI shows a change it has already been written to disk.
   * Resolves false when the write did not reach the database (none, full, or hung): the op then lives in memory only.
   */
  async enqueue(op: Op): Promise<boolean> {
    const saved = (await idb.put("outbox", op.id, op)) !== undefined;
    this.ops = [...this.ops, op];
    this.opsVersion++;
    this.notify();
    return saved;
  }

  /** A photo kept on the device until the fill-up it belongs to has reached the server. */
  async putBlob(key: string, blob: Blob): Promise<boolean> {
    return (await idb.put("blobs", key, blob)) !== undefined;
  }
  getBlob(key: string): Promise<Blob | undefined> {
    return idb.get<Blob>("blobs", key);
  }
  async deleteBlobs(keys: string[]) {
    await Promise.all(keys.map((k) => idb.delete("blobs", k)));
  }

  async updateOp(id: string, patch: Partial<Op>) {
    const i = this.ops.findIndex((o) => o.id === id);
    if (i < 0) return;
    const next = { ...this.ops[i], ...patch };
    this.ops = this.ops.map((o, j) => (j === i ? next : o));
    await idb.put("outbox", id, next);
  }

  async removeOp(id: string) {
    if (!this.ops.some((o) => o.id === id)) return;
    this.ops = this.ops.filter((o) => o.id !== id);
    this.opsVersion++;
    this.notify();
    await idb.delete("outbox", id);
  }

  // ---------- fill-ups the server refused ----------

  get failed(): readonly FailedOp[] {
    return this._failed;
  }

  /** Take a refused op out of the outbox but keep it, and its photos, for the rider to fix. */
  async park(op: Op, reason: string) {
    this._failed = [...this._failed, { op, reason, at: Date.now() }];
    this.ops = this.ops.filter((o) => o.id !== op.id);
    this.opsVersion++;
    this.notify();
    await Promise.all([idb.put("meta", "failed", this._failed), idb.delete("outbox", op.id)]);
  }

  /** The rider fixed it (a new op now carries the photos) or threw it away (`dropPhotos`). */
  async unpark(opId: string, dropPhotos: boolean) {
    const hit = this._failed.find((f) => f.op.id === opId);
    if (!hit) return;
    this._failed = this._failed.filter((f) => f.op.id !== opId);
    this.opsVersion++;
    this.notify();
    await idb.put("meta", "failed", this._failed);
    if (dropPhotos) await this.deleteBlobs((hit.op.extra?.blobKeys as string[] | undefined) ?? []);
  }

  // ---------- id map ----------

  get idMap(): Record<string, string> {
    return this._idMap;
  }

  /**
   * The server took an op: map its temp ids to the real ones and drop it in one step, so no
   * render shows the server's row next to the optimistic one, or a temp id still unmapped.
   */
  async complete(id: string, pairs: [string, string][]) {
    const next = { ...this._idMap };
    for (const [tmp, real] of pairs) if (tmp && real && tmp !== real) next[tmp] = real;
    this._idMap = next;
    this.ops = this.ops.filter((o) => o.id !== id);
    this.opsVersion++;
    this.notify();
    await Promise.all([idb.put("meta", "idMap", next), idb.delete("outbox", id)]);
  }

  // ---------- lifecycle ----------

  /** Forget everything (sign-out, or another account). */
  async wipe(opts: { keepMe?: boolean } = {}) {
    const me = opts.keepMe ? this.server.get(queryKey("users:me", {})) : undefined;
    this.server.clear();
    if (me) this.server.set(queryKey("users:me", {}), me);
    this.ops = [];
    this._failed = [];
    this._idMap = {};
    this.ownerId = null;
    this.views.clear();
    this.opsVersion++;
    this.notify();
    await Promise.all([idb.clear("queries"), idb.clear("outbox"), idb.clear("meta"), idb.clear("blobs")]);
    if (me) await idb.put("queries", queryKey("users:me", {}), me);
  }
}
