// Maps Lane B's published sections onto the blocks the public site renders.
//
// `mapCmsPageToPublicPage` reads seven of the fourteen fields on a `CmsSection`
// and drops the rest. That was defensible while `PublicPage` had nowhere to put
// them; it is not defensible now, because what it drops is exactly what makes
// the live pages work:
//
//   eyebrow              the small label above every page heading
//   primaryLabel/Href    the "ขอใบเสนอราคา" button
//   secondaryLabel/Href  the second call to action
//   galleryCategorySlug  which photographs a gallery block shows
//   galleryLimit         how many
//
// and `type` was read only to find the HERO, after which a FAQ, a card grid and
// a gallery all became a generic h2 with paragraphs under it. A page published
// through the CMS would have rendered worse than the static page it replaced.
//
// This maps each of Lane B's seven section types onto the block that renders
// it. Nothing is invented: the four block types Lane B has no section type for
// — STATS, VIDEO, RELATED_SERVICES, FEATURED_WORK — are simply never produced
// here, and are recorded as contract asks instead.

import type { PublicMedia } from "./contract.ts";
import { isRenderableHref, validateBlocks, type BlockAction, type PublicBlock } from "./blocks.ts";
import type { ContractViolation } from "./contract.ts";
import type { CmsSectionInput, MediaResolver } from "./map-from-cms.ts";

/** Lane B's section types, and the block each one renders as. */
export const CMS_SECTION_BLOCK_TYPES: Readonly<Record<string, PublicBlock["type"]>> = Object.freeze({
  HERO: "HERO",
  CONTENT: "TEXT",
  FEATURES: "SERVICE_CARDS",
  GALLERY: "GALLERY",
  FAQ: "FAQ",
  CTA: "CTA",
  CONTACT: "CONTACT",
});

/**
 * Block types the public site can render and Lane B cannot yet describe.
 *
 * Exported so the omission is a stated, tested decision rather than something
 * that looks like an oversight. Producing any of these from today's payload
 * would mean inventing content.
 */
export const BLOCKS_LANE_B_CANNOT_EXPRESS: ReadonlyArray<{ block: PublicBlock["type"]; reason: string }> =
  Object.freeze([
    Object.freeze({
      block: "STATS",
      reason: "no section type carries a figure with its provenance, and an unsourced number must not be published",
    }),
    Object.freeze({
      block: "VIDEO",
      reason: "no section type carries a media file, a poster and a captions track",
    }),
    Object.freeze({
      block: "RELATED_SERVICES",
      reason: "no section type carries a list of links; FEATURES carries cards with prose",
    }),
    Object.freeze({
      block: "FEATURED_WORK",
      reason: "no portfolio schema exists yet on Lane B's side",
    }),
    // A CONTENT section carrying an image maps to TEXT, which renders the copy
    // and the photograph together. A standalone image with nothing but a
    // caption has no section type of its own, so the block exists for posts and
    // portfolio entries rather than for a page payload.
    Object.freeze({
      block: "IMAGE",
      reason: "a CONTENT section carrying an image maps to TEXT; Lane B has no standalone-image section type",
    }),
  ]);

/** `/services` from Lane B becomes `/services/`, which is what the site serves. */
function toRenderableHref(href: string): string | null {
  const trimmed = href?.trim();
  if (!trimmed) return null;
  const [path, hash] = trimmed.split("#");
  const normalised = path === "/" ? "/" : `${path.replace(/\/$/, "")}/`;
  const candidate = hash ? `${normalised}#${hash}` : normalised;
  return isRenderableHref(candidate) ? candidate : null;
}

/**
 * Builds the actions a section declares.
 *
 * Lane B's parser already refuses a label without an href and an href without a
 * label, so a half-filled pair cannot arrive. What can arrive is a well-formed
 * link to somewhere the public site does not serve, and that is dropped rather
 * than rendered: a button on a marketing page that leads nowhere is worse than
 * one fewer button.
 */
function actionsOf(section: CmsSectionInput): BlockAction[] {
  const actions: BlockAction[] = [];
  for (const [label, href] of [
    [section.primaryLabel, section.primaryHref],
    [section.secondaryLabel, section.secondaryHref],
  ] as const) {
    if (!label?.trim() || !href?.trim()) continue;
    const renderable = toRenderableHref(href);
    if (renderable) actions.push({ label: label.trim(), href: renderable });
  }
  return actions;
}

function paragraphsOf(body: string | undefined): string[] {
  const trimmed = body?.trim();
  return trimmed ? [trimmed] : [];
}

function mediaOf(section: CmsSectionInput, resolve?: MediaResolver): PublicMedia | null {
  if (!section.imageItemId || !resolve) return null;
  // An unresolvable reference is dropped, not faked. The block still renders
  // its text.
  return resolve(section.imageItemId) ?? null;
}

export type MapBlocksResult =
  | { ok: true; blocks: PublicBlock[] }
  | { ok: false; reason: string; violations?: ContractViolation[] };

/**
 * Maps the enabled sections of one published page onto renderable blocks.
 *
 * Refuses rather than guesses, and the output passes `validateBlocks`
 * unchanged — the mapper gets no exemption from the contract it feeds.
 */
export function mapCmsSectionsToBlocks(
  sections: ReadonlyArray<CmsSectionInput>,
  options: { resolveMedia?: MediaResolver } = {},
): MapBlocksResult {
  const enabled = sections.filter((section) => section.enabled);
  const blocks: PublicBlock[] = [];

  for (const section of enabled) {
    const blockType = CMS_SECTION_BLOCK_TYPES[section.type];
    if (!blockType) {
      // A section type this mapper has never seen is refused rather than
      // rendered as prose. Rendering it would put an unreviewed shape on a
      // customer-facing page.
      return { ok: false, reason: `unsupported CMS section type "${section.type}"` };
    }

    const id = section.id;
    const heading = section.heading?.trim() ?? "";
    const body = paragraphsOf(section.body);
    const media = mediaOf(section, options.resolveMedia);
    const actions = actionsOf(section);

    switch (blockType) {
      case "HERO":
        blocks.push({
          type: "HERO",
          id,
          eyebrow: section.eyebrow?.trim() || null,
          heading,
          body,
          media,
          actions,
        });
        break;

      case "TEXT":
        blocks.push({
          type: "TEXT",
          id,
          heading: heading || null,
          headingLevel: 2,
          body,
          media: media ? [media] : [],
        });
        break;

      case "SERVICE_CARDS":
        blocks.push({
          type: "SERVICE_CARDS",
          id,
          heading,
          body,
          cards: (section.items ?? []).map((item) => ({
            title: item?.title?.trim() ?? "",
            body: item?.body?.trim() ?? "",
            // Lane B's feature items carry no link of their own.
            href: null,
          })),
        });
        break;

      case "GALLERY":
        blocks.push({
          type: "GALLERY",
          id,
          heading: heading || null,
          body,
          categorySlug: section.galleryCategorySlug?.trim() || null,
          // Lane B defaults this to 12 in its own parser; mirroring the default
          // rather than inventing one keeps the two sides agreeing.
          limit: typeof section.galleryLimit === "number" && Number.isInteger(section.galleryLimit) && section.galleryLimit > 0
            ? section.galleryLimit
            : 12,
        });
        break;

      case "FAQ":
        blocks.push({
          type: "FAQ",
          id,
          heading,
          questions: (section.items ?? []).map((item) => ({
            question: item?.title?.trim() ?? "",
            answer: item?.body?.trim() ?? "",
          })),
        });
        break;

      case "CTA":
        blocks.push({ type: "CTA", id, heading, body, actions });
        break;

      case "CONTACT":
        blocks.push({ type: "CONTACT", id, heading, body });
        break;

      default:
        return { ok: false, reason: `no mapping for block type "${blockType}"` };
    }
  }

  const validated = validateBlocks(blocks);
  if (!validated.ok) return { ok: false, reason: "mapped blocks failed the render contract", violations: validated.violations };
  return { ok: true, blocks: validated.blocks };
}
