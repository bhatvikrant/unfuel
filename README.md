# Unfuel

Know what your vehicle really costs to run. Photograph the fuel bill and the odometer; Unfuel works out the mileage, the cost per kilometre and where the money goes. A web rebuild of the fuel-log core of [Fuelio](https://fuel.io/), photos first. Installable as a PWA, works offline, syncs through Convex.

The product and engineering write-ups are in [docs/prd.md](docs/prd.md) and [docs/erd.md](docs/erd.md).

## Stack

The same as [UnMoney](https://github.com/bhatvikrant/unmoney) and [UnSplit](https://github.com/bhatvikrant/unsplit), with bun as the package manager:

- Vite + React 19 + TypeScript, React Router, Tailwind 4, shadcn/ui, Framer Motion, Recharts
- Convex: database, functions, file storage for photos, scheduler, cron
- Convex Auth: Google sign-in only
- Claude (`@anthropic-ai/sdk`) reads photos for accounts that have AI switched on; Tesseract reads them on the device for everyone else
- Google Places API (New) for fuel stations, called from the server
- bun, oxlint, Vitest, convex-test, Playwright; Vercel + Convex Cloud

## Run it locally

```bash
bun install
bun run auth:setup        # once: generates JWT keys and sets SITE_URL on the dev deployment
bun run dev:all           # Convex local backend + Vite on http://localhost:5173
```

`bun run dev:all` uses an anonymous local Convex deployment: no account needed, and `.env.local` stays pointed at it.

Google sign-in needs an OAuth client, which a local deployment does not have. To get in locally, turn on the test-only sign-in (it exists only on a local deployment, see `convex/auth.ts`):

```bash
bunx convex env set E2E_AUTH 1
```

then, in the browser console on the landing page:

```js
await __e2eSignIn({ email: "you@example.com", password: "any-8-chars", flow: "signUp", name: "You" })
```

Sign up as `vik.bhat223@gmail.com` this way to see the superadmin dashboard at `/admin`.

### Keys (all optional locally)

Set on the Convex deployment, never in the client:

```bash
bunx convex env set ANTHROPIC_API_KEY sk-ant-...      # photo reading by AI
bunx convex env set ANTHROPIC_MODEL claude-haiku-5-5  # optional: the default
bunx convex env set GOOGLE_MAPS_API_KEY ...           # station search; enable "Places API (New)" on the key's project
bunx convex env set UNMONEY_HOSTS <host>.convex.site  # optional: where an UnMoney link may point
                                                      # (a local UnMoney: 127.0.0.1:<its site port>; http is taken for this machine only)
```

Without the Anthropic key nobody has AI reading: photos are kept and read on the device. Without the Google key stations are named from the bill or typed.

## How it works

- **Fill-ups are the only truth.** Mileage, cost per km, charts, insights and station figures are never stored: `convex/lib/mileage.ts` works them out from the fill-ups, on the device, so they show offline too.
- **Photos.** Every photo is optimised on the device before it goes anywhere (`src/lib/image.ts`: longest edge 1,568 px, WebP, metadata stripped). The server refuses anything else (`convex/files.ts`).
- **Reading with AI** (`convex/ai.ts`, rules in `convex/lib/fuelRead.ts`): one Claude call per fill-up with every photo, structured output, then checks (amount, litres and rate agree; the odometer moved forward). A clean read is saved without asking; anything else waits as "Needs a look". Off for every account until the superadmin turns it on; 60 reads a month each.
- **Reading without AI** (`src/lib/deviceRead.ts`, `ocr.ts`, `fuelText.ts`): the photo's own date and place, then Tesseract on the device for the bill's numbers, date and station name, then the odometer. Fills the form for the rider to check; never saves on its own.
- **Offline** (`src/offline/`, UnSplit's layer plus a photo queue): the last result of every query is kept in IndexedDB, every write goes through a durable outbox, and photos taken with no signal wait on the device until the fill-up they belong to has reached the server. A new fill-up the server refuses is kept, with its photos, under "Could not sync" on Home.
- **Stations** (`convex/places.ts`, `convex/lib/stations.ts`): a fill-up's station is found after it is saved: one of the rider's own within 150 m, else Google's nearby fuel stations matched against the name on the bill. Google's place ID is kept; its name is a copy refetched after 30 days; coordinates are always the rider's own.
- **UnMoney** (`convex/unmoney.ts`): the server posts a fill-up to the rider's private UnMoney link (made in UnMoney under More › Unfuel), on a button or for every fill-up. UnMoney adds it as an expense, once; when it refuses (another currency, a link turned off), its own sentence is shown on the fill-up.
- **Superadmin** (`/admin`, `convex/admin.ts`, `convex/usage.ts`): usage, devices, features, storage, AI cost and read quality, Google Places calls, and the AI switch per account. One address only (`convex/lib/admin.ts`); the page's code is a chunk nobody else downloads.

## Test

```bash
bun run test          # unit (mileage, read checks, bill text, stations, offline overlay, metrics) and Convex functions
bun run typecheck
bun run lint
bun run test:e2e      # Playwright, with `bun run dev:all` running and E2E_AUTH=1 set (above)
```

The e2e suite signs up accounts of its own through the test-only sign-in. It covers the core flow, a fill-up and photo made offline arriving once, access to the dashboard, and that no screen scrolls sideways from 320 px to 1440 px.

Not covered by any test: a real AI read (needs a key and sample photos; `convex/lib/fuelRead.ts` has the request, and the checks on its answer are tested), and Google Places against the real API (the picking rules are tested).

## Deploy

As UnMoney and UnSplit: the Convex backend on a cloud deployment, the static `dist/` on Vercel, and merging to `main` is the release.

1. **Convex project**: `bunx convex dev --once --env-file .env.cloud.local`, then `bunx convex deploy -y --env-file .env.cloud.local` for production.
2. **Vercel project**: `vercel link`. `vercel.json` installs with bun and builds with `bunx convex deploy -y --cmd 'bun run build'`, so functions and frontend go out together. Add a production deploy key: `vercel env add CONVEX_DEPLOY_KEY production` (and a preview key for preview deployments).
3. **Auth**: `SITE_URL=https://<your domain> ./scripts/setup-auth-env.sh --prod`.
4. **Google sign-in**: an OAuth client (Web application) with the redirect URI `https://<deployment>.convex.site/api/auth/callback/google`, then `bun run env:prod -- set AUTH_GOOGLE_ID ...` and `AUTH_GOOGLE_SECRET ...`.
5. **Keys**: `bun run env:prod -- set ANTHROPIC_API_KEY ...` and `GOOGLE_MAPS_API_KEY ...`.
6. **Preview cleanup**: set `CONVEX_PROD_DEPLOYMENT` (or `CONVEX_PROJECT_ID`) and `CONVEX_ACCESS_TOKEN` for `.github/workflows/delete-convex-preview.yml`.

`vercel.json` also sets the security headers, including a Content-Security-Policy that names the one inline script in `index.html` by its hash: `tests/unit/csp.test.ts` fails when that script is edited without updating it.

## Layout

```
convex/            schema, auth, every query, mutation and action, cron
convex/lib/        pure modules shared with the app: mileage, read checks, stations, money, admin
src/               pages/, components/, lib/, offline/
tests/unit         Vitest
tests/e2e          Playwright
scripts/           auth keys, deploy, preview env
docs/              product and engineering requirements
```
