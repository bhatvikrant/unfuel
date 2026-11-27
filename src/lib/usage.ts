/**
 * Usage counts for the superadmin dashboard (convex/lib/admin.ts, convex/usage.ts): how often the
 * app is opened, for how long, on what, which screens, and roughly how much it downloads and
 * uploads. Only counts and sizes, never what is in the log. Each session's running totals
 * (src/lib/counters.ts) are sent now and then; the server adds what grew, so a lost or repeated
 * send costs nothing. (UnMoney's scheme.)
 */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { api } from "@convex/_generated/api";
import { screenKey } from "@convex/lib/admin";
import { useConvex } from "./convex";
import { counters, resetCounters } from "./counters";
import { device } from "./device";

const DEVICE_KEY = "unfuel:deviceId";
/** Back after this long away: a new session, as if opened again. */
const NEW_SESSION_AFTER_MS = 30 * 60_000;
/** Each ping is a mutation with three writes; leaving the app sends one anyway, so this only bounds what a crash loses. */
const PING_EVERY_MS = 5 * 60_000;

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

type Session = { id: string; startedAt: number; day: string; hour: number; activeMs: number; visibleSince: number | null; screens: Record<string, number> };

function newSession(): Session {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  resetCounters();
  return { id: uuid(), startedAt: now.getTime(), day, hour: now.getHours(), activeMs: 0, visibleSince: document.visibilityState === "visible" ? now.getTime() : null, screens: {} };
}

let session: Session | null = null;
let hiddenAt: number | null = null;
const current = () => (session ??= newSession());

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) localStorage.setItem(DEVICE_KEY, (id = uuid()));
    return id;
  } catch {
    return "unknown";
  }
}

/** Counts this signed-in session and reports it while the app is open. Rendered once, inside the signed-in app. */
export function useUsage() {
  const convex = useConvex();
  const { pathname } = useLocation();
  const sending = useRef(false);

  useEffect(() => {
    const s = current();
    const key = screenKey(pathname);
    s.screens[key] = (s.screens[key] ?? 0) + 1;
  }, [pathname]);

  useEffect(() => {
    const send = () => {
      if (sending.current || !navigator.onLine) return;
      const s = current();
      const now = Date.now();
      const activeMs = s.activeMs + (s.visibleSince ? now - s.visibleSince : 0);
      sending.current = true;
      convex.mutation(api.usage.ping, {
        sessionId: s.id, deviceId: deviceId(), day: s.day, hour: s.hour, startedAt: s.startedAt,
        tzOffset: -new Date().getTimezoneOffset(), appVersion: import.meta.env.VITE_APP_VERSION ?? "dev", ...device(),
        totals: { ...counters(), activeMs },
        screens: { ...s.screens },
      }).catch(() => { /* counts only: the next ping carries the same totals */ }).finally(() => { sending.current = false; });
    };
    const onVisibility = () => {
      const now = Date.now();
      const s = current();
      if (document.visibilityState === "hidden") {
        if (s.visibleSince) s.activeMs += now - s.visibleSince;
        s.visibleSince = null;
        hiddenAt = now;
        send();
      } else {
        if (hiddenAt && now - hiddenAt > NEW_SESSION_AFTER_MS) session = newSession();
        else s.visibleSince = now;
        hiddenAt = null;
        send();
      }
    };
    const first = setTimeout(send, 3000);
    const timer = setInterval(() => { if (document.visibilityState === "visible") send(); }, PING_EVERY_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [convex]);
}
