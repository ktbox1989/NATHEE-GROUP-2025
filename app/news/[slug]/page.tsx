import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/cms-public-page";
import { PublicMediaImage } from "@/components/public-media-image";
import { CANONICAL_ORIGIN } from "@/lib/public-cms/contract";
import { POSTS_INDEX_PATH, isValidPostSlug } from "@/lib/public-cms/posts";
import {
  formatThaiDate,
  readPublishedNewsArticle,
  resolveRenamedNewsPath,
  type PublicNewsArticle,
  type PublicNewsSection,
} from "@/lib/public-news";
import { getPublishedSiteSettings } from "@/lib/site-settings";
import { serializeStructuredData, siteOrganizationSchema } from "@/lib/site-structured-data";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isValidPostSlug(slug)) return { title: "ไม่พบบทความ", robots: { index: false, follow: false } };
  const article = await readPublishedNewsArticle(slug);
  // An unpublished or missing post gets no indexable metadata, because the page
  // itself will answer 404 and a title describing an article that is not there
  // is worse than none.
  if (!article) return { title: "ไม่พบบทความ", robots: { index: false, follow: false } };

  const settings = await getPublishedSiteSettings();
  const url = `${CANONICAL_ORIGIN}${article.path}`;
  const indexable = article.seo.robots === "INDEX";
  return {
    title: `${article.seo.title} | ${settings.brand.name}`,
    description: article.seo.description,
    alternates: { canonical: url },
    // NOINDEX is an ordinary editorial choice for a post, and it is the editor's
    // choice rather than this route's: published but unlisted is a real state.
    robots: { index: indexable, follow: indexable },
    openGraph: {
      title: article.seo.title,
      description: article.seo.description,
      url,
      siteName: settings.brand.name,
      type: "article",
      locale: "th_TH",
      publishedTime: article.publishedAt,
      // Emitted only when the post has actually been edited since publication.
      // Defaulting it to the publication date tells a search engine the article
      // was revised when it was not.
      ...(article.updatedAt ? { modifiedTime: article.updatedAt } : {}),
    },
    twitter: { card: "summary_large_image", title: article.seo.title, description: article.seo.description },
  };
}

export default async function NewsArticlePage({ params }: Props) {
  const { slug } = await params;
  if (!isValidPostSlug(slug)) notFound();
  const article = await readPublishedNewsArticle(slug);
  if (!article) {
    // A slug that is not live may have moved. The old URL keeps its inbound
    // links by answering a permanent redirect rather than a dead end.
    const moved = await resolveRenamedNewsPath(slug);
    if (moved) permanentRedirect(moved);
    notFound();
  }
  const settings = await getPublishedSiteSettings();

  return (
    <main className="cms-public-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(siteOrganizationSchema(settings)) }} />
      {article.seo.robots === "INDEX" && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(articleSchema(article, settings.brand.name)) }} />
      )}
      <PublicSiteHeader activePath={POSTS_INDEX_PATH} settings={settings} />

      <article className="cms-news-article">
        <header className="cms-section cms-news-article-head">
          <div className="shell">
            <nav className="cms-news-breadcrumb" aria-label="เส้นทางหน้า">
              <Link href={POSTS_INDEX_PATH}>← กลับไปหน้าข่าวสาร</Link>
            </nav>
            <div className="cms-section-heading">
              {article.category && <span className="eyebrow">{article.category.label}</span>}
              <h1>{article.title}</h1>
              <p>{article.excerpt}</p>
            </div>
            <p className="cms-news-dates">
              <time dateTime={article.publishedAt}>เผยแพร่ {formatThaiDate(article.publishedAt)}</time>
              {article.updatedAt && (
                <>
                  {" · "}
                  <time dateTime={article.updatedAt}>แก้ไขล่าสุด {formatThaiDate(article.updatedAt)}</time>
                </>
              )}
            </p>
            {article.image && (
              <figure className="cms-news-cover">
                <PublicMediaImage
                  media={article.image}
                  priority
                  sizes="(max-width: 940px) calc(100vw - 40px), 1100px"
                />
              </figure>
            )}
          </div>
        </header>

        {article.sections.map((section) => (
          <NewsSection key={section.id} section={section} />
        ))}
      </article>

      <section className="cms-section cms-cta">
        <div className="shell">
          <div className="cms-section-heading">
            <span className="eyebrow">ติดต่อทีมงาน</span>
            <h2>ต้องการประเมินงานขนส่ง?</h2>
            <p>แจ้งต้นทาง ปลายทาง จำนวนรถ และวันที่ต้องการ ทีมงานจะตรวจสอบและตอบกลับตามข้อมูลจริง</p>
          </div>
          <div className="hero-actions">
            <Link className="button button-gradient" href="/quotation">ขอใบเสนอราคา</Link>
            <Link className="button button-glass" href={POSTS_INDEX_PATH}>อ่านบทความอื่น</Link>
          </div>
        </div>
      </section>

      <PublicSiteFooter settings={settings} />
    </main>
  );
}

function NewsSection({ section }: { section: PublicNewsSection }) {
  const hasActions = Boolean(section.primaryHref || section.secondaryHref);
  return (
    <section className="cms-section cms-news-body">
      <div className="shell">
        <div className="cms-section-heading">
          {section.eyebrow && <span className="eyebrow">{section.eyebrow}</span>}
          {section.heading && <h2>{section.heading}</h2>}
          {section.body && <p>{section.body}</p>}
        </div>
        {section.image && (
          <PublicMediaImage
            media={section.image}
            className="cms-section-image"
            withOrientation
            sizes="(max-width: 940px) calc(100vw - 40px), 720px"
          />
        )}
        {section.items.length > 0 && (
          <div className="cms-news-points">
            {section.items.map((item, position) => (
              <article key={`${section.id}-${position}`}>
                <h3>{item.title}</h3>
                {item.body && <p>{item.body}</p>}
              </article>
            ))}
          </div>
        )}
        {hasActions && (
          <div className="hero-actions">
            {section.primaryHref && (
              <Link className="button button-gradient" href={section.primaryHref}>{section.primaryLabel}</Link>
            )}
            {section.secondaryHref && (
              <Link className="button button-glass" href={section.secondaryHref}>{section.secondaryLabel}</Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The absolute URL of the share image, or null.
 *
 * Taken from the display variant the delivery contract already built, so the
 * URL in the structured data is the same one the page renders rather than a
 * second guess at the same path.
 */
function articleImageUrl(article: PublicNewsArticle): string | null {
  const display = article.image?.variants.find((variant) => variant.role === "display");
  return display ? `${CANONICAL_ORIGIN}${display.src}` : null;
}

function articleSchema(article: PublicNewsArticle, brandName: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.excerpt,
    datePublished: article.publishedAt,
    // Absent rather than equal to datePublished when the post has never been
    // edited, matching what the public contract means by updatedAt.
    ...(article.updatedAt ? { dateModified: article.updatedAt } : {}),
    mainEntityOfPage: `${CANONICAL_ORIGIN}${article.path}`,
    ...(article.category ? { articleSection: article.category.label } : {}),
    ...(articleImageUrl(article) ? { image: articleImageUrl(article) } : {}),
    author: { "@type": "Organization", name: brandName },
    publisher: { "@type": "Organization", name: brandName },
  };
}
