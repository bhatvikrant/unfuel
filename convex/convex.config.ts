import { defineApp } from "convex/server";
import { v } from "convex/values";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

const app = defineApp({
  env: {
    // "1" on a local deployment turns on the e2e suite's email + password sign-in (convex/auth.ts).
    E2E_AUTH: v.optional(v.string()),
    // Photo reading (convex/ai.ts). Without the key every fill-up is typed or read on the device.
    ANTHROPIC_API_KEY: v.optional(v.string()),
    ANTHROPIC_MODEL: v.optional(v.string()),
    // Station search (convex/places.ts): a key with Places API (New) enabled.
    GOOGLE_MAPS_API_KEY: v.optional(v.string()),
    // Hosts an UnMoney link may point at, comma separated (convex/unmoney.ts).
    UNMONEY_HOSTS: v.optional(v.string()),
  },
});
app.use(rateLimiter);

export default app;
