#!/usr/bin/env bash
# Deploys the Convex backend to production and the built frontend to Vercel,
# from this machine (no git integration needed). Needs: `bunx convex dev --once
# --env-file .env.cloud.local` done once (writes the cloud project config) and
# the Vercel CLI logged in and linked (`vercel link`).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env.cloud.local ]; then
  echo "Missing .env.cloud.local. Run: bunx convex dev --once --env-file .env.cloud.local" >&2
  exit 1
fi
CONVEX_DEPLOYMENT=$(grep -E '^CONVEX_DEPLOYMENT=' .env.cloud.local | cut -d= -f2 | cut -d' ' -f1)
export CONVEX_DEPLOYMENT
vercel pull --yes --environment=production
vercel build --prod          # runs vercel.json's buildCommand: bunx convex deploy -y --cmd 'bun run build'
vercel deploy --prebuilt --prod --yes
