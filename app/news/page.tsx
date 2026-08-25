import type { Metadata } from "next";
import Link from "next/link";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/cms-public-page";
import { PublicMediaImage } from "@/components/public-media-image";
import { CANONICAL_ORIGIN } from "@/lib/public-cms/contract";
import { POSTS_EMPTY_STATE, POSTS_INDEX_PATH } from "@/lib/public-cms/posts";
import {
  clampNewsPage,
  formatThaiDate,
  readPublishedNewsIndex,
  type PublicNewsCard,
} from "@/lib/public-news";
import { getPublishedSiteSettings } from "@/lib/site-settings";
import { serializeStructuredData, siteOrganizationSchema } from "@/lib/site-structured-data";

// A publish must be visible on the next request. There is no cache to
// invalidate, for the same reason the managed marketing pages have none: a
// cached index would let an editor publish, be told it succeeded, and have the
// live page keep serving the previous list with nothing reporting a failure.
export const dynamic = "force-dynamic";

const INDEX_URL = `${CANONICAL_ORIGIN}${POSTS_INDEX_PATH}`;
const TITLE = "ข่าวสารและบทความ";
const DESCRIPTION = "ข่าวสาร ประกาศ และบทความเกี่ยวกับงานขนส่งรถจักรยานยนต์ ลานสต๊อก และงานส่งออกของ NATHEE GROUP 2025";

type Props = { searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { page } = await searchParams;
  const current = clampNewsPage(page);
  const settings = await getPublishedSiteSettings();
  const title = current > 1 ? `${TITLE} หน้า ${current} | ${settings.brand.name}` : `${TITLE} | ${settings.brand.name}`;
  // Every page of the archive is its own canonical. Pointing page 2 at page 1
  // would ask a search engine to drop the articles only page 2 links to.
  const url = current > 1 ? `${INDEX_URL}?page=${current}` : INDEX_URL;
  return {
    title,
    description: DESCRIPTION,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { title, description: DESCRIPTION, url, siteName: settings.brand.name, type: "website", locale: "th_TH" },
    twitter: { card: "summary", title, description: DESCRIPTION },
  };
}

export default async function NewsIndexPage({ searchParams }: Props) {
  const { page } = await searchParams;
  const [index, settings] = await Promise.all([
    readPublishedNewsIndex(clampNewsPage(page)),
    getPublishedSiteSettings(),
  ]);

  return (
    <main className="cms-public-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(siteOrganizationSchema(settings)) }} />
      <PublicSiteHeader activePath={POSTS_INDEX_PATH} settings={settings} />

      <section className="cms-section cms-news-intro">
        <div className="shell">
          <div className="cms-section-heading">
            <span className="eyebrow">ข่าวสาร · บทความ</span>
            <h1>{TITLE}</h1>
            <p>{DESCRIPTION}</p>
          </div>
        </div>
      </section>

      <section className="cms-section cms-news-list-section">
        <div className="shell">
          {index.unavailable ? (
            <div className="app-panel app-empty">
              <h2>ยังเปิดหน้าข่าวไม่ได้ในขณะนี้</h2>
              <p>ระบบเนื้อหาตอบไม่ได้ชั่วคราว บทความที่เผยแพร่ไว้ยังอยู่ครบและจะกลับมาแสดงเมื่อระบบพร้อม</p>
              <div className="app-empty-actions">
                <Link href={POSTS_INDEX_PATH}>ลองใหม่อีกครั้ง</Link>
                <Link href="/contact">ติดต่อทีมงาน</Link>
              </div>
            </div>
          ) : index.posts.length === 0 ? (
            <div className="app-panel app-empty">
              {/* The wording is the contract's own empty state, so the runtime
                  index and the statically built one say the same thing. Only
                  the hrefs differ: this runtime serves /services, where the
                  static release serves /services/. */}
              <h2>{POSTS_EMPTY_STATE.heading}</h2>
              <p>{POSTS_EMPTY_STATE.body}</p>
              <div className="app-empty-actions">
                <Link href="/services">{POSTS_EMPTY_STATE.action?.label ?? "ดูบริการทั้งหมด"}</Link>
                <Link href="/gallery">ดูผลงานจริง</Link>
              </div>
            </div>
          ) : (
            <>
              <div className="cms-news-grid">
                {index.posts.map((post, position) => (
                  <NewsCard key={post.slug} post={post} priority={index.page === 1 && position === 0} />
                ))}
              </div>
              <NewsPagination page={index.page} pageCount={index.pageCount} total={index.total} />
            </>
          )}
        </div>
      </section>

      <PublicSiteFooter settings={settings} />
    </main>
  );
}

function NewsCard({ post, priority }: { post: PublicNewsCard; priority: boolean }) {
  return (
    <article className="cms-news-card">
      <Link href={post.path} className="cms-news-card-media" aria-hidden={post.image ? undefined : true} tabIndex={post.image ? undefined : -1}>
        {post.image ? (
          <PublicMediaImage
            media={post.image}
            priority={priority}
            sizes="(max-width: 600px) calc(100vw - 28px), (max-width: 940px) 48vw, 32vw"
          />
        ) : (
          <span className="cms-news-card-placeholder" aria-hidden="true" />
        )}
      </Link>
      <div className="cms-news-card-body">
        {post.category && <span className="status-pill">{post.category.label}</span>}
        <h2>
          <Link href={post.path}>{post.title}</Link>
        </h2>
        <p>{post.excerpt}</p>
        <small>
          <time dateTime={post.publishedAt}>เผยแพร่ {formatThaiDate(post.publishedAt)}</time>
          {post.updatedAt && (
            <>
              {" · "}
              <time dateTime={post.updatedAt}>แก้ไข {formatThaiDate(post.updatedAt)}</time>
            </>
          )}
        </small>
      </div>
    </article>
  );
}

function NewsPagination({ page, pageCount, total }: { page: number; pageCount: number; total: number }) {
  if (pageCount <= 1) return null;
  const href = (target: number) => (target <= 1 ? POSTS_INDEX_PATH : `${POSTS_INDEX_PATH}?page=${target}`);
  return (
    <nav className="batch-navigation cms-news-pagination" aria-label="หน้าบทความ">
      <span>
        หน้า {page} จาก {pageCount} · ทั้งหมด {total} บทความ
      </span>
      <div>
        {page > 1 && (
          <Link className="button button-glass" href={href(page - 1)} rel="prev">
            ← ใหม่กว่า
          </Link>
        )}
        {page < pageCount && (
          <Link className="button button-glass" href={href(page + 1)} rel="next">
            เก่ากว่า →
          </Link>
        )}
      </div>
    </nav>
  );
}
