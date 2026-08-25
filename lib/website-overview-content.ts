/**
 * The shape of the Owner's website overview, and the rules for reading rows
 * into it — with no database import, so each rule is testable on its own.
 *
 * The screen this backs has one job: tell the Owner what the public is being
 * served right now, per page, without opening ten editors. Every value is a
 * fact derived from rows. Where a fact is unknown, it is reported as unknown
 * rather than as a zero, because "no posts" and "cannot read the posts" look
 * identical on a dashboard and mean opposite things.
 */

import { SITE_PAGE_DEFINITIONS, type SitePageSlug } from "./site-cms-content.ts";
import { timestampInstant } from "./timestamps.ts";

/**
 * What a reader gets for one managed page.
 *
 * SOURCE_DEFAULT is not a failure state. Every managed route has a
 * source-controlled default that has passed the release gates, and serving it
 * is what happens until someone publishes a revision.
 */
export type SitePageState = "PUBLISHED" | "HIDDEN" | "SOURCE_DEFAULT";

export type SitePageOverview = {
  slug: SitePageSlug;
  label: string;
  path: string;
  state: SitePageState;
  /** ISO-8601 of the most recent publish or hide, null when never published. */
  changedAt: string | null;
  revisionCount: number;
  /** The home page has no hide button anywhere, because the database refuses one. */
  canHide: boolean;
};

export type PostOverview = { total: number; published: number; hidden: number; draft: number };
export type MediaOverview = {
  total: number;
  publicPublished: number;
  drafts: number;
  featured: number;
  notPublic: number;
};
export type SettingsOverview = {
  published: boolean;
  revisionId: string | null;
  changedAt: string | null;
  revisionCount: number;
};

export type WebsiteOverview = {
  pages: SitePageOverview[];
  posts: PostOverview;
  media: MediaOverview;
  settings: SettingsOverview;
  /**
   * True when the content database could not be read. The screen says so rather
   * than rendering zeroes, which would read as "nothing is published" — the one
   * conclusion an Owner must not draw from an outage.
   */
  unavailable: boolean;
};

/** The one page the database refuses to hide, so the site always has a root. */
export const UNHIDEABLE_PAGE_SLUG: SitePageSlug = "home";

function toIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const instant = timestampInstant(value);
  return instant === null ? null : new Date(instant).toISOString();
}

function toCount(value: unknown): number {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
}

export type SitePageStateRow = { slug: unknown; action: unknown; changed_at: unknown; revision_count: unknown };

/**
 * Every managed route, in the order the Owner reads them, whether or not the
 * database has a row for it.
 *
 * Driven by the allowlist rather than by the table: a page that has never been
 * opened in the CMS has no row, and leaving it off the screen would hide a
 * route the public can reach.
 */
export function buildSitePageOverview(rows: ReadonlyArray<SitePageStateRow>): SitePageOverview[] {
  const bySlug = new Map<string, SitePageStateRow>();
  for (const row of rows) {
    if (typeof row.slug === "string") bySlug.set(row.slug, row);
  }

  return (Object.keys(SITE_PAGE_DEFINITIONS) as SitePageSlug[]).map((slug) => {
    const definition = SITE_PAGE_DEFINITIONS[slug];
    const row = bySlug.get(slug);
    const action = row?.action;
    const state: SitePageState = action === "PUBLISH" ? "PUBLISHED" : action === "HIDE" ? "HIDDEN" : "SOURCE_DEFAULT";
    return {
      slug,
      label: definition.label,
      path: definition.path,
      state,
      changedAt: toIso(row?.changed_at),
      revisionCount: toCount(row?.revision_count),
      canHide: slug !== UNHIDEABLE_PAGE_SLUG,
    };
  });
}

export function buildPostOverview(row: { total?: unknown; published?: unknown; hidden?: unknown } | null): PostOverview {
  const total = toCount(row?.total);
  const published = toCount(row?.published);
  const hidden = toCount(row?.hidden);
  // A post with no publication event has never been live. Derived rather than
  // counted separately so the three states always add up to the total.
  return { total, published, hidden, draft: Math.max(0, total - published - hidden) };
}

export function buildMediaOverview(
  row: { total?: unknown; public_published?: unknown; drafts?: unknown; featured?: unknown; not_public?: unknown } | null,
): MediaOverview {
  return {
    total: toCount(row?.total),
    publicPublished: toCount(row?.public_published),
    drafts: toCount(row?.drafts),
    featured: toCount(row?.featured),
    notPublic: toCount(row?.not_public),
  };
}

export function buildSettingsOverview(
  row: { revision_id?: unknown; changed_at?: unknown; revision_count?: unknown } | null,
): SettingsOverview {
  const revisionId = typeof row?.revision_id === "string" && row.revision_id.length > 0 ? row.revision_id : null;
  return {
    published: revisionId !== null,
    revisionId,
    changedAt: toIso(row?.changed_at),
    revisionCount: toCount(row?.revision_count),
  };
}

/** The overview a screen renders when the content database cannot be read. */
export function unavailableOverview(): WebsiteOverview {
  return {
    pages: buildSitePageOverview([]),
    posts: { total: 0, published: 0, hidden: 0, draft: 0 },
    media: { total: 0, publicPublished: 0, drafts: 0, featured: 0, notPublic: 0 },
    settings: { published: false, revisionId: null, changedAt: null, revisionCount: 0 },
    unavailable: true,
  };
}

/**
 * What the Owner should look at first.
 *
 * Only states that are genuinely worth acting on: a hidden page is a decision
 * someone made and it stays visible here so it cannot be forgotten, and media
 * waiting for review is work that has stalled. A page still serving its
 * source default is not listed, because that is the normal state of a site
 * nobody has edited yet and listing it would make the list noise.
 */
export function buildAttentionList(overview: WebsiteOverview): Array<{ label: string; detail: string; href: string }> {
  const attention: Array<{ label: string; detail: string; href: string }> = [];

  for (const page of overview.pages) {
    if (page.state === "HIDDEN") {
      attention.push({
        label: page.label,
        detail: "หน้านี้ถูกซ่อนอยู่ ผู้เข้าชมจะเปิดไม่ได้",
        href: `/app/site-content/${page.slug}`,
      });
    }
  }

  if (overview.media.drafts > 0) {
    attention.push({
      label: "รูปที่รอตรวจ",
      detail: `${overview.media.drafts} รูปยังเป็น Draft และยังไม่แสดงบนเว็บไซต์`,
      href: "/app/gallery",
    });
  }

  if (overview.posts.draft > 0) {
    attention.push({
      label: "บทความที่ยังไม่เผยแพร่",
      detail: `${overview.posts.draft} บทความยังไม่เคยเผยแพร่`,
      href: "/app/posts",
    });
  }

  if (!overview.settings.published) {
    attention.push({
      label: "ตั้งค่าเว็บไซต์ส่วนกลาง",
      detail: "ยังใช้ค่า Default ที่มากับระบบ ยังไม่เคยเผยแพร่ค่าที่แก้เอง",
      href: "/app/site-settings",
    });
  }

  return attention;
}
