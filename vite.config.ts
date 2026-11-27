import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * What the More page shows as the version: when this build was made, in Indian time, as
 * YYYY.MM.DD-HH:MM. Each deploy builds once, so it is when that deploy went out. Same scheme as UnMoney and UnSplit.
 */
function appVersion(at = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}.${p.month}.${p.day}-${p.hour}:${p.minute}`;
}

const icon192 = { src: "/icon-192.png", sizes: "192x192", type: "image/png" };

export default defineConfig({
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion()) },
  plugins: [
    react(),
    tailwindcss(),
    // Installable app: the manifest makes phones offer "Add to Home Screen",
    // the service worker precaches the shell so it opens with no network.
    // Data comes from the offline cache in src/offline; the Convex socket is
    // a different origin and is never intercepted.
    VitePWA({
      // A new build waits until the user taps "Update" in the toast
      // (src/main.tsx) instead of reloading under them mid-edit.
      registerType: "prompt",
      includeAssets: ["*.svg", "*.png"],
      manifest: {
        id: "/",
        name: "Unfuel",
        short_name: "Unfuel",
        description: "Know what your vehicle really costs to run: mileage and cost per km from two photos.",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        start_url: "/",
        scope: "/",
        // A link into our scope from elsewhere lands in the app window that is already open, not a
        // second one, where the browser captures links into installed apps.
        launch_handler: { client_mode: "navigate-existing" },
        lang: "en",
        categories: ["utilities", "finance", "productivity"],
        icons: [
          icon192,
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          // Android crops these into its own shape; the mark sits in the safe zone.
          { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // Long-press on the Android icon.
        shortcuts: [
          { name: "Add fill-up", url: "/add", icons: [icon192] },
          { name: "Stats", url: "/stats", icons: [icon192] },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // The superadmin dashboard (src/pages/admin, lazy in App.tsx) is fetched when it is opened, never
        // precached onto every device. Nor is the on-device reader (src/lib/ocr.ts): it is fetched the first
        // time a photo is read here, and needs its engine from the network that first time anyway.
        globIgnores: ["**/AdminPage-*.js", "**/ocr-*.js"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // Fill-up photos served by Convex file storage.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/storage/"),
            handler: "CacheFirst",
            options: { cacheName: "convex-files", expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 3600 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        // Rolldown gives a module that two chunks import (the entry and a lazy dialog, say) a common
        // chunk of its own, which breaks the app shell into dozens of small files. Everything the
        // entry imports statically stays in one chunk; the lazy chunks keep only what it does not.
        codeSplitting: { groups: [{ name: "app", tags: ["$initial"] }] },
        // named so the service worker can leave them out of its precache (globIgnores above)
        chunkFileNames: (chunk) => (chunk.moduleIds.some((id) => /[\\/]src[\\/]lib[\\/]ocr\.ts$/.test(id)) ? "assets/ocr-[hash].js" : chunk.moduleIds.some((id) => /[\\/]pages[\\/]admin[\\/]AdminPage\.tsx$/.test(id)) ? "assets/AdminPage-[hash].js" : "assets/[name]-[hash].js"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@convex": path.resolve(import.meta.dirname, "./convex"),
    },
  },
});
