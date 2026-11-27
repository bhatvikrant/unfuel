/** Light, dark or the system's: a class on <html> (index.html sets it before first paint; the tokens are in index.css). */
export type Theme = "system" | "light" | "dark";

const KEY = "unfuel:theme";
const scheme = window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(theme: Theme): void {
  // kept on the device so the next launch paints in the right theme before any data has loaded
  try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  const dark = theme === "dark" || (theme === "system" && scheme.matches);
  document.documentElement.classList.toggle("dark", dark);
  const paper = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
  if (paper) document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#0a0a0a" : "#ffffff"));
}

export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/** Follow the system while the setting says so. */
scheme.addEventListener("change", () => applyTheme(storedTheme()));
