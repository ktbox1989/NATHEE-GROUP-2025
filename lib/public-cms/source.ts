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

// --- actually fetching from the CMS -------------------------------------------

/**
 * The loader `resolvePage` and `resolvePost` were always given by the caller,
 * which meant every transport failure was somebody else's problem: a 502 from a
 * proxy, an HTML error page where JSON was expected, a response cut off
 * mid-stream. Each of those reaches the validator as either a throw or a shape
 * that fails for a confusing reason, and one of them does not fail at all.
 *
 * The dangerous one is truncation. A response cut off mid-array can still parse
 * as valid JSON if the cut happens to land on a boundary, and what arrives is a
 * page that is *structurally correct and missing half its content*. Nothing
 * downstream can tell that from a page an editor deliberately shortened. The
 * only place it is detectable is here, against the declared content length.
 */
export const CMS_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

export type CmsFetchResult = { ok: true; payload: unknown } | { ok: false; reason: string };

export type CmsFetchOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
};

export async function fetchCmsJson(url: string, options: CmsFetchOptions = {}): Promise<CmsFetchResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return { ok: false, reason: "no fetch implementation is available" };

  const maxBytes = options.maxBytes ?? CMS_MAX_PAYLOAD_BYTES;

  const loaded = await loadWithDeadline(async () => {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      // A public page must never carry a visitor's credentials to the CMS, and
      // a cached CMS response is the stale-content bug this whole module
      // exists to prevent.
      credentials: "omit",
      cache: "no-store",
    });

    if (!response.ok) {
      // 5xx and 4xx alike: neither is content. Thrown rather than returned so
      // the deadline wrapper reports it uniformly.
      throw new Error(`CMS answered HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/^application\/json\b/i.test(contentType.trim())) {
      // A proxy error page is the usual cause, and it would otherwise reach
      // JSON.parse and fail as "unexpected token <".
      throw new Error(`CMS answered ${contentType || "no content type"}, expected application/json`);
    }

    const body = await response.text();
    const byteLength = new TextEncoder().encode(body).length;
    if (byteLength > maxBytes) {
      throw new Error(`CMS payload is ${byteLength} bytes, over the ${maxBytes} limit`);
    }

    const declared = response.headers.get("content-length");
    if (declared !== null && declared.trim() !== "") {
      const expected = Number(declared);
      if (Number.isFinite(expected) && expected !== byteLength) {
        // The case nothing downstream could catch.
        throw new Error(`CMS response was truncated: declared ${expected} bytes, received ${byteLength}`);
      }
    }

    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new Error("CMS response was not valid JSON");
    }
  }, options.timeoutMs);

  return loaded.ok ? { ok: true, payload: loaded.payload } : { ok: false, reason: loaded.reason };
}

/**
 * A loader for `resolvePage` / `resolvePost`, bound to one CMS endpoint.
 *
 * Returns null rather than throwing on failure, which both resolvers already
 * treat as "no page" and fall back on. The reason is lost at that boundary by
 * design: the resolvers report their own, and a page must not embed a CMS error
 * message in anything a visitor could see.
 */
export function createCmsLoader(
  endpoint: string,
  options: CmsFetchOptions = {},
): (path: string) => Promise<unknown> {
  return async (path: string) => {
    const url = `${endpoint.replace(/\/$/, "")}${path}`;
    const result = await fetchCmsJson(url, options);
    if (!result.ok) throw new Error(result.reason);
    return result.payload;
  };
}
