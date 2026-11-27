#!/usr/bin/env node
/**
 * Deletes the Convex preview deployment(s) for one or more git branches.
 *
 * Every Vercel preview build runs `bunx convex deploy` with a preview deploy key, which gives the
 * branch its own Convex deployment (`preview/<branch>`). Convex only garbage-collects those days
 * later, so this runs from GitHub Actions when a PR is merged (.github/workflows/delete-convex-preview.yml)
 * and can be run by hand for any branch.
 *
 *   node scripts/delete-convex-preview.mjs <branch> [<branch>...] [--dry-run]
 *
 * Auth: CONVEX_ACCESS_TOKEN, a team access token (Convex dashboard › Team settings › Access tokens).
 * Locally it falls back to the token `bunx convex login` stored in ~/.convex/config.json.
 * Project: CONVEX_PROJECT_ID, or else looked up from the production deployment.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://api.convex.dev/v1";
// Unfuel's production deployment, once it exists: set it here or in CONVEX_PROD_DEPLOYMENT. Empty on
// purpose until then, so this script can never be pointed at another app's project by a copied name.
const PROD_DEPLOYMENT = process.env.CONVEX_PROD_DEPLOYMENT ?? "";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const branches = args.filter((a) => !a.startsWith("--"));

if (branches.length === 0) {
  console.error("Usage: node scripts/delete-convex-preview.mjs <branch> [<branch>...] [--dry-run]");
  process.exit(2);
}

const token = process.env.CONVEX_ACCESS_TOKEN || localCliToken();
if (!token) {
  console.error("✖ Set CONVEX_ACCESS_TOKEN (a Convex team access token) or run `bunx convex login`.");
  process.exit(1);
}

function localCliToken() {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".convex", "config.json"), "utf8")).accessToken;
  } catch {
    return undefined;
  }
}

async function api(method, path) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status} ${body}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function projectId() {
  if (process.env.CONVEX_PROJECT_ID) return process.env.CONVEX_PROJECT_ID;
  if (!PROD_DEPLOYMENT) {
    console.error("✖ Set CONVEX_PROJECT_ID or CONVEX_PROD_DEPLOYMENT: this script does not know Unfuel's Convex project yet.");
    process.exit(1);
  }
  const prod = await api("GET", `/deployments/${PROD_DEPLOYMENT}`);
  return prod.projectId;
}

let previews;
try {
  previews = await api("GET", `/projects/${await projectId()}/list_deployments?deploymentType=preview`);
} catch (err) {
  console.error(`✖ Couldn't list Convex preview deployments: ${err.message}`);
  process.exit(1);
}

let failed = false;
for (const branch of branches) {
  const matches = previews.filter((d) => d.previewIdentifier === branch);
  if (matches.length === 0) {
    console.log(`· ${branch}: no Convex preview deployment (already gone)`);
    continue;
  }
  for (const d of matches) {
    if (dryRun) {
      console.log(`· ${branch}: would delete ${d.name} (${d.reference})`);
      continue;
    }
    try {
      await api("POST", `/deployments/${d.name}/delete`);
      console.log(`✔ ${branch}: deleted ${d.name} (${d.reference})`);
    } catch (err) {
      failed = true;
      console.error(`✖ ${branch}: failed to delete ${d.name}: ${err.message}`);
    }
  }
}

process.exit(failed ? 1 : 0);
