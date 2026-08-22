// Maps Lane B's published CMS payload onto the Lane A `PublicPage` contract.
//
// Lane B owns the schema; Lane A owns what may be rendered publicly. The two
// do not line up field for field, and the honest response is to state each
// difference rather than paper over it. Every derivation below is deterministic
// and documented; nothing is invented, and nothing widens the validator — the
// mapper's output still has to pass `validatePublicPage` unchanged.
//
// Four differences and how each is handled:
//
//   1. Heading rank. B stores a section `type` (HERO, CONTENT, FEATURES…), not
//      an h2/h3 rank. Rank is a rendering decision Lane A already owns, so it
//      is derived by a fixed rule: the HERO heading becomes the page h1, every
//      other enabled section is h2, and a section's feature items are h3. That
//      is exactly the shape the current static pages already have, which the
//      content inventory verified.
//   2. Media. B stores `imageItemId`, a reference. Resolving it needs the
//      gallery, which is Lane B's data, so the caller injects a resolver. A
//      reference that cannot be resolved to alt text and real dimensions is
//      dropped, never guessed.
//   3. Path shape. B's definitions omit the trailing slash; the public routes
//      carry it.
//   4. `publishedAt` is not part of the payload, so the caller must supply it
//      from the publication event rather than the mapper inventing a time.

import {
  PUBLIC_CMS_CONTRACT_VERSION,
  PUBLIC_ROUTE_PATHS,
  validatePublicPage,
  type ContractViolation,
  type PublicMedia,
  type PublicPage,
  type PublicRoutePath,
  type PublicSection,
} from "./contract.ts";

/** The subset of Lane B's `CmsSection` this mapper consumes. */
export type CmsSectionInput = {
  id: string;
  type: string;
  enabled: boolean;
  heading: string;
  body: string;
  imageItemId: string;
  items: Array<{ title: string; body: string }>;
};

export type CmsPageInput = {
  version: number;
  seo: { title: string; description: string };
  sections: CmsSectionInput[];
};

/** Lane B's published-page state, narrowed to what the mapper needs. */
export type CmsPageStateInput = {
  status: "PUBLISHED" | "HIDDEN" | "UNMANAGED" | "BROKEN";
  content: CmsPageInput | null;
  revisionId: string | null;
};

/**
 * Resolves an `imageItemId` to public media. Supplied by the caller because
 * the gallery is Lane B's data. Returning null means "no usable media", which
 * is a normal outcome, not an error.
 */
export type MediaResolver = (imageItemId: string) => PublicMedia | null;

export type MapResult =
  | { ok: true; page: PublicPage }
  | { ok: false; reason: string; violations?: ContractViolation[] };

const HERO = "HERO";

/** B omits the trailing slash; the public routes carry it. */
export function toPublicRoutePath(cmsPath: string): PublicRoutePath | null {
  const candidate = cmsPath === "/" ? "/" : `${cmsPath.replace(/\/$/, "")}/`;
  return PUBLIC_ROUTE_PATHS.includes(candidate as PublicRoutePath) ? (candidate as PublicRoutePath) : null;
}

/**
 * Converts a gallery item into public media.
 *
 * The gallery stores absolute URLs; the contract requires same-origin paths,
 * so the origin is stripped. Missing alt text or dimensions is refused rather
 * than defaulted: an image with no alt fails the accessibility gate the live
 * site already meets.
 */
export function galleryItemToMedia(item: {
  id: string;
  altText: string;
  caption: string | null;
  thumbnailSrc: string;
  displaySrc: string;
  width: number;
  height: number;
}): PublicMedia | null {
  const toPath = (value: string) => {
    try {
      return value.startsWith("/") ? value : new URL(value).pathname;
    } catch {
      return null;
    }
  };
  const formatOf = (source: string): PublicMedia["variants"][number]["format"] | null => {
    if (source.endsWith(".webp")) return "webp";
    if (source.endsWith(".avif")) return "avif";
    if (source.endsWith(".png")) return "png";
    if (source.endsWith(".jpg") || source.endsWith(".jpeg")) return "jpeg";
    return null;
  };

  const display = toPath(item.displaySrc);
  const thumbnail = toPath(item.thumbnailSrc);
  if (!display || !item.altText?.trim()) return null;
  if (!Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width <= 0 || item.height <= 0) return null;

  const displayFormat = formatOf(display);
  if (!displayFormat) return null;

  const variants: PublicMedia["variants"] = [
    { src: display, width: item.width, height: item.height, format: displayFormat, role: "display" },
  ];
  const thumbnailFormat = thumbnail ? formatOf(thumbnail) : null;
  if (thumbnail && thumbnailFormat && thumbnail !== display) {
    variants.unshift({
      src: thumbnail,
      width: item.width,
      height: item.height,
      format: thumbnailFormat,
      role: "thumbnail",
    });
  }

  return { id: item.id, altText: item.altText.trim(), caption: item.caption?.trim() || null, variants };
}

/**
 * Maps one published CMS page. Refuses rather than guesses.
 */
export function mapCmsPageToPublicPage(input: {
  slug: string;
  cmsPath: string;
  state: CmsPageStateInput;
  publishedAt: string;
  resolveMedia?: MediaResolver;
}): MapResult {
  const { slug, cmsPath, state, publishedAt, resolveMedia } = input;

  // Only PUBLISHED renders. HIDDEN, UNMANAGED and BROKEN each mean the public
  // site must fall back, not render a default that looks authored.
  if (state.status !== "PUBLISHED" || !state.content || !state.revisionId) {
    return { ok: false, reason: `page is ${state.status.toLowerCase()}, not published` };
  }

  const path = toPublicRoutePath(cmsPath);
  if (!path) return { ok: false, reason: `"${cmsPath}" is not a public route` };

  const content = state.content;
  if (content.version !== 1) return { ok: false, reason: `unsupported CMS content version ${content.version}` };

  const enabled = content.sections.filter((section) => section.enabled);

  // The h1 comes from the HERO section. Without one there is no page heading,
  // and inventing one would put words on a customer-facing page that nobody
  // wrote.
  const hero = enabled.find((section) => section.type === HERO && section.heading?.trim());
  if (!hero) return { ok: false, reason: "no enabled HERO section supplies the page heading" };

  const sections: PublicSection[] = [];
  for (const section of enabled) {
    if (section === hero) continue;

    const media: PublicMedia[] = [];
    if (section.imageItemId && resolveMedia) {
      const resolved = resolveMedia(section.imageItemId);
      // An unresolvable reference is dropped, not faked. The section still
      // renders its text.
      if (resolved) media.push(resolved);
    }

    const body = section.body?.trim() ? [section.body.trim()] : [];
    sections.push({
      id: section.id,
      heading: section.heading?.trim() || null,
      headingLevel: 2,
      body,
      media,
    });

    // Feature items sit one rank below their section, which is how the current
    // static pages are already built.
    for (const [index, item] of (section.items ?? []).entries()) {
      if (!item?.title?.trim()) continue;
      sections.push({
        id: `${section.id}-item-${index + 1}`,
        heading: item.title.trim(),
        headingLevel: 3,
        body: item.body?.trim() ? [item.body.trim()] : [],
        media: [],
      });
    }
  }

  const candidate = {
    contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
    slug,
    path,
    status: "PUBLISHED" as const,
    heading: hero.heading.trim(),
    seo: {
      title: content.seo.title,
      description: content.seo.description,
      // A page's canonical is itself. B does not store one, and deriving it is
      // safe precisely because any other value would be wrong.
      canonicalPath: path,
      // B's managed public pages are indexable by design. NOINDEX is not
      // expressible in its payload today; see the integration document.
      robots: "INDEX" as const,
    },
    sections,
    revisionId: state.revisionId,
    publishedAt,
  };

  // The mapper gets no exemption: its output passes the same validator as any
  // other payload.
  const validated = validatePublicPage(candidate);
  if (!validated.ok) return { ok: false, reason: "mapped page failed the consumer contract", violations: validated.violations };
  return { ok: true, page: validated.value };
}
