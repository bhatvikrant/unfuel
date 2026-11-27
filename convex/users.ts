import { query } from "./_generated/server";
import { aiAllowed, currentUser } from "./lib/access";
import { isSuperadmin } from "./lib/admin";
import { env } from "./_generated/server";

/** The signed-in user, with what they may do. `ai`: their photos are read by Claude; otherwise on the device. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const u = await currentUser(ctx);
    if (!u) return null;
    return {
      id: u._id,
      name: u.name ?? null,
      email: u.email ?? null,
      image: u.image ?? null,
      ai: aiAllowed(u) && !!env.ANTHROPIC_API_KEY,
      superadmin: isSuperadmin(u.email),
      places: !!env.GOOGLE_MAPS_API_KEY,
      createdAt: u._creationTime,
    };
  },
});
