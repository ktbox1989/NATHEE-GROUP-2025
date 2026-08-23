// The blocks the public website knows how to render.
//
// `PublicSection` describes a body of copy under a heading, which is all a page
// needed while the CMS was only ever going to supply prose. It is not enough to
// render the site that already exists: the live pages have call-to-action
// buttons, a service card grid, an FAQ accordion and a gallery block, and
// flattening those into "a heading with paragraphs under it" loses every one of
// them.
//
// That loss is measurable rather than theoretical. `mapCmsPageToPublicPage`
// reads seven of the fourteen fields on Lane B's `CmsSection` and discards the
// rest — the eyebrow, both call-to-action labels and hrefs, and the gallery
// configuration. A page published through the CMS would therefore render
// *worse* than the static page it replaced: no "ขอใบเสนอราคา" button, no FAQ
// accordion, no card grid. This file is the vocabulary that stops that.
//
// Lane A owns this vocabulary, because rendering is Lane A's side of the
// contract. Nothing here guesses Lane B's schema: the mapper converts what
// Lane B actually sends, and the block types Lane B cannot yet express are
// recorded as contract asks rather than invented.
//
// Every block validates before it renders and is refused whole if it does not.
// A refused block is not a degraded block: the page falls back to the static
// release rather than rendering a hero with no heading or a card grid with an
// empty card in it.

import {
  PUBLIC_ROUTE_PATHS,
  isNonEmptyString,
  validateMedia,
  type ContractViolation,
  type PublicMedia,
  type PublicRoutePath,
} from "./contract.ts";
import { isPostPath } from "./posts.ts";

/** Every block type the public renderer implements. */
export const PUBLIC_BLOCK_TYPES = [
  "HERO",
  "TEXT",
  "IMAGE",
  "GALLERY",
  "SERVICE_CARDS",
  "CTA",
  "FAQ",
  "CONTACT",
  "STATS",
  "VIDEO",
  "RELATED_SERVICES",
  "FEATURED_WORK",
] as const;

export type PublicBlockType = (typeof PUBLIC_BLOCK_TYPES)[number];

/**
 * A link a block may render.
 *
 * The href is held to the same rule as the navigation: a same-origin path that
 * leads somewhere the public site actually serves. A button in the middle of a
 * marketing page that sends a customer to a login screen, or off-site, is worse
 * than no button.
 */
export type BlockAction = { label: string; href: string };

export type BlockCard = {
  title: string;
  body: string;
  /** Optional; a card with no link is a description, not a dead end. */
  href: string | null;
};

export type BlockQuestion = { question: string; answer: string };

/**
 * One figure the site is willing to publish.
 *
 * `source` is required and is the whole point. The public pages already refuse
 * to state capacity numbers that have not been confirmed — "เว็บไซต์ไม่แสดง
 * ตัวเลขที่ยังไม่ยืนยัน" is on the dealer-fleet page — and a stats block is
 * precisely the shape that invites an unverified number onto the site. Making
 * the provenance a required field means an unsourced figure cannot be published
 * at all, rather than relying on whoever types it to remember the rule.
 */
export type BlockStat = { label: string; value: string; source: string };

export type PublicBlock =
  | { type: "HERO"; id: string; eyebrow: string | null; heading: string; body: string[]; media: PublicMedia | null; actions: BlockAction[] }
  | { type: "TEXT"; id: string; heading: string | null; headingLevel: 2 | 3; body: string[]; media: PublicMedia[] }
  | { type: "IMAGE"; id: string; heading: string | null; media: PublicMedia; caption: string | null }
  | { type: "GALLERY"; id: string; heading: string | null; body: string[]; categorySlug: string | null; limit: number }
  | { type: "SERVICE_CARDS"; id: string; heading: string; body: string[]; cards: BlockCard[] }
  | { type: "CTA"; id: string; heading: string; body: string[]; actions: BlockAction[] }
  | { type: "FAQ"; id: string; heading: string; questions: BlockQuestion[] }
  | { type: "CONTACT"; id: string; heading: string; body: string[] }
  | { type: "STATS"; id: string; heading: string; stats: BlockStat[] }
  | { type: "VIDEO"; id: string; heading: string | null; src: string; poster: PublicMedia; captionsSrc: string | null }
  | { type: "RELATED_SERVICES"; id: string; heading: string; links: BlockAction[] }
  | { type: "FEATURED_WORK"; id: string; heading: string; limit: number; categorySlug: string | null };

// --- shared rules ------------------------------------------------------------

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A link target the public site may send a visitor to.
 *
 * Same-origin only, and it must lead to a route that exists — one of the eleven
 * marketing routes, the news index, or a post. Anything else is refused:
 * off-site is how one edited row becomes a redirect on a marketing page, and a
 * path into the authenticated application reads to a customer as a broken site.
 */
export function isRenderableHref(href: unknown): href is string {
  if (!isNonEmptyString(href, 200)) return false;
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  if (href.includes("..") || href.includes("\\")) return false;
  const [path] = href.split("#");
  const normalised = path === "/" ? "/" : `${path.replace(/\/$/, "")}/`;
  if (PUBLIC_ROUTE_PATHS.includes(normalised as PublicRoutePath)) return true;
  return isPostPath(normalised);
}

function validateAction(input: unknown, field: string): ContractViolation[] {
  if (typeof input !== "object" || input === null) return [{ field, reason: "must be an object" }];
  const action = input as Partial<BlockAction>;
  const violations: ContractViolation[] = [];
  if (!isNonEmptyString(action.label, 80)) {
    // A button with no words on it is announced as "link" and nothing else.
    violations.push({ field: `${field}.label`, reason: "must be a non-empty label" });
  }
  if (!isRenderableHref(action.href)) {
    violations.push({ field: `${field}.href`, reason: "must be a same-origin path to a live public route" });
  }
  return violations;
}

function validateActions(input: unknown, field: string, { min = 0, max = 3 } = {}): ContractViolation[] {
  if (!Array.isArray(input)) return [{ field, reason: "must be an array" }];
  const violations: ContractViolation[] = [];
  if (input.length < min) violations.push({ field, reason: `must contain at least ${min}` });
  // More than a few buttons side by side is a choice nobody makes, and on a
  // 320px screen they stack into a wall.
  if (input.length > max) violations.push({ field, reason: `must contain at most ${max}` });
  input.forEach((action, index) => violations.push(...validateAction(action, `${field}[${index}]`)));
  return violations;
}

function validateParagraphs(input: unknown, field: string, { max = 20 } = {}): ContractViolation[] {
  if (!Array.isArray(input)) return [{ field, reason: "must be an array of paragraphs" }];
  if (input.length > max) return [{ field, reason: `must contain at most ${max} paragraphs` }];
  return input.some((paragraph) => !isNonEmptyString(paragraph, 5000))
    ? [{ field, reason: "paragraphs must be non-empty strings" }]
    : [];
}

// --- the blocks ---------------------------------------------------------------

const MAX_CARDS = 12;
const MAX_QUESTIONS = 20;
const MAX_STATS = 8;
const MAX_LINKS = 8;

function validateBlock(input: unknown, index: number): ContractViolation[] {
  const field = `blocks[${index}]`;
  if (typeof input !== "object" || input === null) return [{ field, reason: "must be an object" }];

  const block = input as Partial<PublicBlock> & { type?: string };
  const violations: ContractViolation[] = [];

  if (!PUBLIC_BLOCK_TYPES.includes(block.type as PublicBlockType)) {
    // An unknown block type is refused rather than skipped. Skipping it would
    // silently drop content an editor believes they published.
    return [{ field: `${field}.type`, reason: `must be one of ${PUBLIC_BLOCK_TYPES.join(", ")}` }];
  }
  if (!isNonEmptyString(block.id, 200)) violations.push({ field: `${field}.id`, reason: "must be a non-empty string" });

  const requireHeading = (value: unknown, name = "heading", max = 300) => {
    if (!isNonEmptyString(value, max)) violations.push({ field: `${field}.${name}`, reason: "must be a non-empty heading" });
  };
  const optionalHeading = (value: unknown, name = "heading") => {
    if (value !== null && !isNonEmptyString(value, 300)) {
      violations.push({ field: `${field}.${name}`, reason: "must be null or a non-empty string" });
    }
  };

  switch (block.type as PublicBlockType) {
    case "HERO": {
      const hero = block as Extract<PublicBlock, { type: "HERO" }>;
      // The hero supplies the page h1. Inventing one would put words on a
      // customer-facing page that nobody wrote.
      requireHeading(hero.heading);
      optionalHeading(hero.eyebrow, "eyebrow");
      violations.push(...validateParagraphs(hero.body, `${field}.body`, { max: 3 }));
      if (hero.media !== null) violations.push(...validateMedia(hero.media, `${field}.media`));
      violations.push(...validateActions(hero.actions, `${field}.actions`, { max: 2 }));
      break;
    }

    case "TEXT": {
      const text = block as Extract<PublicBlock, { type: "TEXT" }>;
      optionalHeading(text.heading);
      if (text.headingLevel !== 2 && text.headingLevel !== 3) {
        violations.push({ field: `${field}.headingLevel`, reason: "must be 2 or 3" });
      }
      if (text.heading === null && text.headingLevel === 3) {
        violations.push({ field: `${field}.headingLevel`, reason: "a block without a heading cannot be level 3" });
      }
      violations.push(...validateParagraphs(text.body, `${field}.body`));
      if (!Array.isArray(text.media)) violations.push({ field: `${field}.media`, reason: "must be an array" });
      else text.media.forEach((media, i) => violations.push(...validateMedia(media, `${field}.media[${i}]`)));
      break;
    }

    case "IMAGE": {
      const image = block as Extract<PublicBlock, { type: "IMAGE" }>;
      optionalHeading(image.heading);
      violations.push(...validateMedia(image.media, `${field}.media`));
      if (image.caption !== null && !isNonEmptyString(image.caption, 1000)) {
        violations.push({ field: `${field}.caption`, reason: "must be null or a non-empty string" });
      }
      break;
    }

    case "GALLERY": {
      const gallery = block as Extract<PublicBlock, { type: "GALLERY" }>;
      optionalHeading(gallery.heading);
      violations.push(...validateParagraphs(gallery.body, `${field}.body`, { max: 3 }));
      if (gallery.categorySlug !== null && !(typeof gallery.categorySlug === "string" && SLUG.test(gallery.categorySlug))) {
        violations.push({ field: `${field}.categorySlug`, reason: "must be null or a slug" });
      }
      if (!Number.isInteger(gallery.limit) || gallery.limit < 1 || gallery.limit > 24) {
        violations.push({ field: `${field}.limit`, reason: "must be between 1 and 24" });
      }
      break;
    }

    case "SERVICE_CARDS": {
      const cards = block as Extract<PublicBlock, { type: "SERVICE_CARDS" }>;
      requireHeading(cards.heading);
      violations.push(...validateParagraphs(cards.body, `${field}.body`, { max: 3 }));
      if (!Array.isArray(cards.cards) || cards.cards.length === 0) {
        // A card grid with no cards is an empty box with a heading over it.
        violations.push({ field: `${field}.cards`, reason: "must contain at least one card" });
      } else if (cards.cards.length > MAX_CARDS) {
        violations.push({ field: `${field}.cards`, reason: `must contain at most ${MAX_CARDS} cards` });
      } else {
        cards.cards.forEach((card, i) => {
          const at = `${field}.cards[${i}]`;
          if (!isNonEmptyString(card?.title, 160)) violations.push({ field: `${at}.title`, reason: "must be a non-empty title" });
          if (!isNonEmptyString(card?.body, 500)) violations.push({ field: `${at}.body`, reason: "must be a non-empty description" });
          if (card?.href !== null && !isRenderableHref(card?.href)) {
            violations.push({ field: `${at}.href`, reason: "must be null or a same-origin path to a live public route" });
          }
        });
      }
      break;
    }

    case "CTA": {
      const cta = block as Extract<PublicBlock, { type: "CTA" }>;
      requireHeading(cta.heading);
      violations.push(...validateParagraphs(cta.body, `${field}.body`, { max: 3 }));
      // A call to action with nothing to act on is the one block that is
      // pointless without its links.
      violations.push(...validateActions(cta.actions, `${field}.actions`, { min: 1, max: 2 }));
      break;
    }

    case "FAQ": {
      const faq = block as Extract<PublicBlock, { type: "FAQ" }>;
      requireHeading(faq.heading);
      if (!Array.isArray(faq.questions) || faq.questions.length === 0) {
        violations.push({ field: `${field}.questions`, reason: "must contain at least one question" });
      } else if (faq.questions.length > MAX_QUESTIONS) {
        violations.push({ field: `${field}.questions`, reason: `must contain at most ${MAX_QUESTIONS}` });
      } else {
        faq.questions.forEach((entry, i) => {
          const at = `${field}.questions[${i}]`;
          if (!isNonEmptyString(entry?.question, 300)) violations.push({ field: `${at}.question`, reason: "must be a non-empty question" });
          // A question published with no answer reads as an oversight and is
          // emitted into FAQPage structured data, where it is worse.
          if (!isNonEmptyString(entry?.answer, 2000)) violations.push({ field: `${at}.answer`, reason: "must be a non-empty answer" });
        });
      }
      break;
    }

    case "CONTACT": {
      const contact = block as Extract<PublicBlock, { type: "CONTACT" }>;
      requireHeading(contact.heading);
      violations.push(...validateParagraphs(contact.body, `${field}.body`, { max: 5 }));
      // The telephone numbers are not part of the block: they come from
      // published site settings, so an editor changing them changes them
      // everywhere at once rather than in one block they remembered.
      break;
    }

    case "STATS": {
      const stats = block as Extract<PublicBlock, { type: "STATS" }>;
      requireHeading(stats.heading);
      if (!Array.isArray(stats.stats) || stats.stats.length === 0) {
        violations.push({ field: `${field}.stats`, reason: "must contain at least one figure" });
      } else if (stats.stats.length > MAX_STATS) {
        violations.push({ field: `${field}.stats`, reason: `must contain at most ${MAX_STATS}` });
      } else {
        stats.stats.forEach((stat, i) => {
          const at = `${field}.stats[${i}]`;
          if (!isNonEmptyString(stat?.label, 120)) violations.push({ field: `${at}.label`, reason: "must be a non-empty label" });
          if (!isNonEmptyString(stat?.value, 40)) violations.push({ field: `${at}.value`, reason: "must be a non-empty value" });
          if (!isNonEmptyString(stat?.source, 200)) {
            // The site already refuses to publish unconfirmed capacity numbers.
            // Requiring provenance makes that a property of the data rather
            // than something whoever types it has to remember.
            violations.push({ field: `${at}.source`, reason: "must name where the figure comes from" });
          }
        });
      }
      break;
    }

    case "VIDEO": {
      const video = block as Extract<PublicBlock, { type: "VIDEO" }>;
      optionalHeading(video.heading);
      violations.push(...validateVideoSrc(video.src, `${field}.src`));
      // A poster is required, with real dimensions, because a video element
      // with none reserves no space and the page reflows when it loads.
      violations.push(...validateMedia(video.poster, `${field}.poster`));
      if (video.captionsSrc !== null) {
        if (!isNonEmptyString(video.captionsSrc, 2048) || !video.captionsSrc.startsWith("/assets/") || !video.captionsSrc.endsWith(".vtt")) {
          violations.push({ field: `${field}.captionsSrc`, reason: "must be null or a .vtt file under /assets/" });
        }
      }
      break;
    }

    case "RELATED_SERVICES": {
      const related = block as Extract<PublicBlock, { type: "RELATED_SERVICES" }>;
      requireHeading(related.heading);
      violations.push(...validateActions(related.links, `${field}.links`, { min: 1, max: MAX_LINKS }));
      break;
    }

    case "FEATURED_WORK": {
      const featured = block as Extract<PublicBlock, { type: "FEATURED_WORK" }>;
      requireHeading(featured.heading);
      if (!Number.isInteger(featured.limit) || featured.limit < 1 || featured.limit > 12) {
        violations.push({ field: `${field}.limit`, reason: "must be between 1 and 12" });
      }
      if (featured.categorySlug !== null && !(typeof featured.categorySlug === "string" && SLUG.test(featured.categorySlug))) {
        violations.push({ field: `${field}.categorySlug`, reason: "must be null or a slug" });
      }
      break;
    }
  }

  return violations;
}

/**
 * Video sources the public site can actually play.
 *
 * Self-hosted only, and this is not a preference. The public site's
 * Content-Security-Policy declares `default-src 'self'` and states neither
 * `frame-src` nor `media-src`, so both fall back to it: an embedded YouTube or
 * Vimeo player is blocked by the browser and renders as an empty box, and an
 * external `<video src>` never loads. Accepting an embed URL here would let an
 * editor publish a video that cannot play, and find out from a customer.
 *
 * Allowing one would be a security decision about the CSP, not a content
 * decision, so it is refused here and recorded as a contract ask.
 */
export function validateVideoSrc(src: unknown, field: string): ContractViolation[] {
  if (!isNonEmptyString(src, 2048)) return [{ field, reason: "must be a non-empty string" }];
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src) || src.startsWith("//")) {
    return [{ field, reason: "must be a same-origin path; the public CSP blocks external media and embeds" }];
  }
  if (src.includes("..")) return [{ field, reason: "must not contain a path traversal" }];
  if (!src.startsWith("/assets/")) return [{ field, reason: "must start with /assets/" }];
  if (!/\.(?:mp4|webm)$/.test(src)) return [{ field, reason: "must be an .mp4 or .webm file" }];
  return [];
}

/** The rank each block emits for its own heading, given the h1 above it. */
export function headingLevelOf(block: PublicBlock): 1 | 2 | 3 | null {
  if (block.type === "HERO") return 1;
  if (block.type === "TEXT") return block.heading === null ? null : block.headingLevel;
  if (block.type === "IMAGE" || block.type === "GALLERY") return block.heading === null ? null : 2;
  return 2;
}

export type BlocksValidation =
  | { ok: true; blocks: PublicBlock[] }
  | { ok: false; violations: ContractViolation[] };

/**
 * Validates a whole body of blocks, and the outline they produce together.
 *
 * The outline rules are the site's, not this file's: exactly one h1, and no
 * skipped level. They are checked here as well as per block because neither
 * defect is visible from inside a single block — two heroes are each valid
 * alone, and so is an h3 that happens to follow an h1.
 */
export function validateBlocks(input: unknown, options: { requireHero?: boolean } = {}): BlocksValidation {
  if (!Array.isArray(input)) return { ok: false, violations: [{ field: "blocks", reason: "must be an array" }] };

  const violations: ContractViolation[] = [];
  input.forEach((block, index) => violations.push(...validateBlock(block, index)));

  const heroes = input.filter((block) => (block as PublicBlock)?.type === "HERO");
  if (options.requireHero !== false && heroes.length !== 1) {
    violations.push({ field: "blocks", reason: `must contain exactly one HERO, found ${heroes.length}` });
  }
  if (heroes.length > 0 && (input[0] as PublicBlock)?.type !== "HERO") {
    // An h1 that is not the first heading on the page produces an outline that
    // opens at h2, which is the defect the section validator already refuses.
    violations.push({ field: "blocks[0]", reason: "the HERO must be the first block" });
  }

  let previous = 1;
  input.forEach((block, index) => {
    // Only entries that are already a recognisable block contribute to the
    // outline. A null or an unknown type has been refused above, and asking it
    // for a heading rank would throw rather than report — turning a malformed
    // payload into a crash instead of a fallback.
    if (typeof block !== "object" || block === null) return;
    if (!PUBLIC_BLOCK_TYPES.includes((block as PublicBlock).type)) return;

    const level = headingLevelOf(block as PublicBlock);
    if (level === null || level === 1) return;
    if (level - previous > 1) {
      violations.push({ field: `blocks[${index}]`, reason: `heading order jumps h${previous} to h${level}` });
    }
    previous = level;
  });

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, blocks: input as PublicBlock[] };
}

/**
 * Every media source a body of blocks would render.
 *
 * Used by the invalidation planner and by the media gate: knowing which
 * photographs a page depends on is what makes "invalidate the pages that show
 * this image" possible without a wildcard purge.
 */
export function mediaSourcesOf(blocks: ReadonlyArray<PublicBlock>): string[] {
  const sources: string[] = [];
  for (const block of blocks) {
    if (block.type === "HERO" && block.media) sources.push(...block.media.variants.map((variant) => variant.src));
    if (block.type === "TEXT") for (const media of block.media) sources.push(...media.variants.map((variant) => variant.src));
    if (block.type === "IMAGE") sources.push(...block.media.variants.map((variant) => variant.src));
    if (block.type === "VIDEO") {
      sources.push(block.src, ...block.poster.variants.map((variant) => variant.src));
      if (block.captionsSrc) sources.push(block.captionsSrc);
    }
  }
  return [...new Set(sources)].sort();
}
