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
import { POSTS_INDEX_PATH, isPostPath } from "./posts.ts";
import { WORK_INDEX_PATH, isWorkPath } from "./portfolio.ts";

export type PublishEvent =
  | { kind: "PAGE_PUBLISHED"; path: PublicRoutePath; revisionId: string }
  | { kind: "PAGE_UNPUBLISHED"; path: PublicRoutePath }
  | { kind: "MEDIA_PUBLISHED"; mediaId: string; usedOnPaths: readonly PublicRoutePath[] }
  | { kind: "MEDIA_WITHDRAWN"; mediaId: string; usedOnPaths: readonly PublicRoutePath[] }
  | { kind: "SETTINGS_PUBLISHED"; revisionId: string }
  // Editorial content. A post is its own URL rather than one of the eleven
  // known routes, so the path is carried and checked rather than typed.
  | { kind: "POST_PUBLISHED"; path: string; revisionId: string }
  | { kind: "POST_UNPUBLISHED"; path: string }
  | { kind: "POST_MOVED"; from: string; to: string }
  // Portfolio entries. Same shape as posts, and for the same reason: a work
  // item is its own URL rather than one of the eleven known routes.
  | { kind: "WORK_PUBLISHED"; path: string; revisionId: string }
  | { kind: "WORK_UNPUBLISHED"; path: string }
  | { kind: "WORK_MOVED"; from: string; to: string };

// Surfaces that are derived from page content rather than authored directly.
const SITEMAP_PATH = "/sitemap.xml";
const ROBOTS_PATH = "/robots.txt";
const HOME_PATH: PublicRoutePath = "/";
const GALLERY_PATH: PublicRoutePath = "/gallery/";

export type InvalidationPlan = {
  /**
   * How this change reaches visitors.
   *
   * `CACHE` is the promise the CMS makes to editors: content and media go live
   * with no deployment. `DEPLOY` means the change is in the release itself —
   * templates, styles, scripts, the manifest — and needs the guarded Z.com
   * deploy. `REJECTED` means the event was malformed, which is neither: a
   * deployment would not fix it, and pretending it succeeded would tell an
   * editor their change is live when no cache was touched.
   *
   * Stated as a field rather than inferred from the reason string, because a
   * caller deciding whether to deploy should not be matching on prose.
   */
  delivery: "CACHE" | "DEPLOY" | "REJECTED";
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
 * A malformed event drops nothing and purges nothing.
 *
 * Both alternatives are wrong: purging everything turns a typo into a full
 * cache miss for the whole site, and silently succeeding tells an editor their
 * change is live when no cache was touched. Reporting it lets the caller fail
 * loudly, which is the only honest option.
 */
function refuse(reason: string): InvalidationPlan {
  return { delivery: "REJECTED", paths: [], regenerateSitemap: false, removedPaths: [], reason };
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
        delivery: "CACHE",
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
          delivery: "REJECTED",
          paths: [],
          regenerateSitemap: false,
          removedPaths: [],
          reason: "the home page cannot be unpublished",
        };
      }
      return {
        delivery: "CACHE",
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
        delivery: "CACHE",
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
        delivery: "CACHE",
        paths: unique([...PUBLIC_ROUTE_PATHS, ROBOTS_PATH]),
        regenerateSitemap: true,
        removedPaths: [],
        reason: `site settings published at revision ${event.revisionId}`,
      };
    }

    case "POST_PUBLISHED": {
      if (!isPostPath(event.path) || event.path === POSTS_INDEX_PATH) {
        return refuse(`"${event.path}" is not a post path`);
      }
      // The index lists the post, and the sitemap gains a URL. Nothing else
      // shows posts today, and fanning out further would dump the cache on
      // every editorial edit.
      return {
        delivery: "CACHE",
        paths: unique([event.path, POSTS_INDEX_PATH]),
        regenerateSitemap: true,
        removedPaths: [],
        reason: `post ${event.path} published at revision ${event.revisionId}`,
      };
    }

    case "POST_UNPUBLISHED": {
      if (!isPostPath(event.path) || event.path === POSTS_INDEX_PATH) {
        return refuse(`"${event.path}" is not a post path`);
      }
      return {
        delivery: "CACHE",
        paths: unique([event.path, POSTS_INDEX_PATH, SITEMAP_PATH]),
        regenerateSitemap: true,
        // The URL must stop returning 200 and must leave the sitemap, or it
        // stays indexed and keeps serving withdrawn copy.
        removedPaths: [event.path],
        reason: `post ${event.path} unpublished`,
      };
    }

    case "POST_MOVED": {
      if (!isPostPath(event.from) || !isPostPath(event.to)) {
        return refuse(`"${event.from}" -> "${event.to}" is not a post rename`);
      }
      if (event.from === event.to) return refuse("a post cannot be renamed to itself");
      // Both URLs change behaviour: the old one starts redirecting and the new
      // one starts answering. Dropping only one of them leaves half the site
      // serving the state from before the rename.
      return {
        delivery: "CACHE",
        paths: unique([event.from, event.to, POSTS_INDEX_PATH, SITEMAP_PATH]),
        regenerateSitemap: true,
        // The old URL is not removed: it must answer with a 301 rather than a
        // 404, which is what carries the inbound links to the new slug.
        removedPaths: [],
        reason: `post moved from ${event.from} to ${event.to}`,
      };
    }

    case "WORK_PUBLISHED": {
      if (!isWorkPath(event.path) || event.path === WORK_INDEX_PATH) {
        return refuse(`"${event.path}" is not a work path`);
      }
      // The entry and the index that lists it. The home page carries a gallery
      // preview rather than a portfolio preview, so it is not affected.
      return {
        delivery: "CACHE",
        paths: unique([event.path, WORK_INDEX_PATH]),
        regenerateSitemap: true,
        removedPaths: [],
        reason: `work ${event.path} published at revision ${event.revisionId}`,
      };
    }

    case "WORK_UNPUBLISHED": {
      if (!isWorkPath(event.path) || event.path === WORK_INDEX_PATH) {
        return refuse(`"${event.path}" is not a work path`);
      }
      return {
        delivery: "CACHE",
        paths: unique([event.path, WORK_INDEX_PATH, SITEMAP_PATH]),
        regenerateSitemap: true,
        removedPaths: [event.path],
        reason: `work ${event.path} unpublished`,
      };
    }

    case "WORK_MOVED": {
      if (!isWorkPath(event.from) || !isWorkPath(event.to)) {
        return refuse(`"${event.from}" -> "${event.to}" is not a work rename`);
      }
      if (event.from === event.to) return refuse("a work item cannot be renamed to itself");
      return {
        delivery: "CACHE",
        paths: unique([event.from, event.to, WORK_INDEX_PATH, SITEMAP_PATH]),
        regenerateSitemap: true,
        // The old URL keeps answering, with a 301, so inbound links survive.
        removedPaths: [],
        reason: `work moved from ${event.from} to ${event.to}`,
      };
    }

    default: {
      // An unrecognised event must not silently do nothing, and must not purge
      // everything either. Report it so the caller can fail loudly.
      const unknown = event as { kind?: string };
      return {
        // The release itself may need to change; the caller must decide, and
        // must not conclude from silence that nothing was required.
        delivery: "DEPLOY",
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
  return planInvalidation(event).delivery === "DEPLOY";
}

/**
 * True when the event was refused outright: a post path that is not one, a
 * rename to itself, or unpublishing the home page. The caller must surface
 * this rather than treating an empty plan as "nothing needed doing".
 */
export function wasRejected(event: PublishEvent): boolean {
  return planInvalidation(event).delivery === "REJECTED";
}
