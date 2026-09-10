import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GalleryLightbox } from "@/components/gallery-lightbox";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { isValidPostSlug } from "@/lib/post-cms-content";
import { getPostEditorState, getRevisionContent } from "@/lib/post-cms-store";
import { POSTS_INDEX_PATH } from "@/lib/public-cms/posts";
import { readNewsGallerySections } from "@/lib/public-news";

export const dynamic = "force-dynamic";

// A preview is a draft rendered behind authentication. It must never be
// indexable, whatever the revision says about its own robots value.
export const metadata = { robots: { index: false, follow: false } };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ revision?: string }> };

export default async function PostPreview({ params, searchParams }: Props) {
  const actor = await requireActor("/app/posts");
  if (!can(actor, "site:read")) redirect("/app");
  const { slug } = await params;
  const { revision } = await searchParams;
  if (!isValidPostSlug(slug) || !revision) notFound();

  const state = await getPostEditorState(slug);
  if (!state) notFound();
  const content = await getRevisionContent(state.postId, revision);
  if (!content) notFound();

  const live = state.publication?.action === "PUBLISH" ? state.publication.revisionId : null;
  const enabled = content.sections.filter((section) => section.enabled);
  // A GALLERY section is previewed with the same photographs the article would
  // show, because a preview that cannot show them is not a preview of the page.
  const gallerySections = await readNewsGallerySections(enabled);

  return (
    <>
      <div className="app-page-head">
        <div>
          <p>PREVIEW · ยังไม่ใช่หน้าเว็บจริง</p>
          <h1>{content.title}</h1>
          <span>
            {POSTS_INDEX_PATH}{slug}/ · Revision {revision.slice(0, 8)}…{" "}
            {live === revision ? "(กำลังเผยแพร่อยู่)" : "(ยังไม่เผยแพร่)"}
          </span>
        </div>
        <Link className="button button-glass" href={`/app/posts/${slug}`}>กลับไปแก้ไข</Link>
      </div>

      <section className="app-panel">
        <p>{content.excerpt}</p>
        <small>
          {content.category ? `หมวดหมู่: ${content.category.label} · ` : ""}
          การจัดทำดัชนีเมื่อเผยแพร่: {content.seo.robots}
        </small>
      </section>

      <article className="cms-preview">
        {enabled
          .map((section) => (
            <section key={section.id}>
              <h2>{section.heading}</h2>
              {section.body && <p>{section.body}</p>}
              {section.items.map((item, index) => (
                <div key={`${section.id}-${index}`}>
                  <h3>{item.title}</h3>
                  {item.body && <p>{item.body}</p>}
                </div>
              ))}
              {section.type === "GALLERY" && (
                <div className="cms-preview-gallery">
                  {(gallerySections.get(section.id) ?? []).length > 0 ? (
                    <GalleryLightbox items={gallerySections.get(section.id) ?? []} />
                  ) : (
                    <p className="form-message">หมวดแกลเลอรีนี้ยังไม่มีภาพที่เผยแพร่ — หน้าจริงจะแสดงกล่องว่ายังไม่มีภาพที่เผยแพร่</p>
                  )}
                </div>
              )}
            </section>
          ))}
      </article>
    </>
  );
}
