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
import { validatePublicPost, type PublicPost } from "./posts.ts";

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
export type ResolveOptions = {
  /** Milliseconds to wait for the CMS before falling back. */
  timeoutMs?: number;
};

export async function resolvePage(
  path: string,
  environment: SourceEnvironment,
  loadFromCms?: (path: string) => Promise<unknown>,
  options: ResolveOptions = {},
): Promise<PageResolution> {
  const decision = resolveContentSource(environment);
  if (decision.source === "STATIC") return { source: "STATIC", reason: decision.reason };
  if (!loadFromCms) return { source: "STATIC", reason: "no CMS loader is wired" };

  const loaded = await loadWithDeadline(() => loadFromCms(path), options.timeoutMs ?? CMS_LOAD_TIMEOUT_MS);
  if (!loaded.ok) return { source: "STATIC", reason: loaded.reason };

  const validated = validatePublicPage(loaded.payload);
  if (!validated.ok) {
    return { source: "STATIC", reason: "CMS payload failed the consumer contract", violations: validated.violations };
  }
  if (validated.value.path !== path) {
    return { source: "STATIC", reason: `CMS returned ${validated.value.path} for ${path}` };
  }

  return { source: "CMS", page: validated.value };
}

/**
 * How long the public site will wait for the CMS before giving up on it.
 *
 * A CMS that is *slow* is more dangerous than one that is down. A rejected
 * promise falls back immediately; a promise that never settles holds the
 * request open until something upstream times out, and what the visitor
 * eventually sees is a gateway error page rather than the static release. The
 * deadline turns the worse failure into the better one.
 */
export const CMS_LOAD_TIMEOUT_MS = 2000;

export type LoadOutcome =
  | { ok: true; payload: unknown }
  | { ok: false; reason: string };

/**
 * Awaits a CMS load with a deadline, and never rejects.
 *
 * The abandoned promise gets a no-op catch attached before the race: without
 * it, a load that times out and rejects a moment later becomes an unhandled
 * rejection, which on a worker runtime can take down the whole isolate — the
 * outage this function exists to survive.
 */
export async function loadWithDeadline(
  load: () => Promise<unknown>,
  timeoutMs = CMS_LOAD_TIMEOUT_MS,
): Promise<LoadOutcome> {
  let work: Promise<unknown>;
  try {
    work = Promise.resolve(load());
  } catch (error) {
    // A loader that throws synchronously rather than returning a rejection.
    return { ok: false, reason: `CMS load failed: ${describe(error)}` };
  }

  work.catch(() => {});

  const timedOut = Symbol("timed-out");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => resolve(timedOut), Math.max(1, timeoutMs));
  });

  let settled: unknown;
  try {
    settled = await Promise.race([work, deadline]);
  } catch (error) {
    // A CMS outage must not take the public website down with it.
    return { ok: false, reason: `CMS load failed: ${describe(error)}` };
  } finally {
    clearTimeout(timer);
  }

  if (settled === timedOut) return { ok: false, reason: `CMS did not answer within ${timeoutMs}ms` };
  if (settled === null || settled === undefined) return { ok: false, reason: "CMS returned no page" };
  return { ok: true, payload: settled };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export type PostResolution =
  | { source: "CMS"; post: PublicPost }
  | { source: "STATIC"; reason: string; violations?: ContractViolation[] };

/**
 * Resolves one post, under exactly the rules a page gets.
 *
 * The fallback differs in one way that matters: there is no static release of
 * a post to fall back TO. So a refusal here means the post is not shown at
 * all, which is why the caller must treat `STATIC` as "404 this URL" rather
 * than "render something else". Showing a stale or partial article would be
 * worse than showing none.
 */
export async function resolvePost(
  path: string,
  environment: SourceEnvironment,
  loadFromCms?: (path: string) => Promise<unknown>,
  options: ResolveOptions = {},
): Promise<PostResolution> {
  const decision = resolveContentSource(environment);
  if (decision.source === "STATIC") return { source: "STATIC", reason: decision.reason };
  if (!loadFromCms) return { source: "STATIC", reason: "no CMS loader is wired" };

  const loaded = await loadWithDeadline(() => loadFromCms(path), options.timeoutMs ?? CMS_LOAD_TIMEOUT_MS);
  if (!loaded.ok) return { source: "STATIC", reason: loaded.reason };

  const validated = validatePublicPost(loaded.payload, PUBLIC_CMS_CONTRACT_VERSION);
  if (!validated.ok) {
    return { source: "STATIC", reason: "CMS payload failed the consumer contract", violations: validated.violations };
  }
  if (validated.value.path !== path) {
    return { source: "STATIC", reason: `CMS returned ${validated.value.path} for ${path}` };
  }

  return { source: "CMS", post: validated.value };
}
