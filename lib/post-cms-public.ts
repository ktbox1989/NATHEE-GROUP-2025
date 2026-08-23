/**
 * Turns a stored post into the payload the public site is allowed to render.
 *
 * The result is checked with Lane A's own `validatePublicPost` rather than
 * trusted. A mapper that believed its own output would let a field drift out of
 * the contract and only fail on the public site, where the failure is a broken
 * page rather than a rejected write.
 *
 * `publishedAt` and `updatedAt` come from publication events, not from content:
 * the first PUBLISH is when the post went live, and a later PUBLISH is an edit.
 * `updatedAt` is null until there is a second one, which is exactly what the
 * contract means by "never edited since publication".
 */

import {
  PUBLIC_CMS_CONTRACT_VERSION,
  type ContractViolation,
  type PublicMedia,
  type PublicSection,
} from "./public-cms/contract.ts";
import { postPath, validatePublicPost, type PublicPost } from "./public-cms/posts.ts";
import type { PostContent } from "./post-cms-content.ts";

/** Resolves an image id to public media. The gallery is this lane's data. */
export type PostMediaResolver = (imageItemId: string) => PublicMedia | null;

export type StoredPost = {
  slug: string;
  revisionId: string;
  content: PostContent;
  /** ISO-8601. When the post was first published. */
  publishedAt: string;
  /** ISO-8601 of the most recent republish, or null if published only once. */
  updatedAt: string | null;
};

export type PostMapResult =
  | { ok: true; post: PublicPost }
  | { ok: false; reason: string; violations?: ContractViolation[] };

function toSections(content: PostContent, resolveMedia: PostMediaResolver): PublicSection[] {
  const sections: PublicSection[] = [];

  for (const section of content.sections) {
    if (!section.enabled) continue;

    const media: PublicMedia[] = [];
    if (section.imageItemId) {
      const resolved = resolveMedia(section.imageItemId);
      // Unresolvable media is dropped rather than emitted as a broken image.
      // Publish already refuses a revision whose media cannot be resolved, so
      // reaching here means the item was archived after publication.
      if (resolved) media.push(resolved);
    }

    const body = section.body.trim() ? [section.body.trim()] : [];
    sections.push({
      id: section.id,
      heading: section.heading.trim() || null,
      headingLevel: 2,
      body,
      media,
    });

    // Feature and FAQ entries become their own subsections, so the renderer
    // emits a real heading rank instead of inventing one.
    for (const item of section.items) {
      sections.push({
        id: `${section.id}-${sections.length}`,
        heading: item.title.trim() || null,
        headingLevel: 3,
        body: item.body.trim() ? [item.body.trim()] : [],
        media: [],
      });
    }
  }

  return sections;
}

export function mapStoredPostToPublicPost(
  stored: StoredPost,
  resolveMedia: PostMediaResolver,
): PostMapResult {
  const { content } = stored;

  const featuredImage = content.featuredImageItemId ? resolveMedia(content.featuredImageItemId) : null;
  const path = postPath(stored.slug);

  const candidate = {
    contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
    status: "PUBLISHED" as const,
    slug: stored.slug,
    path,
    title: content.title,
    excerpt: content.excerpt,
    category: content.category,
    publishedAt: stored.publishedAt,
    updatedAt: stored.updatedAt,
    featuredImage,
    sections: toSections(content, resolveMedia),
    seo: {
      title: content.seo.title,
      description: content.seo.description,
      // Derived, never stored: a canonical path that disagreed with the slug
      // would split the post across two URLs.
      canonicalPath: path,
      robots: content.seo.robots,
    },
    revisionId: stored.revisionId,
  };

  const validated = validatePublicPost(candidate, PUBLIC_CMS_CONTRACT_VERSION);
  if (!validated.ok) {
    return { ok: false, reason: "the mapped post does not satisfy the public contract", violations: validated.violations };
  }
  return { ok: true, post: validated.value };
}
