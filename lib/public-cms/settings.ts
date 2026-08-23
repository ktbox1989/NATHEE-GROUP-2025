// The site chrome — brand, navigation, telephone numbers, footer — as a render
// model.
//
// This is the one piece of CMS content that appears on every page, which makes
// it the one piece whose failure is total. A page whose body fails to load
// falls back to the static release and the visitor never knows. Chrome that
// fails leaves a site with no way to get anywhere, on every URL at once.
//
// So it is the only consumer in this module that has a *value* fallback rather
// than a source fallback: an unusable settings payload does not blank the
// header, it renders the known-good defaults and reports why.
//
// Lane B owns the settings schema and its parser. This owns what the public
// site will render from it, and re-checks the parts that decide where a visitor
// is sent — because a navigation item pointing into the authenticated
// application is the one mistake here that is worse than an ugly header.

import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "../site-settings-content.ts";
import { PUBLIC_ROUTE_PATHS, type PublicRoutePath } from "./contract.ts";
import { isPostPath } from "./posts.ts";

/** Prefixes a public navigation item may never point at. */
const AUTHENTICATED_PREFIXES = ["/api/", "/app/", "/auth/"] as const;

export type ChromeLink = {
  label: string;
  href: string;
  /** Emitted as `aria-current="page"`, which is how a screen reader is told. */
  current: boolean;
};

export type ChromeTelephone = {
  label: string;
  /** As written, for display. */
  display: string;
  /** As dialled: `tel:` with the separators removed. */
  href: string;
};

export type SiteChrome = {
  brand: {
    name: string;
    legalName: string;
    abbreviation: string;
    tagline: string;
    /** The link home, named for a screen reader rather than left as a logo. */
    homeLabel: string;
  };
  navigation: ChromeLink[];
  loginLabel: string;
  telephones: ChromeTelephone[];
  footer: {
    copyright: string;
    secondaryText: string;
    links: ChromeLink[];
  };
  /**
   * Null when the published settings were used as-is. Set when something was
   * refused, so the caller can log it rather than discovering a silently
   * different header.
   */
  fallbackReason: string | null;
};

/**
 * True when a navigation href may be rendered publicly.
 *
 * Deliberately stricter than "is it a valid path": it must be a same-origin
 * path, and it must lead to something the public site actually serves. A link
 * into `/app/` sends a customer to a login screen from the marketing site and
 * looks like the site is broken; a link off-site from the header is how a
 * compromised settings row becomes a phishing redirect on every page.
 */
export function isPublicNavigationHref(href: unknown): href is string {
  if (typeof href !== "string" || href.length === 0 || href.length > 200) return false;
  if (!href.startsWith("/")) return false;
  if (href.startsWith("//")) return false;
  if (href.includes("..") || href.includes("\\")) return false;
  if (AUTHENTICATED_PREFIXES.some((prefix) => href.startsWith(prefix))) return false;

  // Lane B stores paths without a trailing slash; the public routes carry one.
  const normalised = href === "/" ? "/" : `${href.replace(/\/$/, "")}/`;
  if (PUBLIC_ROUTE_PATHS.includes(normalised as PublicRoutePath)) return true;
  // Editorial routes are public too, and are not in the fixed list.
  return isPostPath(normalised);
}

/** `/services` and `/services/` are the same page; the site serves the latter. */
export function normalisePublicHref(href: string): string {
  return href === "/" ? "/" : `${href.replace(/\/$/, "")}/`;
}

function toTelephone(label: string, value: string): ChromeTelephone | null {
  const display = value.trim();
  if (!display) return null;
  const dialled = display.replace(/[\s()-]/g, "");
  // A `tel:` href with separators in it is dialled wrongly by some handsets,
  // which on a phone-first site is the difference between a call and a
  // customer giving up.
  if (!/^\+?\d{7,20}$/.test(dialled)) return null;
  return { label, display, href: `tel:${dialled}` };
}

function buildFrom(settings: SiteSettings, currentPath: string, fallbackReason: string | null): SiteChrome {
  const current = normalisePublicHref(currentPath);

  const navigation: ChromeLink[] = [];
  for (const item of settings.navigation.items) {
    if (!item?.label?.trim() || !isPublicNavigationHref(item.href)) continue;
    const href = normalisePublicHref(item.href);
    if (navigation.some((existing) => existing.href === href)) continue;
    navigation.push({ label: item.label.trim(), href, current: href === current });
  }

  const telephones = [
    toTelephone("โทรศัพท์หลัก", settings.contact.primaryPhone),
    toTelephone("โทรศัพท์สำรอง", settings.contact.secondaryPhone),
  ].filter((entry): entry is ChromeTelephone => entry !== null);

  return {
    brand: {
      name: settings.brand.name,
      legalName: settings.brand.legalName,
      abbreviation: settings.brand.abbreviation,
      tagline: settings.brand.tagline,
      homeLabel: `${settings.brand.name} หน้าแรก`,
    },
    navigation,
    loginLabel: settings.navigation.loginLabel,
    telephones,
    footer: {
      copyright: settings.footer.copyright,
      secondaryText: settings.footer.secondaryText,
      // The footer repeats the navigation minus the home link, which is the
      // brand mark directly above it.
      links: navigation.filter((link) => link.href !== "/"),
    },
    fallbackReason,
  };
}

/**
 * Builds the chrome, falling back to the shipped defaults rather than to
 * nothing.
 *
 * The three ways this refuses published settings all mean the same thing: a
 * visitor would be left with a header that cannot get them anywhere, or one
 * that sends them somewhere they should not go.
 */
export function buildSiteChrome(
  published: SiteSettings | null | undefined,
  options: { currentPath?: string } = {},
): SiteChrome {
  const currentPath = options.currentPath ?? "/";

  if (!published) {
    return buildFrom(DEFAULT_SITE_SETTINGS, currentPath, "no published settings; using the shipped defaults");
  }

  const candidate = buildFrom(published, currentPath, null);

  if (candidate.navigation.length === 0) {
    // Every item was refused. A header with no links is not a degraded header,
    // it is a site with no way out of the page you are on.
    return buildFrom(DEFAULT_SITE_SETTINGS, currentPath, "published navigation had no usable public links");
  }
  if (candidate.telephones.length === 0) {
    // The telephone numbers are the conversion path on a phone-first site, and
    // the only channel that works when the form is unavailable.
    return buildFrom(DEFAULT_SITE_SETTINGS, currentPath, "published settings carried no dialable telephone number");
  }
  if (!candidate.brand.name.trim() || !candidate.brand.legalName.trim()) {
    return buildFrom(DEFAULT_SITE_SETTINGS, currentPath, "published settings carried no brand name");
  }

  const refused = published.navigation.items.length - candidate.navigation.length;
  return refused > 0
    ? { ...candidate, fallbackReason: `${refused} navigation item(s) were refused as not publicly routable` }
    : candidate;
}
