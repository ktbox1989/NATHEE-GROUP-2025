// The public gallery, from the consumer side.
//
// The photographs are the sales asset: a customer decides whether this company
// can move forty motorcycles by looking at a picture of it being done. So the
// gallery gets the same treatment as the rest of the public contract — what may
// appear, in what order, and what happens when one image is broken.
//
// It is also the single highest-risk surface on the site. The same media
// library holds customer photographs, inspection evidence, proof-of-delivery
// images and signatures. Lane B marks those with a visibility, and this file
// does not take that marking on trust: an item must be BOTH published AND
// publicly visible, and its every source must still be a public asset path.
// Two independent conditions, because one flipped column should not be enough
// to put a customer's motorcycle on a marketing page.

import {
  isNonEmptyString,
  validateMedia,
  type ContractViolation,
  type PublicMedia,
} from "./contract.ts";
import { buildMediaRenderModel, type MediaRenderModel, type MediaRenderOptions } from "./media.ts";

/** The only state and visibility pair that may be rendered publicly. */
export const PUBLIC_GALLERY_STATUS = "PUBLISHED";
export const PUBLIC_GALLERY_VISIBILITY = "PUBLIC";

/**
 * Every visibility that exists in the media library, and whether the public
 * site may render it. Written out rather than implied by a `!== PUBLIC` check
 * so that a visibility added later is a compile-time and test-time decision
 * instead of silently defaulting to visible.
 */
export const GALLERY_VISIBILITY_IS_PUBLIC: Readonly<Record<string, boolean>> = Object.freeze({
  PUBLIC: true,
  // Photographs of a customer's own motorcycles, taken for their job record.
  CUSTOMER_JOB: false,
  // Inspection findings, proof of delivery, signatures, internal documents.
  INTERNAL: false,
});

export type PublicGalleryCategory = { id: string; label: string };

export type PublicGalleryItem = {
  id: string;
  title: string;
  media: PublicMedia;
  category: PublicGalleryCategory | null;
  featured: boolean;
  order: number;
};

/** The subset of Lane B's gallery item this consumer reads. */
export type CmsGalleryItemInput = {
  id: string;
  title: string;
  status: string;
  visibility: string;
  altText: string;
  caption: string | null;
  categoryId: string | null;
  categoryLabel: string | null;
  featured: boolean;
  order: number;
  variants: PublicMedia["variants"];
};

export type GalleryItemResult =
  | { ok: true; item: PublicGalleryItem }
  | { ok: false; reason: string; violations?: ContractViolation[] };

/**
 * Converts one library item into something publishable, or refuses it.
 *
 * A refusal is a normal outcome — most of the library is not public — so it
 * carries a reason rather than throwing.
 */
export function toPublicGalleryItem(input: CmsGalleryItemInput): GalleryItemResult {
  if (input?.status !== PUBLIC_GALLERY_STATUS) {
    return { ok: false, reason: `item is ${String(input?.status).toLowerCase()}, not published` };
  }
  // Unknown visibilities are refused, not tolerated. A value this file has
  // never heard of is exactly the case where guessing is most expensive.
  if (GALLERY_VISIBILITY_IS_PUBLIC[input.visibility] !== true) {
    return { ok: false, reason: `visibility ${String(input.visibility)} is not public` };
  }

  if (!isNonEmptyString(input.id, 200)) return { ok: false, reason: "item has no id" };
  if (!isNonEmptyString(input.title, 200)) return { ok: false, reason: "item has no title" };

  const media: PublicMedia = {
    id: input.id,
    altText: input.altText,
    caption: input.caption?.trim() ? input.caption.trim() : null,
    variants: Array.isArray(input.variants) ? input.variants : [],
  };

  // The second condition. Even a PUBLIC, PUBLISHED item is refused if any of
  // its sources is not a public asset path, which is what stops a mislabelled
  // inspection photograph from reaching a visitor.
  const violations = validateMedia(media, "media");
  if (violations.length > 0) return { ok: false, reason: "media failed the public contract", violations };

  const category =
    input.categoryId && input.categoryLabel
      ? { id: input.categoryId, label: input.categoryLabel }
      : null;

  return {
    ok: true,
    item: {
      id: input.id,
      title: input.title.trim(),
      media,
      category,
      featured: input.featured === true,
      order: Number.isFinite(input.order) ? Number(input.order) : Number.MAX_SAFE_INTEGER,
    },
  };
}

/**
 * Featured first, then the editor's order, then the id.
 *
 * The id tie-break is what the static release lacked and needs: two items
 * given the same order number would otherwise sort differently on each render,
 * so the "load more" button would show a duplicate and hide something else.
 */
export function compareGalleryItems(left: PublicGalleryItem, right: PublicGalleryItem): number {
  if (left.featured !== right.featured) return left.featured ? -1 : 1;
  if (left.order !== right.order) return left.order - right.order;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export const GALLERY_INITIAL_LIMIT = 24;

export type GalleryFilter = PublicGalleryCategory & { count: number; active: boolean };

export type GalleryCardView = {
  id: string;
  title: string;
  caption: string | null;
  categoryLabel: string;
  image: MediaRenderModel;
};

export type GalleryView = {
  filters: GalleryFilter[];
  cards: GalleryCardView[];
  shown: number;
  matching: number;
  total: number;
  hasMore: boolean;
  /** Set when there is nothing to show, so the page can say why. */
  emptyReason: string | null;
  /** Items that could not be rendered, reported rather than silently missing. */
  skipped: Array<{ id: string; reason: string }>;
};

export type GalleryViewOptions = {
  /** Category id, or "all". An unknown id falls back to everything. */
  activeCategory?: string;
  limit?: number;
  /** Label used when an item's category is missing from the category list. */
  fallbackCategoryLabel?: string;
  mediaOptions?: MediaRenderOptions;
};

const ALL = "all";

/**
 * Builds everything the gallery page renders: the filter row, the visible
 * cards, and whether there is more to load.
 *
 * An unknown category falls back to showing everything rather than an empty
 * page. A stale link to a category the Owner has since emptied is a normal
 * event, and showing the whole gallery is a better answer than a dead end.
 */
export function buildGalleryView(
  items: ReadonlyArray<PublicGalleryItem>,
  options: GalleryViewOptions = {},
): GalleryView {
  const limit = Number.isInteger(options.limit) && options.limit! > 0 ? options.limit! : GALLERY_INITIAL_LIMIT;
  const fallbackLabel = options.fallbackCategoryLabel ?? "ผลงานจริง";

  const ordered = [...items].sort(compareGalleryItems);

  // Only categories that actually have a published item are offered. A filter
  // that leads to an empty grid is worse than no filter.
  const counts = new Map<string, GalleryFilter>();
  for (const item of ordered) {
    if (!item.category) continue;
    const existing = counts.get(item.category.id);
    if (existing) existing.count += 1;
    else counts.set(item.category.id, { ...item.category, count: 1, active: false });
  }

  const requested = options.activeCategory ?? ALL;
  const active = requested !== ALL && counts.has(requested) ? requested : ALL;

  const filters: GalleryFilter[] = [
    { id: ALL, label: "ทั้งหมด", count: ordered.length, active: active === ALL },
    ...[...counts.values()]
      .sort((left, right) => left.label.localeCompare(right.label, "th"))
      .map((filter) => ({ ...filter, active: filter.id === active })),
  ];

  const matching = active === ALL ? ordered : ordered.filter((item) => item.category?.id === active);

  const cards: GalleryCardView[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const item of matching.slice(0, limit)) {
    // Only the first image of the first screen is worth loading eagerly.
    const result = buildMediaRenderModel(item.media, {
      ...options.mediaOptions,
      priority: options.mediaOptions?.priority === true && cards.length === 0,
    });
    if (!result.ok) {
      // One unrenderable photograph does not empty the gallery.
      skipped.push({ id: item.id, reason: result.reason });
      continue;
    }
    cards.push({
      id: item.id,
      title: item.title,
      caption: item.media.caption,
      categoryLabel: item.category?.label ?? fallbackLabel,
      image: result.model,
    });
  }

  const emptyReason =
    cards.length > 0
      ? null
      : items.length === 0
        ? "ยังไม่มีภาพที่เผยแพร่"
        : matching.length === 0
          ? "ยังไม่มีภาพที่เผยแพร่ในหมวดนี้"
          : "ไม่สามารถแสดงภาพในหมวดนี้ได้";

  return {
    filters,
    cards,
    shown: cards.length,
    matching: matching.length,
    total: ordered.length,
    // Measured against what matched, not against what rendered: an item that
    // was skipped is still past, so "load more" must not offer it again.
    hasMore: matching.length > limit,
    emptyReason,
    skipped,
  };
}

// --- the lightbox -----------------------------------------------------------

export type LightboxAction = "CLOSE" | "PREVIOUS" | "NEXT";

/**
 * The keys the lightbox answers. Stated as data so the behaviour can be tested
 * without a browser, and so the static release and any future rendered version
 * cannot answer different keys.
 */
export const LIGHTBOX_KEYS: Readonly<Record<string, LightboxAction>> = Object.freeze({
  Escape: "CLOSE",
  ArrowLeft: "PREVIOUS",
  ArrowRight: "NEXT",
});

/**
 * A horizontal drag shorter than this is a tap that wandered, not a swipe.
 * Below about this distance the gallery would advance while someone was trying
 * to scroll, which on a phone makes the page feel broken.
 */
export const LIGHTBOX_SWIPE_MIN_PX = 48;

export type LightboxModel = {
  index: number;
  total: number;
  current: { id: string; title: string; caption: string | null; image: MediaRenderModel };
  previousIndex: number;
  nextIndex: number;
  keyboard: Readonly<Record<string, LightboxAction>>;
  gestures: { swipeLeft: LightboxAction; swipeRight: LightboxAction; minimumDistancePx: number };
  focus: {
    /** Focus moves here on open, so the keyboard user is inside the dialog. */
    initial: "close";
    /** Tab cycles within these and never escapes to the page behind. */
    trap: ReadonlyArray<"close" | "previous" | "next">;
    /** On close, focus returns to whatever opened the lightbox. */
    restoreToOpener: true;
  };
  labels: { close: string; previous: string; next: string; position: string };
};

/**
 * The lightbox at one position.
 *
 * Navigation wraps, so arrowing past either end is never a dead key. The image
 * is rendered at display size and eagerly: the visitor asked for this exact
 * photograph, so lazily loading it would show them an empty dialog.
 */
export function buildLightbox(view: GalleryView, index: number): LightboxModel | null {
  const total = view.cards.length;
  if (total === 0 || !Number.isInteger(index) || index < 0 || index >= total) return null;

  const card = view.cards[index];
  const full = { ...card.image, img: { ...card.image.img, loading: "eager" as const, src: card.image.lightbox.fullSrc } };

  return {
    index,
    total,
    current: { id: card.id, title: card.title, caption: card.caption, image: full },
    previousIndex: (index - 1 + total) % total,
    nextIndex: (index + 1) % total,
    keyboard: LIGHTBOX_KEYS,
    gestures: { swipeLeft: "NEXT", swipeRight: "PREVIOUS", minimumDistancePx: LIGHTBOX_SWIPE_MIN_PX },
    focus: { initial: "close", trap: ["close", "previous", "next"], restoreToOpener: true },
    labels: {
      close: "ปิด",
      previous: "ภาพก่อนหน้า",
      next: "ภาพถัดไป",
      // Announced to a screen reader, which otherwise has no way to know how
      // far through a set of forty photographs it is.
      position: `ภาพที่ ${index + 1} จาก ${total}`,
    },
  };
}

/** Applies one key or gesture, returning the new index or null to close. */
export function reduceLightbox(model: LightboxModel, action: LightboxAction): number | null {
  if (action === "CLOSE") return null;
  return action === "PREVIOUS" ? model.previousIndex : model.nextIndex;
}
