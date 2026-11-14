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
import type * as applicationKit from "../applicationKit.js";
import type * as autopilot from "../autopilot.js";
import type * as briefingAgent from "../briefingAgent.js";
import type * as careerAgent from "../careerAgent.js";
import type * as cleanup from "../cleanup.js";
import type * as coachAgent from "../coachAgent.js";
import type * as counters from "../counters.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as gmail from "../gmail.js";
import type * as home from "../home.js";
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
import type * as outbox from "../outbox.js";
import type * as outreach from "../outreach.js";
import type * as painAgent from "../painAgent.js";
import type * as painSources from "../painSources.js";
import type * as profile from "../profile.js";
import type * as prompts from "../prompts.js";
import type * as prospectAgent from "../prospectAgent.js";
import type * as prospectCrm from "../prospectCrm.js";
import type * as prospectSources from "../prospectSources.js";
import type * as replies from "../replies.js";
import type * as resumes from "../resumes.js";
import type * as retention from "../retention.js";
import type * as seed from "../seed.js";
import type * as seen from "../seen.js";
import type * as solutionDesigner from "../solutionDesigner.js";
import type * as techversaProfile from "../techversaProfile.js";
import type * as trendAgent from "../trendAgent.js";
import type * as trendSources from "../trendSources.js";
import type * as usageCheck from "../usageCheck.js";
import type * as views from "../views.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentStatus: typeof agentStatus;
  applicationKit: typeof applicationKit;
  autopilot: typeof autopilot;
  briefingAgent: typeof briefingAgent;
  careerAgent: typeof careerAgent;
  cleanup: typeof cleanup;
  coachAgent: typeof coachAgent;
  counters: typeof counters;
  crons: typeof crons;
  dashboard: typeof dashboard;
  gmail: typeof gmail;
  home: typeof home;
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
  outbox: typeof outbox;
  outreach: typeof outreach;
  painAgent: typeof painAgent;
  painSources: typeof painSources;
  profile: typeof profile;
  prompts: typeof prompts;
  prospectAgent: typeof prospectAgent;
  prospectCrm: typeof prospectCrm;
  prospectSources: typeof prospectSources;
  replies: typeof replies;
  resumes: typeof resumes;
  retention: typeof retention;
  seed: typeof seed;
  seen: typeof seen;
  solutionDesigner: typeof solutionDesigner;
  techversaProfile: typeof techversaProfile;
  trendAgent: typeof trendAgent;
  trendSources: typeof trendSources;
  usageCheck: typeof usageCheck;
  views: typeof views;
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
