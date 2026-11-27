/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as admin from "../admin.js";
import type * as ai from "../ai.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as exports from "../exports.js";
import type * as files from "../files.js";
import type * as fillUps from "../fillUps.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_admin from "../lib/admin.js";
import type * as lib_aiCost from "../lib/aiCost.js";
import type * as lib_currencies from "../lib/currencies.js";
import type * as lib_fuelRead from "../lib/fuelRead.js";
import type * as lib_idempotency from "../lib/idempotency.js";
import type * as lib_mileage from "../lib/mileage.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_stations from "../lib/stations.js";
import type * as places from "../places.js";
import type * as settings from "../settings.js";
import type * as stations from "../stations.js";
import type * as unmoney from "../unmoney.js";
import type * as usage from "../usage.js";
import type * as users from "../users.js";
import type * as vehicles from "../vehicles.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  admin: typeof admin;
  ai: typeof ai;
  auth: typeof auth;
  crons: typeof crons;
  exports: typeof exports;
  files: typeof files;
  fillUps: typeof fillUps;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/admin": typeof lib_admin;
  "lib/aiCost": typeof lib_aiCost;
  "lib/currencies": typeof lib_currencies;
  "lib/fuelRead": typeof lib_fuelRead;
  "lib/idempotency": typeof lib_idempotency;
  "lib/mileage": typeof lib_mileage;
  "lib/money": typeof lib_money;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/stations": typeof lib_stations;
  places: typeof places;
  settings: typeof settings;
  stations: typeof stations;
  unmoney: typeof unmoney;
  usage: typeof usage;
  users: typeof users;
  vehicles: typeof vehicles;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
