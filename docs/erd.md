# Unfuel: engineering requirements

Status: built, first version · 2026-11-27. Section 23 lists what differs from the sections above.
Companion: [prd.md](prd.md) (product requirements)
Sources: `../unmoney` and `../unsplit` as they stand today (package.json, README, `replica/architecture.md`, `convex/`, `src/`).

## 1. Stack

Same as UnMoney and UnSplit. Versions are the ones both apps pin today.

| Layer | Choice | Same as |
| --- | --- | --- |
| Web app | Vite 8 + React 19 + TypeScript 6, React Router 8, plain SPA | both |
| Styling | Tailwind 4 (`@tailwindcss/vite`), shadcn/ui on Radix (`radix-ui`), `class-variance-authority`, `tw-animate-css` | both |
| Font, icons | Geist Variable (`@fontsource-variable/geist`), `lucide-react` | both |
| Motion, sheets, toasts | `framer-motion`, `vaul`, `sonner` | both |
| Charts | Recharts 3 | both |
| Dates | `date-fns` 4 | both |
| Backend | Convex: tables, queries, mutations, actions, scheduler, file storage | both |
| Auth | Convex Auth (`@convex-dev/auth`, `@auth/core`), Google only | both |
| AI | `@anthropic-ai/sdk`, called from a Convex action | UnMoney |
| Reading without AI | `tesseract.js` 7 (WebAssembly), on the device, loaded on first use | UnMoney |
| Fuel stations | Google Places API (New), REST from Convex actions; no SDK | new: neither app has it |
| AI access, cap, cost | `users.aiEnabled`, a monthly claim, a priced log of every call | UnMoney |
| Usage counts, superadmin | Session pings, weekly storage count, `/admin` page | UnMoney |
| Upload limit | `@convex-dev/rate-limiter` component | UnSplit |
| PWA | `vite-plugin-pwa` (Workbox), manifest in `vite.config.ts` | both |
| Offline | IndexedDB cache + outbox under `src/offline/` | UnSplit |
| Lint, tests | `oxlint`; Vitest; `convex-test`; Playwright | both; both; UnMoney; UnSplit |
| Package manager | bun (`bun.lock`, `bunx`), also on Vercel and in CI | neither: both use npm. Asked for on 2026-11-27 |
| Hosting | Vercel (static `dist/`) + Convex Cloud; GitHub Actions CI | both |

One database. No server of our own. No new npm dependency that neither app already has. One new outside service: Google Places, for stations (section 9).

### Where the two apps differ, and which one Unfuel follows

| Topic | UnMoney | UnSplit | Unfuel |
| --- | --- | --- | --- |
| Offline | Full local replica, shared op reducer (`shared/ops.ts`, `src/lib/store.tsx`, `convex/sync.ts`, about 4,400 lines) | Query cache + outbox + overlay (`src/offline/`, about 1,900 lines) | **UnSplit** (your choice), plus a photo queue it does not have |
| Shared pure code | `shared/` | `convex/lib/`, imported by the client through the `@convex` alias | **UnSplit**, since the offline code expects it |
| Claude call | SDK, structured output, pure request and validation module, monthly cap, cost log | Raw `fetch`, JSON parsed from text | **UnMoney's pattern** (`shared/receiptAi.ts`): it is the newer and stricter of the two |
| AI model | `claude-haiku-5-5` | `claude-sonnet-5-5` | See section 7.4 |
| AI access and cap | `users.aiEnabled` set by the superadmin, `usage.claimAi` monthly cap, cost recorded per call | Open to every signed-in user, rate-limiter per hour | **UnMoney**: the dashboard and the off-by-default rule need it |
| Other limits | none | Rate-limiter component | **UnSplit**, for uploads only |
| Reading a photo without AI | Tesseract on the device, amount only (`src/lib/ocr.ts`, `receiptAmount.ts`, `receiptImage.ts`, about 400 lines) | none | **UnMoney's**, extended to litres, rate, date, station name and odometer (section 21) |
| Theme | shadcn `radix-nova`, neutral, monochrome | Same tokens (its `tokens.json` says it shares UnMoney's theme) | **UnMoney's** `src/index.css` and `components.json` |
| Security headers | Full Content-Security-Policy | No CSP | **UnMoney** |
| e2e sign-in | none | Password provider on local deployments only (`E2E_AUTH`) | **UnSplit** |
| Superadmin dashboard | `/admin`, own usage tables (`shared/admin.ts`, `convex/usage.ts`, `convex/admin.ts`, `src/pages/admin/`, about 2,400 lines) | none | **UnMoney's**, adapted (section 20) |
| Product analytics | PostHog | none | None: the dashboard covers it |

Unfuel starts as a copy of UnSplit's skeleton (config, scripts, auth, offline, PWA, CI) with UnMoney's theme, AI pattern, CSP and superadmin dashboard.

## 2. Repo layout

```
convex/            schema, auth, functions, the AI action, usage.ts, admin.ts, crons.ts
convex/lib/        pure modules shared with the client: mileage, fuelRead, stations, money, units, admin, aiCost
src/               pages/ (pages/admin/ is the superadmin dashboard), components/, lib/, offline/
tests/e2e/         Playwright
scripts/           auth keys, deploy, preview env, icons (copied from UnSplit)
docs/              prd.md, erd.md
```

## 3. Conventions

- **Money**: integer minor units plus an ISO currency code (`amountMinor: 100000` is ₹1,000.00). As in both apps.
- **Fuel quantity**: integer thousandths (`quantityMilli: 9430` is 9.43 L, or kg for CNG). Sums never touch floats.
- **Odometer**: integer metres (`odometerM`). Whole kilometres are what people type; metres leave room for tenths and for miles later.
- **Price per litre** is not stored. It is `amountMinor / quantityMilli`. The printed rate is used once, to check the read.
- **Dates**: local calendar date `"YYYY-MM-DD"` plus optional `"HH:mm"`, as in UnMoney. A fill-up on the 12th is on the 12th everywhere.
- **Derived values are never stored**: mileage, cost per km, averages, insights and station figures are computed from the fill-ups by pure functions. A rider with ten years of weekly fill-ups has about 500 rows per vehicle.
- **Soft delete** (`deletedAt`) on fill-ups, vehicles and stations, so Undo and restore are cheap.
- **Every function** starts with `requireUser(ctx)` and scopes by `userId`. There are no public reads.

## 4. Schema (`convex/schema.ts`)

```ts
users            // Convex Auth authTables: name?, email?, image?, plus
                 aiEnabled?                     // set by admin.setAi
settings         userId, currency, efficiencyUnit ("km/l" | "l/100km"), theme ("system"|"light"|"dark"),
                 currentVehicleId?, fullTankDefault (bool), locationAsked (bool), unmoney?: { url, auto }
                 index by_user
vehicles         userId, name, kind ("bike"|"scooter"|"car"|"other"), fuelType ("petrol"|"diesel"|"cng"),
                 tankMilli?, order, deletedAt?
                 index by_user
fillUps          userId, vehicleId, status ("reading" | "review" | "done"),
                 source ("photo" = read by AI | "device" = read on the device | "manual"),
                 date, time?, odometerM?, quantityMilli?, amountMinor?, currency,
                 fullTank, missedBefore, note?,
                 stationId?, stationSetBy? ("auto" | "user"),
                 lat?, lng?, accuracyM?, locationSource? ("device" | "photo" | "manual"),
                 photoIds: Id<"_storage">[]  (at most 4),
                 read?: { model, kinds[], printed: {amount?, quantity?, unitPrice?, date?, odometer?, station?}, issues[] },
                 readAttempts, unmoneySentAt?, unmoneyError?, deletedAt?
                 index by_user_vehicle_date (userId, vehicleId, date), by_user_status (userId, status), by_station
stations         userId, placeId?, lat?, lng?,
                 billName?, billBrand?, billAddress?, customName?,
                 googleName?, googleAddress?, googleFetchedAt?,     // a cache, see section 9.5
                 deletedAt?
                 index by_user, by_user_place (userId, placeId)
placesCalls      userId, day, sku, calls                            // for limits and the dashboard
                 index by_day, by_user_day
fileOwners       storageId, userId           // who may read a photo; UnMoney added this after the fact
                 index by_storage
idempotencyKeys  userId, key, result         // UnSplit's convex/lib/idempotency.ts
                 index by_user_key

// Superadmin only (section 20). Server-side, never sent to any other account.
aiReads          userId, fillUpId?, day, feature ("read"), model, attempts,
                 outcome ("started" | "saved" | "review" | "unreadable" | "error" | "refused"),
                 issues[], corrected[], kinds { bill, pump, odometer, other },
                 inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, costUsd, latencyMs
                 index by_day, by_user_day (userId, day), by_fillUp
usageDevices     userId, deviceId, firstSeenAt, lastSeenAt, os, browser, formFactor, standalone,
                 appVersion, tzOffset, sessions                       // as UnMoney
                 index by_user_device
usageDaily       userId, deviceId, day, opens, activeMs, bytesDown, bytesUp, photoFetches,
                 opsSent, opsQueuedOffline, opsRejected, queueWaitMs,
                 deviceReads, deviceFieldsFound, deviceFieldsKept, photoBytesBefore, photoBytesAfter,
                 hours{}, screens{}, lengths{}                        // UnMoney's, plus the offline and device-read counts
                 index by_day, by_user_day
usageSessions    userId, deviceId, sessionId, day, startedAt, lastSeenAt, the same running totals,
                 screens{}, appVersion                                // kept 120 days
                 index by_session, by_user_started
adminStats       userId, computedAt, tables{count, bytes}, files{count, bytes},
                 fillUps { photo, device, manual, corrected, review, withPhotos, withLocation, fullTank, withNote, handedOff },
                 createdByDay{}, createdByHour{}, firstFillDate?, features{}, prefs{},
                 vehicleKinds{}, fuelTypes{}, stations, signIns, lastSignInAt?
                 index by_user
```

`aiReads` holds one row per fill-up read, not per HTTP call: a retry adds its tokens and cost to the same row. It replaces UnMoney's `aiDaily` (a daily sum per feature), because the dashboard needs outcomes and corrections per read; the daily sums are built from it in the overview query.

Rules enforced in mutations: a `done` fill-up has a date, a quantity above zero and an amount above zero; the odometer is optional; an odometer must be above the previous fill-up's and below the next one's for that vehicle; at most 4 photos, each owned by the caller; a `reading` or `review` fill-up is left out of every figure.

## 5. Functions

| Function | Kind | Does |
| --- | --- | --- |
| `users.me` | q | current user, with `ai` (may use photo reading) and `superadmin` |
| `settings.get` / `update` | q / m | creates defaults on first read |
| `vehicles.list` / `create` / `update` / `archive` / `restore` | q / m | |
| `fillUps.list` | q | every live fill-up of one vehicle, newest first |
| `fillUps.pending` | q | fill-ups in `reading` or `review` across vehicles |
| `fillUps.get` | q | one fill-up with photo URLs |
| `fillUps.createFromPhotos` | m | inserts as `reading`, schedules the read; idempotent by `clientKey` |
| `fillUps.createManual` | m | inserts as `done`, with optional photos and `source` `manual` or `device`; idempotent by `clientKey` |
| `fillUps.update` | m | edits any field; completes a `review` |
| `fillUps.remove` / `restore` | m | soft delete |
| `fillUps.retryRead` | m | reschedules the read |
| `fillUps.sendToUnmoney` | m | the Send to UnMoney button; schedules `unmoney.send` |
| `unmoney.send` | internal action | post a fill-up to the rider's UnMoney link (section 10) |
| `settings.setUnmoney` | m | save or clear the link and the automatic switch |
| `ai.readFillUp` | internal action | the Claude call (section 7) |
| `fillUps.readContext` / `applyRead` | internal q / m | what the action needs, and what it writes |
| `stations.list` / `rename` / `merge` / `remove` | q / m | `rename` sets `customName` |
| `stations.choose` / `chooseCustom` / `clear` | action / m / m | set a fill-up's station from the drop-down (section 9.4) |
| `places.nearby` / `search` | action | Google Nearby Search and Autocomplete for the drop-down |
| `places.detect` | internal action | pick the station for a saved fill-up (section 9.3) |
| `places.refresh` | action | refetch a stale Google name (section 9.5) |
| `files.generateUploadUrl` / `claim` / `url` | m / m / q | upload; check type and size, then record the owner (section 22.3); read only by the owner |
| `files.sweepUnclaimed` | internal m | daily cron: delete stored files older than a day that nobody claimed |
| `exports.csv` | q | flat rows for one vehicle or all |
| `account.remove` | m | deletes every row and file of the caller, usage and AI rows included |
| `usage.ping` | m | a session's running totals; adds only what grew (UnMoney's) |
| `usage.claimAi` / `recordAi` | internal m | count a read against the monthly cap before the call; store its tokens, cost and outcome after |
| `usage.pruneSessions` | internal m | daily cron: drop sessions older than 120 days |
| `admin.overview` | q | users, devices, daily usage, storage counts and AI reads for a date range; superadmin only |
| `admin.userSessions` | q | one user's latest sessions; superadmin only |
| `admin.setAi` | m | turn photo reading on or off for a list of users; superadmin only |
| `admin.refresh` | m | recount storage now; superadmin only |
| `admin.refreshStats` / `refreshUser` / `countPage` / `saveStats` | internal | weekly cron: count each user's documents and files |

There are no stats queries. Home, Stats and Stations compute everything on the client from `fillUps.list` and `stations.list` using `convex/lib/mileage.ts`. That is what lets them work offline from the cache.

## 6. Mileage engine (`convex/lib/mileage.ts`, pure)

Input: one vehicle's `done` fill-ups in date order. An **anchor** is a fill-up with an odometer.

- **Stretch**: two consecutive anchors `a` then `b`. Distance is `b.odometerM - a.odometerM`.
- **Exact stretch**: `a` and `b` are both full-tank anchors, with any number of fill-ups between, and no `missedBefore` on any fill-up after `a` up to `b`. Fuel is the sum of quantity over fill-ups after `a`, up to and including `b`.
- **Estimated stretch**: any other pair of consecutive anchors with no `missedBefore` on `b`. Fuel is the sum of quantity over fill-ups from `a` (included) up to `b` (excluded).
- **Headline**: sum of distance over the last five stretches divided by the sum of their fuel; marked exact only when all five are.
- **Overall**: last anchor minus first anchor, over the fuel of every fill-up from the first anchor (included) to the last (excluded).
- **Cost per km**: the amounts of the same fill-ups over the same distance.
- **Dip**: average of the last three stretches against the average of up to ten before them, at least five; flagged at a 10% drop, cleared when back within 5%.

Output per fill-up: `{ distanceM, fuelMilli, costMinor, kmPerLitre, exact }` or nothing, plus the headline, overall, monthly totals and the dip state. Unit tests cover: full-only, amount-only, mixed, a fill-up with no odometer, a missed fill-up, a single fill-up, edits that reorder dates.

## 7. Reading photos with Claude

### 7.1 On the device

- `<input type="file" accept="image/*" multiple>`, and a second one with `capture="environment"` for the camera. No `getUserMedia`, so no camera permission of our own.
- Each photo is optimised before it is uploaded or queued: section 22. Only the optimised copy is uploaded, queued offline or stored.
- The capture time is the file's `lastModified`; the location is read at the same moment (section 9).

### 7.2 On the server

1. An account without AI access does not reach this path: its photos are read on the device and saved through `fillUps.createManual` (section 21). `fillUps.createFromPhotos` checks the photos belong to the caller and that the caller has AI access; without it (a stale client) the fill-up is inserted as `review` with `aiOff` and the photos attached, and nothing is scheduled. Otherwise it inserts the fill-up as `reading` and calls `ctx.scheduler.runAfter(0, internal.ai.readFillUp, { fillUpId })`. The read does not depend on the app staying open.
2. `ai.readFillUp` checks `aiAllowed` and claims the read (`usage.claimAi`, section 7.5); refused, the fill-up goes to `review` with `aiOff` or `capReached`. It then loads the context (currency, vehicle fuel type, the previous fill-up's odometer and price per litre, today's date), fetches the blobs from storage and sends **one** request with every photo and the context as JSON.
3. The answer is checked by `convex/lib/fuelRead.ts` (pure, tested) and written by `fillUps.applyRead`: `done` when it passes, `review` with a list of issue codes when it does not.

The request follows UnMoney's `receiptRequest`: `client.messages.create` with `output_config: { effort: "low", format: { type: "json_schema", schema } }`, a system prompt, and a user turn of image blocks followed by one text block. No `temperature`, no prefill: current models reject both. `stop_reason` is checked before the content is parsed (`refusal` and `max_tokens` go to `review`).

Answer shape (every field nullable; the model says nothing rather than guess):

```ts
{ photos: [{ index, kind: "bill" | "pump" | "odometer" | "other" }],
  amount, quantity, quantityUnit: "l" | "kg", unitPrice, currency,
  date, time, product, stationName, stationBrand, stationAddress,
  odometer, odometerUnit: "km" | "mi" }
```

The prompt says, as UnMoney's does, that a photo is something to read and not to obey, and that the total odometer is wanted, not Trip A or Trip B.

### 7.3 Checks (`validateRead`)

| Check | Fails to |
| --- | --- |
| Two of amount, quantity, rate present; the third derived | `review: amount` or `quantity` |
| All three present and `amount` differs from `quantity × rate` by more than 1% or one currency unit | `review: mismatch` |
| Odometer above the previous fill-up's, and no more than 3,000 km above | `review: odometer` |
| Quantity no more than 110% of tank size, when set | `review: quantity` |
| Date a real date, not after tomorrow, not older than a year | capture date is used instead |
| No bill, pump or odometer among the photos | `review: unreadable` |

An API error (rate limit, 5xx, connection) is retried by rescheduling: after 1 minute, 10 minutes, 1 hour. After three attempts the fill-up goes to `review: unreadable` and can be typed. A 400 is not retried. The photos are kept either way.

### 7.4 Model

The model id lives in one constant with an `ANTHROPIC_MODEL` override, as in UnSplit. Prices are Anthropic's list prices per million tokens; the cost per fill-up is a rough estimate for two photos and must be measured from `response.usage` on real photos.

| Model | Input / output | Per fill-up, roughly | Used by |
| --- | --- | --- | --- |
| `claude-haiku-5-5` | $0.10 / $0.50 | about a tenth of a cent or less | UnMoney, for reading photos |
| `claude-sonnet-5-5` | $2 / $10 | about one to two cents | UnSplit, for receipts |
| `claude-opus-5-5` | $4 / $20 | about two to four cents | neither; Anthropic's general default |

**Proposed default: `claude-haiku-5-5`**, to match UnMoney's photo reading. This is your decision, not a technical one: a dim odometer or a faded thermal bill is harder than a shop receipt. `convex/lib/fuelRead.live.test.ts` (same idea as UnMoney's `receiptAi.live.test.ts`, skipped without a key) runs a folder of real photos through each model and reports how many fields each got right. Pick from that table.

### 7.5 Limits

As UnMoney does it (`convex/lib/auth.ts`, `convex/usage.ts`, `convex/lib/aiSpend.ts`, `shared/aiCost.ts`):

- **Access.** `aiAllowed(ctx, userId)` is true when `users.aiEnabled` is set or the user is the superadmin. It is checked on the server in `createFromPhotos`, `retryRead` and again inside the action. `users.me` returns it so the client shows the typing form instead of the photo flow; the server check is the one that counts.
- **Cap.** `usage.claimAi` runs in its own transaction before the call: it counts the user's `aiReads` rows this month (their local month) and, under 60, inserts the row as `started`. Two reads started at the same moment cannot both slip past.
- **Cost.** After each answer, `usage.recordAi` adds the tokens from `response.usage` and the cost from `convex/lib/aiCost.ts` (`PRICES` per model, `costOf`) to the row, with the outcome, issue codes, photo kinds and latency. The cost is stored in dollars at the price of the day, so a later price change does not rewrite the past. A test fails when the model in use has no price.
- **Corrections.** `fillUps.update` on a photo fill-up compares each changed field with what the read wrote and adds its name to `aiReads.corrected`.
- **Uploads.** The rate limiter caps uploads at 60 per hour per user. It is the only use of that component.

A rider without access, or over the cap, can still add fill-ups by hand and attach photos.

## 8. Offline and sync

Ported from `unsplit/src/offline/`:

- **Cache**: the last server result of every query the UI has shown, in IndexedDB. `useQuery` from `@/lib/convex` answers from it when the live subscription has nothing.
- **Outbox**: every write goes through `useMutation` from `@/lib/convex` into a durable queue. Offline it returns at once with a temporary id.
- **Overlay** (`overlay.ts`): lays queued writes over cached results, so a new fill-up shows in History, Home and Stats before it has synced. Unfuel's overlay covers fill-up create, update, remove and restore; vehicle create, update and archive; station rename; settings update. This file is rewritten for Unfuel's functions; the rest is copied.
- **Sync**: drains the queue in order when the socket is up, maps temporary ids to real ones, reports a rejected write in a toast. Create mutations carry the op id as `clientKey` (`convex/lib/idempotency.ts`), so a replay after a reload cannot make a second fill-up.

New for Unfuel, since UnSplit's outbox cannot hold files (pattern from UnMoney's photo queue):

- A **blob store** in IndexedDB. `fillUps.createFromPhotos` queued offline points at local blob keys.
- Sync handles such an op in three recorded steps: upload each blob (`files.generateUploadUrl`, then `POST`), save the returned storage id against the blob key, then send the mutation with the storage ids. A crash between steps resumes from the saved ids instead of uploading again.
- A blob is deleted from the device only after the server has confirmed the mutation.
- Until then the fill-up shows its thumbnails from the blobs and the label "Waiting for connection".

Triggers for a sync attempt: app start, the socket connecting, the `online` event, the tab becoming visible.

What protects against loss:

| Risk | Guard |
| --- | --- |
| Reload or crash mid-upload | steps recorded in IndexedDB; `clientKey` on the mutation |
| Browser evicting storage | `navigator.storage.persist()` requested at the first capture; installed apps are exempt from Safari's seven-day eviction, so an un-installed iPhone user with captures waiting is nudged to install |
| Signing out with captures waiting | blocked behind a confirm that says how many will be lost |
| Server rejects a queued write | the write and its photos stay in a "Could not sync" list with Retry and Type it instead; nothing is dropped silently |
| Storage full | the capture is refused with a message before the form closes |

Not covered: upload while the app is closed. Android's Background Sync could do it later; iOS has no equivalent.

Things that need the server say so instead of hanging: the AI read, the UnMoney hand-off, export, delete account.

## 9. Location and stations

### 9.1 Location

- `navigator.geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 })` when photos are added, only if the newest photo was taken in the last ten minutes. Works offline; the fix is stored with the queued fill-up. A timeout or a refusal saves the fill-up with no location.
- For older gallery photos, the location and time come from the photo's EXIF, read before shrinking (section 21.2). Many pickers strip the location, so this is a fallback, not the main path.
- `Permissions-Policy` allows `geolocation=(self)`; UnMoney's and UnSplit's deny it.

### 9.2 Google Places

Places API (New), plain REST from Convex actions with `fetch`. The key (`GOOGLE_MAPS_API_KEY`) lives in the Convex environment and never reaches the browser, so there is no Maps JavaScript SDK, no new client dependency and no change to the Content-Security-Policy. Checked against Google's docs on 2026-11-27.

| Call | Endpoint | Used for | Field mask | Billed as |
| --- | --- | --- | --- | --- |
| Nearby Search | `POST /v1/places:searchNearby` | detection, and the drop-down's "nearby" list | `places.id,places.displayName,places.shortFormattedAddress,places.location` | Nearby Search Pro |
| Autocomplete | `POST /v1/places:autocomplete` | search as the rider types | none needed | Autocomplete Requests, or free session usage when a selection follows |
| Place Details | `GET /v1/places/{id}` | after a selection; refreshing a name | `id,displayName,shortFormattedAddress,location` | Place Details Pro |
| Text Search | `POST /v1/places:searchText` | detection from the bill's name and address when there is no location | `places.id,places.displayName,places.shortFormattedAddress,places.location` | Text Search Pro |

All on `https://places.googleapis.com`, key in `X-Goog-Api-Key`, mask in `X-Goog-FieldMask` (no spaces). Request details:

- **Nearby**: `includedTypes: ["gas_station"]`, `locationRestriction.circle` centred on the fill-up with `radius` of 150 m (or the fix's accuracy if larger, capped at 500), `rankPreference: "DISTANCE"`, `maxResultCount: 5`.
- **Autocomplete**: `includedPrimaryTypes: ["gas_station"]`, `locationBias.circle` of 20 km around the fill-up's location (the device's when the fill-up has none), `origin` set to the same point so results come with `distanceMeters`, and a `sessionToken`. Sent after three characters, debounced 300 ms.
- **Details after a selection** carries the same `sessionToken`, which closes the session; a new token is made for the next search.
- **Text Search**: `textQuery` of the bill's station name and address, `includedType: "gas_station"`.

Free monthly allowance, then price per 1,000 (Google's pricing pages; which column applies depends on the billing account's country):

| SKU | India | Elsewhere |
| --- | --- | --- |
| Nearby Search Pro | 35,000 free, then $9.60 | 5,000 free, then $32 |
| Text Search Pro | 35,000 free, then $9.60 | 5,000 free, then $32 |
| Place Details Pro | 35,000 free, then $5.10 | 5,000 free, then $17 |
| Autocomplete Requests | 70,000 free, then $0.85 | 10,000 free, then $2.83 |

### 9.3 Detection (`places.detect`, internal action)

Scheduled by every mutation that saves a fill-up with a location or a bill name and no station (`applyRead`, `createManual`, `update`). Because it runs on the server after the write, it also covers fill-ups queued offline. In order:

1. **Own station**: the rider's nearest station by haversine distance between this fill-up's coordinates and the station's stored coordinates. Within 150 m, use it. No Google call. Both sets of coordinates are the rider's own GPS fixes, not Google's.
2. **Nearby Search**, when the fill-up has coordinates. Choose with `pickStation` (`convex/lib/stations.ts`, pure, tested):
   - one result: that one;
   - several, and the bill gave a brand or name: the best match by shared words, brand counted first; a tie goes to the nearer;
   - several, no bill name: the nearest, but only if it is within 60 m and the next is at least twice as far;
   - otherwise no choice.
3. **Text Search**, when there are no coordinates but the bill gave a name: chosen only if exactly one result shares the brand and at least one other word.
4. A choice becomes the fill-up's station: an existing station of the rider with that `placeId`, or a new one. No choice leaves `stationId` empty; the drop-down offers the candidates.

Detection never overwrites a station the rider picked: `fillUps.stationSetBy` is `"auto"` or `"user"`, and only empty or `"auto"` is touched.

### 9.4 The drop-down

A shadcn Combobox (`cmdk`, already in UnMoney's stack), a sheet on phones.

- Sections: **Your stations** (from the cached `stations.list`, nearest first, works offline), **Nearby** (`places.nearby` action, when the fill-up has a location), **Search results** (`places.search` action as the rider types), and **Use "<typed text>"** for a station Google does not have.
- Selecting a Google result calls `stations.choose({ fillUpId, placeId, sessionToken })`: Place Details, then find or create the rider's station for that `placeId`, then set it on the fill-up with `stationSetBy: "user"`.
- Clearing sets `stationId` to none and `stationSetBy: "user"`, so detection leaves it alone.
- Offline, the Google sections are replaced by one line saying search needs a connection.
- A "Google Maps" text attribution sits at the foot of the Google sections and beside a Google-sourced name on the station page, as Google's policy requires when its content is shown without a map.

### 9.5 What is kept, and Google's storage rules

Google's Places policy allows a place ID to be stored indefinitely, coordinates from Places for up to 30 days, and does not allow business names and addresses to be saved. The schema follows that:

| Field | Source | Kept |
| --- | --- | --- |
| `stations.placeId` | Google | for good |
| `stations.lat`, `lng` | the rider's own GPS fix at the first fill-up there (Google's `location` only when the rider had none, and then refreshed with the name) | for good when the rider's own |
| `stations.billName`, `billBrand`, `billAddress` | read from the rider's bill | for good: the rider's data |
| `stations.customName` | typed by the rider | for good |
| `stations.googleName`, `googleAddress`, `googleFetchedAt` | Google | a cache: refetched by `places.refresh` when older than 30 days and the station is next shown |

The name shown is `customName`, else `googleName`, else `billName`, else "Station near <area>". `places.refresh` is one Place Details Pro call per stale station, started from the client when a list or page shows one, at most once a day per station.

This is my reading of the policy page; the full Terms of Service were not read. The stricter reading (no copy of the name at all, fetch on every view) costs a Details call per station per view; the looser one (store the name for good) is simpler and outside the terms. Decided on 2026-11-27: the 30-day cache as specified here.

### 9.6 Limits and counts

- Rate limiter, per user: `placesSearch` 120 per hour, `placesDetect` 30 per hour; and one app-wide `placesDaily` ceiling, since any signed-in account can cause these calls.
- `placesCalls` (userId, day, sku, calls) is bumped by each action; the dashboard's Data tab shows calls per day by SKU, by account, and the month's total against the free allowance.

### 9.7 Station figures and links

- On the client: visits, average price per litre, and the average mileage of stretches that started at that station against the vehicle's overall figure; shown from three fill-ups.
- "Open in Maps" is `https://www.google.com/maps/search/?api=1&query=<name>&query_place_id=<placeId>`, or `query=lat,lng` for a station with no place ID.

## 10. UnMoney

One mechanism for both the one-tap and the automatic case: Unfuel's server posts the fill-up to the rider's private UnMoney link. No browser redirect, so it works for fill-ups read while the app is closed.

- `settings.unmoney?: { url, auto }`. The link is a secret: it is stored on the server, checked to be `https://<host>/unfuel/<token>` on an allowed UnMoney host (`UNMONEY_HOSTS`, default the production Convex site of UnMoney), and returned to the client only as "connected" and the last four characters.
- `unmoney.send` (internal action) posts `{ v: 1, source: "unfuel", ref: <fillUp id>, amount: "1000.00", currency, date, time?, note: "Fuel", description, category: "Fuel" }` as JSON. A 2xx stores `fillUps.unmoneySentAt`; the same `ref` is safe to send twice (UnMoney must treat `ref` as an idempotency key). Any other answer is retried after 1 minute, 10 minutes, 1 hour, then left as `unmoneyError` with a Retry button.
- Scheduled by the mutation that makes a fill-up `done` when `auto` is on, and by `fillUps.sendToUnmoney` (the button) when it is off. Never sent twice once `unmoneySentAt` is set.

The **UnMoney side** is built on the branch `feat/unfuel-link` of the UnMoney repo (not committed or deployed): More › Unfuel makes the link and asks which payment method and expense category fill-ups go to; `POST /unfuel/<token>` (`convex/unfuel.ts` there) adds each fill-up as a real expense through UnMoney's own reducer, once per `ref`. It answers in one plain sentence, which Unfuel shows when the answer is a refusal (another currency, a deleted payment method, a link turned off) instead of retrying. The contract is written up in UnMoney's `docs/specs/unfuel-link.md` and tested on both sides with the same payload.

## 11. Installable app

As UnSplit's `vite.config.ts`: `registerType: "prompt"` (a new build waits for the rider to tap Update), manifest with `display: "standalone"`, `start_url: "/"`, maskable icons from `scripts/gen-icons.mjs`, a home-screen shortcut "Add fill-up" (`/?add=fillup`), `launch_handler: navigate-existing`, Workbox precache of the shell, `CacheFirst` for `/api/storage/` photos. Install button and the iPhone "Add to Home Screen" steps from UnSplit's `src/lib/install.ts`.

## 12. UI and responsive rules

- shadcn/ui components added with the shadcn CLI, UnMoney's `components.json` (`radix-nova`, neutral, CSS variables) and its `src/index.css` tokens: monochrome, Geist, light, dark and system. Blue for better, red for worse, as UnMoney uses them for money in and out.
- Designed at 360 px first. Bottom tab bar below 768 px, sidebar from 768 px, list and detail side by side from 1024 px.
- Sheets (`vaul`) on phones, dialogs on desktop, from one component.
- Charts sit in Recharts' `ResponsiveContainer`; figures use `tabular-nums`; station and vehicle names truncate; safe-area insets are respected in the installed app.
- **Overflow test**: a Playwright spec opens every route at 320×568, 360×640, 390×844, 768×1024 and 1440×900 with long names and large numbers seeded, and fails if `document.documentElement.scrollWidth` exceeds `clientWidth`.

## 13. Security and privacy

- Secrets only in Convex environment variables. The Anthropic key never reaches the browser.
- Every query and mutation checks the user; photos are served only to the `fileOwners` owner.
- Every function in `convex/admin.ts` starts with `requireSuperadmin`. The dashboard returns counts and sizes only (section 20.4).
- Uploads: images only, 2 MB after shrinking, rate limited.
- `vercel.json` headers from UnMoney: `nosniff`, `X-Frame-Options: DENY`, referrer policy, a Content-Security-Policy listing only Convex, Google profile pictures and jsDelivr (the on-device reader's engine, with `'wasm-unsafe-eval'` and `worker-src 'self' blob:` as UnMoney has), and `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`.
- Location is asked for in context, optional, stored only on the rider's own fill-ups, and removed with them.
- A fill-up's coordinates and the bill's station name are sent to Google Places to find the station, from the server and with nothing that identifies the rider. The privacy page names Google Maps Platform.
- Photos go to Anthropic to be read; the privacy page (`/privacy`) names Convex, Vercel, Anthropic and Google.
- Delete account removes rows and files.
- Google sign-in uses basic profile scopes only, so no restricted-scope review is needed.

## 14. Environment

Convex: `SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (optional), `GOOGLE_MAPS_API_KEY`, `E2E_AUTH` (local only).

The Google key needs Places API (New) enabled on its project and should be restricted to that API. It cannot be restricted by address, since Convex actions have no fixed one. Without the key, stations fall back to the bill's name and typed names, and the Google sections of the drop-down are hidden.
Vercel: `CONVEX_DEPLOY_KEY` for Production and for Preview.
Client: `VITE_CONVEX_URL` (written by the build). Convex also takes `UNMONEY_HOSTS` (optional, the hosts an UnMoney link may point at).

Without `ANTHROPIC_API_KEY` the app still works: photos are kept and every fill-up goes to `review` to be typed. The superadmin's address is a constant in `convex/lib/admin.ts`, not an environment variable, as in UnMoney: the client needs it to decide whether to load the page.

## 15. Tests

| Kind | Covers |
| --- | --- |
| Vitest, pure | mileage engine, `validateRead`, `pickStation` (one result, name match, nearest, ambiguous gives none), the name-to-show rule, hand-off payloads, the offline overlay |
| `convex-test`, Places | `places.*` with `fetch` stubbed: detection reuses an own station without calling Google, never overwrites a rider's choice, same `placeId` gives one station, limits |
| `convex-test` | access checks (a second user gets nothing), fill-up rules, idempotency, `applyRead`, account removal; every `admin.*` function refuses a non-superadmin; AI is refused for an account that is not switched on; the cap; `usage.ping` counts a repeated ping once |
| Vitest, device reader | `fuelText.ts` against saved OCR output of real bills (labels, decimals, the arithmetic check, giving up when unsure; station brand and name from headers of each oil company, and giving no name when the header is unclear); UnMoney's `receiptAmount.test.ts` and `receiptImage.test.ts` carried over; the EXIF parser against sample files |
| Vitest, dashboard | `src/pages/admin/metrics.ts` (ported with UnMoney's `metrics.test.ts`), `aiCost` covers the model in use |
| Live AI (opt-in) | the fixture photos against each candidate model |
| Playwright | sign-in through the local-only password provider, add by hand, add from photos with the action stubbed, the offline spec against the production build (capture offline, reload, reconnect, fill-up arrives once), the overflow spec |

CI as UnSplit's: typecheck, lint, unit tests on every pull request and on `main`, plus UnMoney's build step.

## 16. Deploy

As both apps: Vercel builds with `npx convex deploy -y --cmd 'npm run build' && node scripts/convex-preview-env.mjs`, so functions and frontend go out together; each branch gets a Convex preview deployment, deleted on merge by `.github/workflows/delete-convex-preview.yml`; merging to `main` is the release. Custom domain `unfuel.vikrantbhat.com` as a DNS-only CNAME in Cloudflare. No `middleware.ts`: there is no old host to retire.

You will need to provide: a Convex project, a Google OAuth client with the redirect URI `https://<deployment>.convex.site/api/auth/callback/google`, a Vercel project, and the Anthropic key.

## 17. Build order

1. **Skeleton**: UnSplit's config and scripts, UnMoney's theme, Google sign-in, the shell with tabs and sidebar, CI.
2. **Online slice**: add a fill-up by hand, History, the mileage engine with tests, the Home headline.
3. **Photo read**: upload, the action, checks, the review state, the live test and the model decision; with it the access switch, the cap and the `aiReads` log, since the action writes to them from its first call.
4. **Device reading**: port UnMoney's reader, add the fuel rules and the EXIF parser, fill the form from it. Comes right after step 3 because it shares `validateRead` and is what every account without AI uses.
5. **Offline**: port `src/offline`, write the overlay, add the photo queue, the offline spec.
6. **Location and stations**: capture, Google Places detection, the drop-down, refresh, limits and counts.
7. **Stats**: charts, facts, the dip insight.
8. **Vehicles, settings, export, privacy, delete account.**
9. **UnMoney**: the link setting, the sender, the button. The UnMoney side is separate work.
10. **Superadmin dashboard**: usage pings, the weekly count, the `/admin` page and its seven tabs. The AI access list comes first, as soon as step 3 lands, so photo reading can be switched on for testers.
11. **Responsive pass**, overflow spec (the dashboard included), install prompts, production deploy.

## 18. Risks

| Risk | Plan |
| --- | --- |
| Odometer misread (glare, trip meter, 7-segment digits) | forward-only and distance checks; fixture test picks the model; one tap to correct |
| Faded thermal bills, pumps that give no bill | pump display photo is a first-class input |
| Estimated mileage misleads | marked ≈, averaged over five stretches, overall figure beside it |
| iPhone evicts queued photos from an un-installed site | `storage.persist()`, install nudge while captures wait |
| No background upload on iPhone | stated in the app; count of waiting captures on Home |
| GPS stripped from gallery photos | device location at capture is the main path; station can be picked by hand |
| AI cost from an open sign-up | off for every account until switched on; monthly cap per account; cost per account on the dashboard |
| Device reading is weak on odometers and worn bills | never saves on its own; a field is filled only when the numbers agree or the reading is believable; the dashboard shows how many filled fields riders keep |
| The reader's engine is a third-party download | pinned version from jsDelivr, cached on the device after first use; if it cannot load the form simply opens empty |
| Dashboard query grows with users | `admin.overview` reads whole tables, as UnMoney's does, and cuts the range at 15,000 daily rows; fine for hundreds of users, to be paged beyond that |
| Old installed copies send no usage | UnMoney's "usage gap" flag is ported: an account that syncs but sends no pings is marked, not counted as inactive |
| Station figures over-read | shown from three fill-ups, labelled as a hint |
| Wrong station picked (two pumps side by side, poor GPS) | chosen only when clear; otherwise left empty with candidates; one tap to change |
| Google's terms on storing names | place ID kept for good, Google's name as a 30-day cache, the bill's own name as the rider's record (section 9.5) |
| Google cost or key abuse | server-side key, per-user and app-wide limits, calls counted on the dashboard |

## 19. Open technical questions

1. Which model (section 7.4): needs the sample photos.
2. Settled: in UnMoney an incoming fill-up becomes an entry straight away, in the payment method and category picked when the link is made (its drafts are built around Gmail).
3. Whether to keep `read.printed` (what the AI saw) forever or drop it once a fill-up is confirmed.
4. Whether `aiReads` rows are kept forever. They hold no fuel data, and about 60 a month per account at most.

## 20. Superadmin dashboard

Ported from UnMoney: `shared/admin.ts`, `convex/usage.ts`, `convex/admin.ts`, `convex/lib/aiSpend.ts`, `shared/aiCost.ts`, `src/lib/usage.ts`, `src/pages/admin/` (`AdminPage.tsx`, `UserSheet.tsx`, `charts.tsx`, `metrics.ts`, `metrics.test.ts`). The chart components and most of `metrics.ts` carry over unchanged; what changes is what is counted.

### 20.1 The gate

Three layers, as in UnMoney:

1. `SUPERADMIN_EMAIL = "vik.bhat223@gmail.com"` and `isSuperadmin(email)` in `convex/lib/admin.ts`, compared in lower case.
2. **Server**: `requireSuperadmin(ctx)` at the top of every public function in `convex/admin.ts`. Anyone else gets "Not allowed".
3. **Client**: the `/admin` route renders the page only when `isSuperadmin(user.email)`, otherwise redirects to `/`. The page is its own lazy chunk (`AdminPage-*.js`) and is left out of the service worker's precache (`globIgnores`), so no other account ever downloads it.

The email comes from Google sign-in, the only provider in production. The password provider used by the e2e suite exists only on local deployments, so it cannot be used to claim that address in the cloud.

### 20.2 Where the numbers come from

| Source | How | Feeds |
| --- | --- | --- |
| `usage.ping` | Every signed-in app sends its session's running totals every five minutes and when it leaves the screen: time on screen, screens visited, bytes down (size of query results as JSON, measured in the `useQuery` wrapper), bytes up (mutation arguments and photo uploads), photos fetched, changes synced, changes queued offline, changes rejected, time the oldest queued change waited; device, OS, browser, installed or not, app version, time zone. The server adds what grew since the last ping, so a retry counts nothing twice. | Overview, Usage, Devices, Data, Users |
| `aiReads` | Written by the read itself (section 7.5). | AI tab, AI cost tile, per-user AI |
| `adminStats` | Weekly cron and the Refresh button: each user's documents counted and sized per table with `getDocumentSize`, files by stored size, fill-ups by how they came in, which features are in use, preferences. One action per user, a second apart, as UnMoney learned to do. | Features, Data, Users |
| `users` | Name, email, picture, joined, `aiEnabled`; last sync from the newest `idempotencyKeys` row. | Users, AI access |

A session offline keeps counting and sends its totals when it is next online.

### 20.3 The page

`admin.overview({ from, to })` returns everything for the range in one reactive query; the page filters and sums it in `metrics.ts` (pure, tested). Filters live in the address: period, user, platform, installed or browser, include yourself. Tabs: Overview, AI, Usage, Devices, Features, Data, Users, with the content listed in the product doc (section 20.3 there).

New next to UnMoney's page:

- **Reads that went wrong**: `admin.badReads` lists reads with outcome `review`, `unreadable`, `error` or a non-empty `corrected`, newest first, each with its photo URLs, `read.printed`, the issue codes and the corrected field names. Superadmin only; the one place the dashboard returns a rider's own data (section 20.4).
- **Read quality**: outcomes, issue codes, corrected fields, photo kinds, latency (typical and 95th percentile), retries, refusals, cap hits; each split by model.
- **Cost by model**, average cost and tokens per read, month to date and a straight-line projection to month end.
- **Offline health**: changes queued offline, how long they waited, rejected changes.
- **Fuel-specific adoption**: photo against typed fill-ups, location allowed or refused, full-tank against amount riders, vehicles by type and fuel, stations per user, UnMoney hand-offs.

Left out from UnMoney's page because Unfuel has no such feature: Gmail sync, payment methods, entry sources from imports and repeats.

### 20.4 What the dashboard may read

`admin.overview` and `countPage` return counts, sizes, dates of creation and feature flags. They never return `amountMinor`, `quantityMilli`, `odometerM`, `lat`, `lng`, station names or notes.

One exception, decided on 2026-11-27: `admin.badReads` returns, for reads that went wrong only, the photos (signed storage URLs), what the AI read (`read.printed`) and what the rider corrected. `aiReads` itself stores issue codes and field names, not values; the values come from the fill-up at the time the superadmin opens it.

### 20.5 Crons (`convex/crons.ts`)

- daily 03:30 UTC: `usage.pruneSessions` (sessions older than 120 days)
- weekly Monday 03:40 UTC: `admin.refreshStats`
- daily 04:00 UTC: `files.sweepUnclaimed` (section 22.3)

The first two as in UnMoney.

### 20.6 Responsive

The dashboard follows the same rules as the rest of the app (section 12): tiles in two columns on a phone and up to six on desktop, cards stacked on a phone and in a grid from 768 px, the users table scrolling inside its own card and never the page, the user panel as a sheet on a phone and a side panel on desktop. It is part of the overflow test.


## 21. Reading photos on the device (no AI)

For accounts without AI access, and as the fallback when the cap is reached or a read has failed. Everything here runs in the browser; the server never runs OCR.

### 21.1 What is ported and what is new

| File | From | Does |
| --- | --- | --- |
| `src/lib/ocr.ts` | UnMoney | Tesseract worker (one at a time, released after 60 s idle), tilt correction, second digits-only read of numbers it was unsure of |
| `src/lib/receiptImage.ts` | UnMoney | finds the paper in the frame, crops to it, drops the colour |
| `src/lib/receiptAmount.ts` | UnMoney | parses amounts however they are grouped; picks the amount paid by its label; gives up when unsure |
| `src/lib/fuelText.ts` | new, pure | from the OCR lines: quantity (`VOLUME`, `QTY`, `LTR`, `LITRE`), rate (`RATE`, `PRICE`, `Rs/L`), amount (`AMOUNT`, `SALE`, `TOTAL`), date; the station's brand and name from the header; and the odometer rule |
| `src/lib/exif.ts` | new, pure | `DateTimeOriginal` and GPS from a JPEG's EXIF block; no dependency |

`tesseract.js` is the one dependency this adds, and UnMoney already has it. As there, the reader is its own lazy chunk (`ocr-*.js`), left out of the service worker's precache, and the engine and English model load from jsDelivr the first time a photo is added and are kept in IndexedDB after that.

### 21.2 The read

1. **EXIF first**, on the original file, before shrinking: capture time and, when present, location (`locationSource: "photo"`). With no EXIF time, the file's `lastModified`.
2. **Bill pass** on each photo: `prepareForOcr`, recognise, then `fuelText`. The three numbers go through the same arithmetic check as the AI path (`validateRead` in `convex/lib/fuelRead.ts`): two that are read with confidence give the third; three that disagree give nothing. Amount alone is accepted on UnMoney's rules (confident word, a total label, or backed up by a second line).
3. **Station** from the same recognition as the bill pass, no extra read (`stationFromHeader` in `fuelText.ts`):
   - The **header** is the lines above the first line that carries a bill label (`BILL`, `INVOICE NO`, `TXN`, `DATE`, `NOZZLE`, `PUMP`, `PRODUCT`), at most the first eight lines.
   - **Brand**: the first header line matching a list of oil companies and their short forms (`INDIAN OIL`/`IOCL`, `BHARAT PETROLEUM`/`BPCL`, `HINDUSTAN PETROLEUM`/`HPCL`/`HP`, `SHELL`, `NAYARA`, `JIO-BP`, `RELIANCE`, `ESSAR`), allowing the letter swaps OCR makes (`0` for `O`, `1` for `I`).
   - **Name**: the first header line that is not the brand, not a title (`TAX INVOICE`, `ORIGINAL`, `WELCOME`, `CASH MEMO`), not mostly digits (phone, GSTIN, pin code), has at least two letters-only words, and whose words average UnMoney's `MIN_WORD_CONFIDENCE`. A line with a station word (`FUEL`, `FILLING`, `SERVICE STATION`, `PETROLEUM`, `AUTO`, `ENTERPRISES`, `AGENCIES`) beats an earlier line without one. Cut to 60 characters, title-cased.
   - No line passes: no name. The brand alone is still used.
   - **What it is used for**: saved as the station's `billName` and `billBrand`, and passed to `places.detect` to choose among the Google results near the fill-up (section 9.3). It is the name shown only when Google has no match.
4. **Odometer pass** on photos where the bill pass found no amount: one recognition with digits only and sparse-text layout; the longest number of 3 to 7 digits is kept only if it is above the vehicle's last odometer and no more than 3,000 km above it. With no earlier fill-up there is nothing to check against, so it is offered but marked unsure.
5. The result is `{ amount?, quantity?, date?, time?, stationName?, stationBrand?, odometer?, lat?, lng? }` plus which fields it filled. It goes into the form; nothing is saved until the rider taps Save, which calls `fillUps.createManual` with the photos and `source: "device"`.

Nothing here throws: if the engine cannot load (first use with no signal) or nothing is clear, the answer is empty and the form opens blank, as UnMoney's `readAmount` returns null.

### 21.3 When it runs

- `users.me.ai` is false: on adding photos, in the Add sheet, while the photos upload (or queue, offline).
- A fill-up in `review` with `aiOff`, `capReached` or `unreadable`: from a "Try reading on this device" button, on the stored photos.
- Never for an account with AI access whose read is simply waiting for a connection. That fill-up stays queued for the AI read.

### 21.4 Offline

Device reading needs no network once the engine is cached, so an account without AI gets its form filled even with no signal. The fill-up and its photos then go through the outbox and the photo queue like any other (section 8).

### 21.5 What the dashboard counts

`usage.ping` carries `deviceReads`, `deviceFieldsFound` and `deviceFieldsKept` (fields the device filled that the rider saved unchanged). The Read quality card shows them beside the AI figures, so the two readers can be compared. `adminStats.fillUps.device` counts fill-ups that came in this way.

### 21.6 What it will not do

Telling a trip meter from the odometer, hand-written bills, and languages other than English. A station name has no sum to check it against, so it is the field most likely to be filled wrong; it is always shown for the rider to confirm and counted separately on the dashboard. Seven-segment displays (digital dashboards, pump displays) read poorly with Tesseract's English model; the sample photos will show how poorly, and the odometer pass is dropped if it fills wrong numbers more often than right ones.

## 22. Photo optimisation

One function, `optimisePhoto(file)` in `src/lib/image.ts`, a port of UnSplit's `compressImage` with UnMoney's size limits. Every upload goes through it; there is no other way for a file to reach `files.generateUploadUrl` in the client.

### 22.1 Steps, in order

1. Read EXIF from the original (section 21.2). Run device reading on the original when it applies (section 21): the pixels are already on the device and more of them helps the reader.
2. Decode with `createImageBitmap(file, { imageOrientation: "from-image" })`, so the rotation is baked in and the orientation tag is no longer needed.
3. Scale so the longest edge is at most 1,568 px (`imageSmoothingQuality: "high"`). Never scale up.
4. Encode once: `canvas.toBlob` as `image/webp` at quality 0.85. Safari cannot write WebP and hands back a PNG instead; then paint a white background and encode `image/jpeg` at 0.85. Drawing through a canvas also drops all metadata.
5. If the result is not smaller than the original, keep the original.
6. If it is still over 2 MB, encode again from the same bitmap at 0.7; still over, refuse with a message. A second encode is from the decoded bitmap, never from the first result.

The file is encoded once and stored as received: no second compression on the server, none when it is served. The service worker caches it as it is (`CacheFirst`).

### 22.2 Why not strictly lossless

Lossless WebP or PNG of a camera photo is typically several times the size of the phone's JPEG, so "lossless" and "smallest" pull in opposite directions. The spec is visually lossless: the saving comes from the resize (a 12 MP photo has about six times the pixels reading needs) and from WebP. Expected size is roughly 150 to 400 KB per photo; `convex/lib/fuelRead.live.test.ts` reports the real sizes of the sample photos, and whether reads get worse at 0.85 than at 0.95, before the quality is fixed. Pixel-exact originals are not kept anywhere. Decided on 2026-11-27.

### 22.3 Server checks

Convex cannot inspect an upload before it lands, so the check is at `files.claim`, which every upload must pass before a fill-up may reference it:

- `ctx.db.system.get(storageId)`: `contentType` is `image/webp`, `image/jpeg` or `image/png`, and `size` is at most 2 MB. Anything else is deleted from storage and the claim is refused.
- The owner is recorded in `fileOwners`.
- `files.sweepUnclaimed` (daily cron) deletes stored files older than a day with no `fileOwners` row, so an upload that was never claimed does not stay.

### 22.4 What the dashboard counts

`usage.ping` carries `photoBytesBefore` and `photoBytesAfter` per session. The Data tab shows photos uploaded, average stored size and the share saved by optimising; storage by account already includes photos.

## 23. As built (2026-11-27)

The first version is built and runs. Where it differs from the sections above, this section is right.

### Different from the plan

| Planned | Built |
| --- | --- |
| npm, as UnMoney and UnSplit | **bun**, as asked: `bun.lock`, `bunx convex`, bun on Vercel and in CI |
| Forms as a sheet on phones and a dialog on desktop | Add and a fill-up's detail are **pages** (`/add`, `/fill/:id`). Fewer ways to overflow, and Back works the same everywhere. The station picker is a sheet |
| List and detail side by side from 1024 px | Not built: every screen is one column, up to a reading width |
| `exports.csv` | `exports.rows`; the app builds the CSV file |
| Fuel type taken from the first bill | Not built: a new vehicle is petrol until edited |
| "Which vehicle was it?" when a reading fits another vehicle better | Not built: a fill-up goes to the current vehicle; it can be moved in the form |
| Merging two stations | In the backend (`stations.merge`), no button yet |
| Share photos to Unfuel from the gallery (Android) | Not built (it was a could-have) |
| `fillUps.pending`, `settings.locationAsked`, `usageDaily` as flat fields | The app filters `fillUps.list`; the browser's own permission prompt is the ask; a day's counts are one `totals` record keyed by `COUNT_KEYS` |
| `.env.example` | Not written (this session could not write files named `.env*`). The README lists every variable |

### Added while building

- A fill-up deleted more than 30 days ago is removed for good with its photos (`fillUps.purgeDeleted`, daily). Until then Undo can bring it back.
- A new fill-up the server refuses (made offline, say with an odometer that clashes with one added elsewhere) is not dropped: it is kept with its photos under "Could not sync" on Home, to fix or discard (`src/offline/store.ts` `park`).
- `files.claim` answers `"refused"` instead of throwing for a file that is not an optimised image: an error would have rolled back the delete and left the file stored.
- `scripts/delete-convex-preview.mjs` no longer carries UnSplit's production deployment name: it needs `CONVEX_PROD_DEPLOYMENT` or `CONVEX_PROJECT_ID`, so it cannot be pointed at another app's project by accident.

### Checked, and how

| What | How |
| --- | --- |
| Mileage, read checks, bill text, stations, offline overlay, dashboard metrics, EXIF, CSP | 152 unit tests |
| Access, fill-up rules, uploads, AI gating and cap, the UnMoney sender, dashboard refusals, usage counts, account deletion | 24 Convex function tests (`convex/app.test.ts`) |
| Sign up, type fill-ups, mileage, edit, delete, undo; a photo kept and shown; the dashboard closed to others | Playwright, real browser, local backend |
| A fill-up and photo made offline arrive once when the connection is back | Playwright |
| No sideways scroll on 10 screens at 320, 360, 390, 768 and 1440 px, with long names and large numbers | Playwright |
| On-device reading of a bill (amount, litres, date, time, station name) | By hand in the browser, on a generated bill image, not a photograph |
| UnMoney, end to end | By hand, both apps on local backends: a link made in UnMoney and pasted into Unfuel; one fill-up sent with the button and one on its own with "Send every fill-up" on arrived in UnMoney's ledger with the right date, amount and description; with the link turned off, Unfuel showed UnMoney's sentence and Try again |

### Not checked

- **An AI read against the real API.** No key was available. The request shape follows UnMoney's working code and the checks on the answer are tested, but no photo has been read by Claude from this app.
- **Google Places against the real API.** No key. The picking rules are tested with made-up results; the request and response shapes come from Google's docs.
- **Google sign-in, and a production deploy.** Neither a Google OAuth client nor Convex and Vercel projects exist yet.
- **Real photographs**: how well the device reads real bills and odometers, and real optimised sizes.
- **iPhone and Android devices**: only desktop Chromium at phone sizes.
- **UnMoney in production**: checked end to end only between two local backends (below). UnMoney's side is on a branch and on its dev deployment, not in production.
