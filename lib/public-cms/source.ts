// The integration boundary between the live static public site and a future
// CMS-backed one.
//
// Default is STATIC, which is exactly what Production serves today. The CMS
// path cannot switch itself on: it requires an explicit opt-in AND a payload
// that satisfies the consumer contract. Anything else falls back to static and
// says why, so a broken or half-migrated CMS degrades to the working site
// instead of to a blank page.

import {
  PUBLIC_CMS_CONTRACT_VERSION,
  validatePublicPage,
  type ContractViolation,
  type PublicPage,
} from "./contract.ts";

export type ContentSource = "STATIC" | "CMS";

export type SourceDecision = {
  source: ContentSource;
  reason: string;
};

export type SourceEnvironment = {
  // Explicit opt-in. Absent or anything other than the exact token below keeps
  // the public site on the static release.
  PUBLIC_CMS_SOURCE?: string;
  // Lane B declares which consumer-contract version its API satisfies.
  PUBLIC_CMS_CONTRACT_VERSION?: string;
};

const CMS_OPT_IN_TOKEN = "CMS";

/**
 * Decides where public content comes from. Static unless every condition for
 * CMS is met, and the reason is always reportable.
 */
export function resolveContentSource(environment: SourceEnvironment = {}): SourceDecision {
  const requested = environment.PUBLIC_CMS_SOURCE?.trim().toUpperCase();

  if (!requested || requested === "STATIC") {
    return { source: "STATIC", reason: "static release is the default source" };
  }
  if (requested !== CMS_OPT_IN_TOKEN) {
    return { source: "STATIC", reason: `unknown PUBLIC_CMS_SOURCE "${requested}"` };
  }

  const declared = environment.PUBLIC_CMS_CONTRACT_VERSION?.trim();
  if (!declared) {
    return { source: "STATIC", reason: "CMS requested but no contract version was declared" };
  }
  if (Number(declared) !== PUBLIC_CMS_CONTRACT_VERSION) {
    return {
      source: "STATIC",
      reason: `CMS declares contract v${declared}, public site requires v${PUBLIC_CMS_CONTRACT_VERSION}`,
    };
  }

  return { source: "CMS", reason: `CMS satisfies consumer contract v${PUBLIC_CMS_CONTRACT_VERSION}` };
}

export type PageResolution =
  | { source: "CMS"; page: PublicPage }
  | { source: "STATIC"; reason: string; violations?: ContractViolation[] };

/**
 * Resolves one public page.
 *
 * `loadFromCms` is supplied by the caller and will be backed by Lane B's API.
 * It is treated as untrusted: its result is validated, a throw is caught, and
 * either way the static release is used instead of a doubtful page. The public
 * site never renders a CMS payload it could not fully verify.
 */
export async function resolvePage(
  path: string,
  environment: SourceEnvironment,
  loadFromCms?: (path: string) => Promise<unknown>,
): Promise<PageResolution> {
  const decision = resolveContentSource(environment);
  if (decision.source === "STATIC") return { source: "STATIC", reason: decision.reason };
  if (!loadFromCms) return { source: "STATIC", reason: "no CMS loader is wired" };

  let payload: unknown;
  try {
    payload = await loadFromCms(path);
  } catch (error) {
    // A CMS outage must not take the public website down with it.
    return {
      source: "STATIC",
      reason: `CMS load failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }

  if (payload === null || payload === undefined) {
    return { source: "STATIC", reason: "CMS returned no page" };
  }

  const validated = validatePublicPage(payload);
  if (!validated.ok) {
    return { source: "STATIC", reason: "CMS payload failed the consumer contract", violations: validated.violations };
  }
  if (validated.value.path !== path) {
    return { source: "STATIC", reason: `CMS returned ${validated.value.path} for ${path}` };
  }

  return { source: "CMS", page: validated.value };
}
