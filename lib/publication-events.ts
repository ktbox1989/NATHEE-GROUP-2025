// The emitter the revalidation contract has been waiting for.
//
// `lib/public-cms/revalidation.ts` has always known exactly which public URLs
// a publication makes untrue. Nothing called it. Publishing wrote a durable
// event to the database and stopped there, so the promise the CMS makes to an
// Owner — edit, publish, and the public site changes without a deployment —
// was carried by no code at all.
//
// This file is the missing half, and it is deliberately pure: given what was
// published, it produces the event, asks the contract for the plan, and returns
// a bounded record of it. It performs no purge and opens no connection, because
// which cache is in front of the public site is a deployment fact rather than a
// content one. What it guarantees is that every publication computes its plan,
// that a publication the contract refuses cannot be recorded as a success, and
// that the plan is written into the audit trail where it can be replayed and
// checked afterwards.
//
// The one thing it must never do is report a plan for an event the contract
// rejected. Hiding the home page and renaming a post onto itself are both
// refusals, and treating either as "nothing needed doing" would tell an editor
// their change is live when nothing was touched.

import { PUBLIC_ROUTE_PATHS, type PublicRoutePath } from "./public-cms/contract.ts";
import { postPath } from "./public-cms/posts.ts";
import { planInvalidation, type InvalidationPlan, type PublishEvent } from "./public-cms/revalidation.ts";
import { SITE_PAGE_DEFINITIONS, type SitePageSlug } from "./site-cms-content.ts";

/**
 * The public URL a managed page is served at.
 *
 * Derived from the page definition and then checked against the closed list of
 * public routes rather than trusted: a definition that drifted would otherwise
 * produce an invalidation for a URL the public site does not serve, and the
 * plan would look correct while purging nothing that exists.
 */
export function publicPathForSitePage(slug: SitePageSlug): PublicRoutePath | null {
  const definition = SITE_PAGE_DEFINITIONS[slug];
  if (!definition) return null;
  const path = definition.path === "/" ? "/" : `${definition.path}/`;
  return PUBLIC_ROUTE_PATHS.includes(path as PublicRoutePath) ? (path as PublicRoutePath) : null;
}

export function sitePagePublishEvent(
  slug: SitePageSlug,
  action: "PUBLISH" | "HIDE",
  revisionId: string | null,
): PublishEvent | null {
  const path = publicPathForSitePage(slug);
  if (!path) return null;
  if (action === "HIDE") return { kind: "PAGE_UNPUBLISHED", path };
  if (!revisionId) return null;
  return { kind: "PAGE_PUBLISHED", path, revisionId };
}

export function postPublishEvent(
  slug: string,
  action: "PUBLISH" | "HIDE",
  revisionId: string | null,
): PublishEvent | null {
  const path = postPath(slug);
  if (action === "HIDE") return { kind: "POST_UNPUBLISHED", path };
  if (!revisionId) return null;
  return { kind: "POST_PUBLISHED", path, revisionId };
}

/**
 * A rename carries both URLs.
 *
 * Dropping either one leaves half the site serving the state from before the
 * rename: the old URL still answering with the old page, or the new URL not
 * answering at all.
 */
export function postMovedEvent(fromSlug: string, toSlug: string): PublishEvent {
  return { kind: "POST_MOVED", from: postPath(fromSlug), to: postPath(toSlug) };
}

export function siteSettingsPublishEvent(revisionId: string): PublishEvent {
  return { kind: "SETTINGS_PUBLISHED", revisionId };
}

/**
 * How many paths a recorded plan may name.
 *
 * Publishing global settings legitimately touches every public route, so the
 * bound is above that and not near it. It exists so an audit row can never grow
 * without limit if the route list ever does.
 */
export const MAX_RECORDED_INVALIDATION_PATHS = 64;

export type RecordedInvalidation = {
  /** `CACHE`, `DEPLOY` or `REJECTED`, straight from the contract. */
  delivery: InvalidationPlan["delivery"];
  paths: string[];
  removedPaths: string[];
  regenerateSitemap: boolean;
  reason: string;
  /** True when the plan named more paths than an audit row records. */
  truncated: boolean;
};

/**
 * The plan, in the shape the audit trail stores.
 *
 * Recorded rather than merely computed because "the publish succeeded" and
 * "these exact URLs stopped being true" are different facts, and only the
 * second one can be checked later against what the public site actually served.
 */
export function recordInvalidation(event: PublishEvent): RecordedInvalidation {
  const plan = planInvalidation(event);
  const paths = plan.paths.slice(0, MAX_RECORDED_INVALIDATION_PATHS);
  return {
    delivery: plan.delivery,
    paths,
    removedPaths: plan.removedPaths.slice(0, MAX_RECORDED_INVALIDATION_PATHS),
    regenerateSitemap: plan.regenerateSitemap,
    reason: plan.reason.slice(0, 300),
    truncated: plan.paths.length > paths.length,
  };
}

export type PublicationOutcome =
  | { ok: true; invalidation: RecordedInvalidation }
  | { ok: false; reason: string };

/**
 * The single decision a publish route makes about delivery.
 *
 * `CACHE` is the ordinary answer and the promise being kept: the change reaches
 * visitors without a deployment. `DEPLOY` is honest rather than fatal — the
 * content is published and the operator is told the release itself has to move
 * — so it is still a success, and the audit row says which it was.
 *
 * `REJECTED` is a refusal. The contract has decided the event is not a content
 * change at all, and letting the publication row be written anyway would record
 * a state the public site can never reach.
 */
export function decidePublication(event: PublishEvent | null): PublicationOutcome {
  if (!event) return { ok: false, reason: "the publication does not map to a public URL" };
  const invalidation = recordInvalidation(event);
  if (invalidation.delivery === "REJECTED") return { ok: false, reason: invalidation.reason };
  return { ok: true, invalidation };
}
