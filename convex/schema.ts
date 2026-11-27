import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export const vehicleKind = v.union(v.literal("bike"), v.literal("scooter"), v.literal("car"), v.literal("other"));
export const fuelType = v.union(v.literal("petrol"), v.literal("diesel"), v.literal("cng"));
export const fillStatus = v.union(v.literal("reading"), v.literal("review"), v.literal("done"));
/** photo: read by AI. device: read on the rider's device. manual: typed. */
export const fillSource = v.union(v.literal("photo"), v.literal("device"), v.literal("manual"));
export const locationSource = v.union(v.literal("device"), v.literal("photo"), v.literal("manual"));
export const readOutcome = v.union(
  v.literal("started"), v.literal("saved"), v.literal("review"), v.literal("unreadable"), v.literal("error"), v.literal("refused"),
);
const counts = v.record(v.string(), v.number());

export default defineSchema({
  ...authTables,

  // Convex Auth owns this table; aiEnabled is ours (admin.setAi). Off for everyone until the superadmin turns it on.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    aiEnabled: v.optional(v.boolean()),
  }).index("email", ["email"]).index("phone", ["phone"]),

  settings: defineTable({
    userId: v.id("users"),
    currency: v.string(),
    efficiencyUnit: v.union(v.literal("km/l"), v.literal("l/100km")),
    theme: v.union(v.literal("system"), v.literal("light"), v.literal("dark")),
    currentVehicleId: v.optional(v.id("vehicles")),
    fullTankDefault: v.boolean(),
    /** The rider's private UnMoney link (a secret: never returned whole) and whether every fill-up is sent. */
    unmoney: v.optional(v.object({ url: v.string(), auto: v.boolean() })),
  }).index("by_userId", ["userId"]),

  vehicles: defineTable({
    userId: v.id("users"),
    name: v.string(),
    kind: vehicleKind,
    fuelType,
    /** Tank size in thousandths of a litre (or kg for CNG). */
    tankMilli: v.optional(v.number()),
    order: v.number(),
    deletedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"]),

  fillUps: defineTable({
    userId: v.id("users"),
    vehicleId: v.id("vehicles"),
    status: fillStatus,
    source: fillSource,
    /** Local calendar day "YYYY-MM-DD" and optional "HH:mm". */
    date: v.string(),
    time: v.optional(v.string()),
    /** Metres. */
    odometerM: v.optional(v.number()),
    /** Thousandths of a litre (kg for CNG). */
    quantityMilli: v.optional(v.number()),
    /** Minor units of `currency`. */
    amountMinor: v.optional(v.number()),
    currency: v.string(),
    fullTank: v.boolean(),
    missedBefore: v.boolean(),
    note: v.optional(v.string()),
    stationId: v.optional(v.id("stations")),
    /** Who set the station: detection only touches an empty or "auto" one. */
    stationSetBy: v.optional(v.union(v.literal("auto"), v.literal("user"))),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    accuracyM: v.optional(v.number()),
    locationSource: v.optional(locationSource),
    photoIds: v.array(v.id("_storage")),
    /** What a read (AI or device) made of the photos: kept so a wrong read can be looked at. */
    read: v.optional(v.object({
      model: v.optional(v.string()),
      kinds: counts,
      printed: v.record(v.string(), v.string()),
      issues: v.array(v.string()),
    })),
    /** The station as the bill names it, for detection (convex/places.ts). */
    billStation: v.optional(v.object({ name: v.optional(v.string()), brand: v.optional(v.string()), address: v.optional(v.string()) })),
    readAttempts: v.optional(v.number()),
    unmoneySentAt: v.optional(v.number()),
    unmoneyError: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_userId_and_vehicleId_and_date", ["userId", "vehicleId", "date"])
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_userId", ["userId"])
    .index("by_stationId", ["stationId"])
    .index("by_deletedAt", ["deletedAt"]),

  stations: defineTable({
    userId: v.id("users"),
    /** Google's place ID: may be kept for good (Places policy). */
    placeId: v.optional(v.string()),
    /** The rider's own GPS fix at the first fill-up here. */
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    billName: v.optional(v.string()),
    billBrand: v.optional(v.string()),
    billAddress: v.optional(v.string()),
    customName: v.optional(v.string()),
    /** A copy of Google's name and address, refetched when older than 30 days (places.refresh). */
    googleName: v.optional(v.string()),
    googleAddress: v.optional(v.string()),
    googleFetchedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_placeId", ["userId", "placeId"]),

  /** Who may read a stored photo. A file with no row here is swept after a day (files.sweepUnclaimed). */
  fileOwners: defineTable({
    storageId: v.id("_storage"),
    userId: v.id("users"),
  }).index("by_storageId", ["storageId"]).index("by_userId", ["userId"]),

  idempotencyKeys: defineTable({
    userId: v.id("users"),
    key: v.string(),
    result: v.any(),
  }).index("by_user_key", ["userId", "key"]),

  // ---- superadmin only (convex/admin.ts, convex/usage.ts): never sent to any other account ----

  /** One row per fill-up read by Claude: counted against the monthly cap before the call, priced after it. */
  aiReads: defineTable({
    userId: v.id("users"),
    fillUpId: v.optional(v.id("fillUps")),
    /** The user's local day. */
    day: v.string(),
    feature: v.literal("read"),
    model: v.string(),
    attempts: v.number(),
    outcome: readOutcome,
    issues: v.array(v.string()),
    /** Names of the fields the rider changed after the read. */
    corrected: v.array(v.string()),
    kinds: counts,
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheWriteTokens: v.number(),
    cacheReadTokens: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
  })
    .index("by_day", ["day"])
    .index("by_userId_and_day", ["userId", "day"])
    .index("by_fillUpId", ["fillUpId"]),

  /** Google Places calls, per user, day and SKU: for the dashboard. */
  placesCalls: defineTable({
    userId: v.id("users"),
    day: v.string(),
    sku: v.string(),
    calls: v.number(),
  }).index("by_day", ["day"]).index("by_userId_and_day", ["userId", "day"]),

  usageDevices: defineTable({
    userId: v.id("users"),
    deviceId: v.string(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    os: v.string(),
    browser: v.string(),
    formFactor: v.union(v.literal("phone"), v.literal("tablet"), v.literal("desktop")),
    standalone: v.boolean(),
    appVersion: v.string(),
    tzOffset: v.number(),
    sessions: v.number(),
  }).index("by_userId_and_deviceId", ["userId", "deviceId"]),

  /** One device's use on one of its local days: sums of what its sessions reported (usage.ping). */
  usageDaily: defineTable({
    userId: v.id("users"),
    deviceId: v.string(),
    day: v.string(),
    opens: v.number(),
    /** Every running total a session reports, summed: activeMs, bytesDown, bytesUp, opsSent, … (convex/lib/admin.ts COUNT_KEYS). */
    totals: counts,
    hours: counts,
    screens: counts,
    lengths: counts,
  }).index("by_day", ["day"]).index("by_userId_and_day", ["userId", "day"]),

  usageSessions: defineTable({
    userId: v.id("users"),
    deviceId: v.string(),
    sessionId: v.string(),
    day: v.string(),
    startedAt: v.number(),
    lastSeenAt: v.number(),
    totals: counts,
    screens: counts,
    appVersion: v.string(),
  }).index("by_sessionId", ["sessionId"]).index("by_userId_and_startedAt", ["userId", "startedAt"]),

  /** What each user keeps, counted weekly or on "Refresh" (admin.refreshStats). Counts only. */
  adminStats: defineTable({
    userId: v.id("users"),
    computedAt: v.number(),
    tables: v.record(v.string(), v.object({ count: v.number(), bytes: v.number() })),
    files: v.object({ count: v.number(), bytes: v.number() }),
    fillUps: counts,
    createdByDay: counts,
    createdByHour: counts,
    firstFillDate: v.optional(v.string()),
    features: v.record(v.string(), v.boolean()),
    prefs: v.record(v.string(), v.string()),
    vehicleKinds: counts,
    fuelTypes: counts,
    signIns: v.number(),
    lastSignInAt: v.optional(v.number()),
  }).index("by_userId", ["userId"]),
});
