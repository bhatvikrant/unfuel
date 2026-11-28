#!/usr/bin/env bash
# Runs `bunx convex env ...` against Unfuel's PRODUCTION deployment, whatever .env.local points at.
# Usage: ./scripts/prod-env.sh list | get NAME | set NAME value | remove NAME
set -euo pipefail
cd "$(dirname "$0")/.."
exec bunx convex env "$@" --deployment bhatvikrant:unfuel:prod
