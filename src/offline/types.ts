/** A mutation waiting in the outbox. Durable: survives reloads until the server has taken it. */
export type Op = {
  id: string;
  seq: number;
  /** Convex function name, e.g. "fillUps:createManual". */
  fn: string;
  args: Record<string, unknown>;
  /** The temp id handed to the UI for the thing this op creates, if any. */
  tempId?: string;
  /** Anything the overlay needs that isn't in the args (previous state, generated ids). */
  extra?: Record<string, unknown>;
  me: MeInfo;
  createdAt: number;
  attempts: number;
};

/** The signed-in user as `users.me` gives it: `ai` decides who reads a photo (convex/users.ts). */
export type MeInfo = { id: string; ai: boolean };

/** A new fill-up the server refused (say, its odometer clashes with one added on another device): kept, with its photos, until the rider fixes or discards it. */
export type FailedOp = { op: Op; reason: string; at: number };

/** One cached query result. */
export type QueryEntry = { name: string; args: Record<string, unknown>; value: unknown; at: number };

export type SyncStatus = {
  /** navigator.onLine */
  online: boolean;
  /** The Convex WebSocket is open. */
  connected: boolean;
  /** What the UI should call "offline": no network, or the socket has been down for longer than a brief grace period. */
  offline: boolean;
  syncing: boolean;
  pending: number;
  lastError: string | null;
};

export class OfflineError extends Error {
  constructor(message = "You're offline. This needs a connection; try again once you're back online.") {
    super(message);
    this.name = "OfflineError";
  }
}
