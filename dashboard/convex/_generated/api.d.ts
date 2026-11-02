/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentStatus from "../agentStatus.js";
import type * as briefingAgent from "../briefingAgent.js";
import type * as careerAgent from "../careerAgent.js";
import type * as cleanup from "../cleanup.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as jobCrm from "../jobCrm.js";
import type * as jobSources from "../jobSources.js";
import type * as jobs from "../jobs.js";
import type * as keys from "../keys.js";
import type * as leadAgent from "../leadAgent.js";
import type * as leadCrm from "../leadCrm.js";
import type * as leadMaintenance from "../leadMaintenance.js";
import type * as leadTargets from "../leadTargets.js";
import type * as leads from "../leads.js";
import type * as llm from "../llm.js";
import type * as osm from "../osm.js";
import type * as outreach from "../outreach.js";
import type * as profile from "../profile.js";
import type * as seed from "../seed.js";
import type * as techversaProfile from "../techversaProfile.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentStatus: typeof agentStatus;
  briefingAgent: typeof briefingAgent;
  careerAgent: typeof careerAgent;
  cleanup: typeof cleanup;
  crons: typeof crons;
  dashboard: typeof dashboard;
  jobCrm: typeof jobCrm;
  jobSources: typeof jobSources;
  jobs: typeof jobs;
  keys: typeof keys;
  leadAgent: typeof leadAgent;
  leadCrm: typeof leadCrm;
  leadMaintenance: typeof leadMaintenance;
  leadTargets: typeof leadTargets;
  leads: typeof leads;
  llm: typeof llm;
  osm: typeof osm;
  outreach: typeof outreach;
  profile: typeof profile;
  seed: typeof seed;
  techversaProfile: typeof techversaProfile;
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

export declare const components: {};
