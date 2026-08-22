// Publish -> public cache invalidation.
//
// The point of this contract is that once the CMS is live, editing a page,
// swapping a photograph or fixing a phone number must NOT require SSH, a Git
// push or a public deploy. Publishing emits an event; this file turns that
// event into the exact set of public paths whose cached copies are no longer
// true.
//
// Getting the set wrong is a real failure in both directions: too small and
// visitors keep seeing withdrawn content, too large and every edit dumps the
// whole cache. So the dependency map is explicit and tested rather than
// implied by a wildcard purge.

import { PUBLIC_ROUTE_PATHS, type PublicRoutePath } from "./contract.ts";

export type PublishEvent =
  | { kind: "PAGE_PUBLISHED"; path: PublicRoutePath; revisionId: string }
  | { kind: "PAGE_UNPUBLISHED"; path: PublicRoutePath }
  | { kind: "MEDIA_PUBLISHED"; mediaId: string; usedOnPaths: readonly PublicRoutePath[] }
  | { kind: "MEDIA_WITHDRAWN"; mediaId: string; usedOnPaths: readonly PublicRoutePath[] }
  | { kind: "SETTINGS_PUBLISHED"; revisionId: string };

// Surfaces that are derived from page content rather than authored directly.
const SITEMAP_PATH = "/sitemap.xml";
const ROBOTS_PATH = "/robots.txt";
const HOME_PATH: PublicRoutePath = "/";
const GALLERY_PATH: PublicRoutePath = "/gallery/";

export type InvalidationPlan = {
  // Exact paths whose cached responses must be dropped.
  paths: string[];
  // True when the change alters which URLs exist or may be indexed, in which
  // case the sitemap must be regenerated, not merely re-cached.
  regenerateSitemap: boolean;
  // Set when a URL stops being publicly valid and must stop returning 200.
  removedPaths: string[];
  reason: string;
};

function unique(paths: string[]): string[] {
  return [...new Set(paths)].sort();
}

/**
 * The home page shows a preview of the gallery, and the header and footer are
 * built from published settings. Those are the only cross-page dependencies
 * the public site actually has, so they are the only ones fanned out.
 */
export function planInvalidation(event: PublishEvent): InvalidationPlan {
  switch (event.kind) {
    case "PAGE_PUBLISHED": {
      const paths = [event.path];
      // A page's own copy changes what the sitemap reports as last modified.
      return {
        paths: unique(paths),
        regenerateSitemap: true,
        removedPaths: [],
        reason: `page ${event.path} published at revision ${event.revisionId}`,
      };
    }

    case "PAGE_UNPUBLISHED": {
      if (event.path === HOME_PATH) {
        // The home page is the site. Unpublishing it is not a content edit.
        return {
          paths: [],
          regenerateSitemap: false,
          removedPaths: [],
          reason: "the home page cannot be unpublished",
        };
      }
      return {
        paths: unique([event.path, SITEMAP_PATH]),
        regenerateSitemap: true,
        // The URL must stop returning 200 and must leave the sitemap, or it
        // stays indexed and keeps serving withdrawn copy.
        removedPaths: [event.path],
        reason: `page ${event.path} unpublished`,
      };
    }

    case "MEDIA_PUBLISHED":
    case "MEDIA_WITHDRAWN": {
      const affected = event.usedOnPaths.filter((path) => PUBLIC_ROUTE_PATHS.includes(path));
      // Gallery media also appears in the home page preview and the gallery
      // index, so those are invalidated even when not named explicitly.
      const paths = unique([...affected, GALLERY_PATH, HOME_PATH]);
      return {
        paths,
        regenerateSitemap: false,
        removedPaths: [],
        reason: `media ${event.mediaId} ${event.kind === "MEDIA_PUBLISHED" ? "published" : "withdrawn"}`,
      };
    }

    case "SETTINGS_PUBLISHED": {
      // Brand, navigation, telephone numbers and the footer are rendered into
      // every page, so a settings change invalidates all of them.
      return {
        paths: unique([...PUBLIC_ROUTE_PATHS, ROBOTS_PATH]),
        regenerateSitemap: true,
        removedPaths: [],
        reason: `site settings published at revision ${event.revisionId}`,
      };
    }

    default: {
      // An unrecognised event must not silently do nothing, and must not purge
      // everything either. Report it so the caller can fail loudly.
      const unknown = event as { kind?: string };
      return {
        paths: [],
        regenerateSitemap: false,
        removedPaths: [],
        reason: `unsupported publish event: ${String(unknown?.kind)}`,
      };
    }
  }
}

/**
 * True when a change can be delivered by cache invalidation alone.
 *
 * This is the promise the CMS makes to editors: ordinary content and media
 * edits go live without a deployment. Anything that changes the release
 * itself — templates, styles, scripts, the manifest — still needs the guarded
 * Z.com deploy, and saying so plainly prevents an editor from waiting forever
 * for a change that was never going to appear.
 */
export function requiresPublicDeployment(event: PublishEvent): boolean {
  const plan = planInvalidation(event);
  return plan.reason.startsWith("unsupported publish event");
}
