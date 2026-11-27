/**
 * Where the rider is, for remembering which station a fill-up was at. Asked for in context (when
 * photos are added), optional, and it works offline: the fix comes from the phone, not the network.
 */
export type Fix = { lat: number; lng: number; accuracyM: number };

/** The current position, or null when it is refused, unavailable or slow. Never throws, never hangs. */
export function currentPosition(timeoutMs = 8000): Promise<Fix | null> {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    // some browsers never call back when the prompt is dismissed: do not wait on them
    const timer = setTimeout(() => resolve(null), timeoutMs + 1000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(timer); resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }); },
      () => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/** Whether the browser has already said yes: when it has not, the app says why it asks before it asks. */
export async function locationGranted(): Promise<boolean> {
  try {
    return (await navigator.permissions.query({ name: "geolocation" })).state === "granted";
  } catch {
    return false;
  }
}
