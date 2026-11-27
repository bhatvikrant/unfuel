import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { DataModel } from "./_generated/dataModel";
import { env } from "./_generated/server";

/**
 * Email + password sign-in for the Playwright suite (tests/e2e), which has no Google account to
 * use. Present only when E2E_AUTH=1 is set on the deployment, and only on a local deployment
 * (`npx convex dev` on 127.0.0.1), so it can never be switched on in the cloud: nobody can claim
 * the superadmin's address (convex/lib/admin.ts) with a password there.
 */
const e2ePassword = Password<DataModel>({
  profile: (params) => ({
    email: String(params.email ?? "").trim().toLowerCase(),
    name: typeof params.name === "string" && params.name.trim() ? params.name.trim() : undefined,
  }),
});
const e2eAuth = env.E2E_AUTH === "1" && env.CONVEX_CLOUD_URL.startsWith("http://127.0.0.1:");

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: e2eAuth ? [Google, e2ePassword] : [Google],
});
