/**
 * What an editor stores for one post.
 *
 * The public shape is Lane A's `PublicPost`. This is the editable shape behind
 * it, and the two are deliberately different: an editor works with a category
 * label and an image id, while the public payload carries a resolved media
 * object and a derived path. `lib/post-cms-public.ts` converts one into the
 * other and refuses to emit anything the public contract would reject.
 *
 * `publishedAt` and `updatedAt` are not stored here. They are facts about
 * publication events, and duplicating them in the content would let a revision
 * claim a publication date it never had.
 */

import { isValidPostSlug } from "./public-cms/posts.ts";
import { CMS_ROBOTS, type CmsRobots, type CmsSection } from "./site-cms-content.ts";

// The same list managed pages use. A post and a page answer one question, and
// two lists that agree today are two lists that can stop agreeing.
export const POST_ROBOTS = CMS_ROBOTS;
export type PostRobots = CmsRobots;

export type PostCategory = { id: string; label: string };

export type PostContent = {
  version: 1;
  title: string;
  /** Shown in the index list, and the meta description when SEO omits one. */
  excerpt: string;
  category: PostCategory | null;
  featuredImageItemId: string;
  sections: CmsSection[];
  seo: { title: string; description: string; robots: PostRobots };
};

const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const sectionTypes = new Set(["HERO", "CONTENT", "FEATURES", "GALLERY", "FAQ", "CTA", "CONTACT"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Only same-origin absolute paths and the two schemes the marketing pages use.
 * An off-site href in a CTA is how a content edit becomes an open redirect.
 */
function safeHref(value: unknown): string {
  const href = bounded(value, 300);
  if (!href) return "";
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (/^(tel:|mailto:)[^\s]+$/.test(href)) return href;
  return "";
}

export function parsePostContent(input: unknown): PostContent | null {
  if (!isObject(input) || input.version !== 1 || !isObject(input.seo)) return null;

  const title = bounded(input.title, 300);
  const excerpt = bounded(input.excerpt, 500);
  // Both are what the public contract requires of every post, so a draft that
  // lacks them cannot be saved rather than failing later at publish time.
  if (title.length < 3 || excerpt.length < 20) return null;

  const seoTitle = bounded(input.seo.title, 120);
  const seoDescription = bounded(input.seo.description, 300);
  if (seoTitle.length < 5 || seoDescription.length < 20) return null;

  const robots = bounded(input.seo.robots, 20);
  if (!POST_ROBOTS.includes(robots as PostRobots)) return null;

  let category: PostCategory | null = null;
  if (input.category !== null && input.category !== undefined) {
    if (!isObject(input.category)) return null;
    const id = bounded(input.category.id, 100);
    const label = bounded(input.category.label, 80);
    if (!idPattern.test(id) || !label) return null;
    category = { id, label };
  }

  const featuredImageItemId = bounded(input.featuredImageItemId, 100);
  if (featuredImageItemId && !idPattern.test(featuredImageItemId)) return null;

  if (!Array.isArray(input.sections) || input.sections.length < 1 || input.sections.length > 20) return null;
  const ids = new Set<string>();
  const sections: CmsSection[] = [];
  for (const raw of input.sections) {
    if (!isObject(raw)) return null;
    const id = bounded(raw.id, 100);
    const type = bounded(raw.type, 30);
    if (!idPattern.test(id) || ids.has(id) || !sectionTypes.has(type)) return null;
    ids.add(id);

    const heading = bounded(raw.heading, 180);
    if (!heading) return null;
    const imageItemId = bounded(raw.imageItemId, 100);
    if (imageItemId && !idPattern.test(imageItemId)) return null;

    const primaryLabel = bounded(raw.primaryLabel, 80);
    const primaryHref = safeHref(raw.primaryHref);
    const secondaryLabel = bounded(raw.secondaryLabel, 80);
    const secondaryHref = safeHref(raw.secondaryHref);
    // A label without a target renders a dead control; a target without a label
    // renders nothing at all. Both are refused rather than silently dropped.
    if ((primaryLabel && !primaryHref) || (primaryHref && !primaryLabel)) return null;
    if ((secondaryLabel && !secondaryHref) || (secondaryHref && !secondaryLabel)) return null;

    const rawItems = Array.isArray(raw.items) ? raw.items : [];
    if (rawItems.length > 12) return null;
    const items: Array<{ title: string; body: string }> = [];
    for (const item of rawItems) {
      if (!isObject(item)) return null;
      const itemTitle = bounded(item.title, 160);
      if (!itemTitle) return null;
      items.push({ title: itemTitle, body: bounded(item.body, 500) });
    }
    if ((type === "FEATURES" || type === "FAQ") && items.length === 0) return null;

    sections.push({
      id,
      type: type as CmsSection["type"],
      enabled: raw.enabled !== false,
      eyebrow: bounded(raw.eyebrow, 100),
      heading,
      body: bounded(raw.body, 2000),
      imageItemId,
      primaryLabel,
      primaryHref,
      secondaryLabel,
      secondaryHref,
      galleryCategorySlug: "",
      galleryLimit: 12,
      items,
    });
  }
  // A post whose every section is disabled has no body at all.
  if (!sections.some((section) => section.enabled)) return null;

  return {
    version: 1,
    title,
    excerpt,
    category,
    featuredImageItemId,
    sections,
    seo: { title: seoTitle, description: seoDescription, robots: robots as PostRobots },
  };
}

export function parsePostContentJson(value: string): PostContent | null {
  if (value.length < 2 || value.length > 50_000) return null;
  try {
    return parsePostContent(JSON.parse(value));
  } catch {
    return null;
  }
}

export function serializePostContent(content: PostContent): string {
  return JSON.stringify(content);
}

/**
 * What a new post starts as. Deliberately valid: an editor should be able to
 * save immediately and refine afterwards, rather than meet a validation error
 * before writing anything.
 */
export const DEFAULT_POST_CONTENT: PostContent = {
  version: 1,
  title: "หัวข้อข่าวใหม่",
  excerpt: "สรุปสั้น ๆ ของข่าวนี้สำหรับแสดงในหน้ารวมข่าว",
  category: null,
  featuredImageItemId: "",
  sections: [
    {
      id: "body",
      type: "CONTENT",
      enabled: true,
      eyebrow: "",
      heading: "รายละเอียด",
      body: "",
      imageItemId: "",
      primaryLabel: "",
      primaryHref: "",
      secondaryLabel: "",
      secondaryHref: "",
      galleryCategorySlug: "",
      galleryLimit: 12,
      items: [],
    },
  ],
  seo: { title: "หัวข้อข่าวใหม่", description: "คำอธิบายสำหรับผลการค้นหา ควรยาวพอสมควร", robots: "INDEX" },
};

/** Re-exported so callers validate slugs with the rule the public site enforces. */
export { isValidPostSlug };
