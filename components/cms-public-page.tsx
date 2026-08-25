/* eslint-disable @next/next/no-img-element -- public CMS media is served through an authorization-aware R2 image route */
import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { CmsPublicNav } from "@/components/cms-public-nav";
import { GalleryLightbox, type PublicGalleryItem } from "@/components/gallery-lightbox";
import { galleryCategories, galleryImageVariants, galleryItems } from "@/db/schema";
import { SITE_PAGE_DEFINITIONS, type CmsPageContent, type CmsSection, type SitePageSlug } from "@/lib/site-cms";
import { getPublishedSiteSettings, type SiteSettings } from "@/lib/site-settings";
import { getPublicGalleryFallback, getPublicMediaFallback } from "@/lib/public-gallery-fallback";
import { serializeStructuredData, siteOrganizationSchema } from "@/lib/site-structured-data";

export async function CmsPublicPage({ content, slug, preview = false, afterContent }: { content: CmsPageContent; slug: SitePageSlug; preview?: boolean; afterContent?: ReactNode }) {
  const settings = await getPublishedSiteSettings();
  const faqItems = content.sections.filter((section) => section.enabled && section.type === "FAQ").flatMap((section) => section.items);
  return <main className="cms-public-page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(siteOrganizationSchema(settings)) }} />
    {faqItems.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqItems.map((item) => ({ "@type": "Question", name: item.title, acceptedAnswer: { "@type": "Answer", text: item.body } })) }) }} />}
    {preview && <div className="cms-preview-banner" role="status">ตัวอย่างฉบับร่าง — ยังไม่เผยแพร่</div>}
    <PublicSiteHeader activePath={SITE_PAGE_DEFINITIONS[slug].path} settings={settings} />
    {content.sections.filter((section) => section.enabled).map((section) => <CmsSectionView key={section.id} section={section} />)}
    {afterContent}
    <PublicSiteFooter settings={settings} />
  </main>;
}

// The seven service routes share one menu entry, so that entry stays lit on all
// of them rather than only on /services.
const SERVICE_PATHS: string[] = (["services", "motorcycle-transport", "international", "storage", "container-loading", "dealer-fleet", "quotation"] as SitePageSlug[])
  .map((slug) => SITE_PAGE_DEFINITIONS[slug].path);

export function isActivePublicNavItem(href: string, activePath: string): boolean {
  if (href === activePath) return true;
  if (href === "/services") return SERVICE_PATHS.includes(activePath);
  // Every article lives under the news index, which is also one menu entry.
  if (href === "/news" || href === "/news/") return activePath.startsWith("/news");
  return false;
}

/**
 * The public header, shared by the managed marketing pages and by /news/ so
 * there is one brand, one menu and one login label rather than two that agree
 * until someone edits the settings.
 */
export async function PublicSiteHeader({ activePath, settings }: { activePath: string; settings: SiteSettings }) {
  const items = settings.navigation.items.map((item) => ({ ...item, active: isActivePublicNavItem(item.href, activePath) }));
  return <header className="cms-site-header"><div className="shell cms-nav"><Link className="brand" href="/" aria-label={`${settings.brand.name} หน้าแรก`}><PublicBrandIdentity settings={settings} /></Link><CmsPublicNav items={items} loginLabel={settings.navigation.loginLabel} /></div></header>;
}

export async function PublicBrandIdentity({ settings }: { settings: SiteSettings }) {
  const logo = settings.brand.logoItemId ? await getPublicMedia(settings.brand.logoItemId) : null;
  return <>{logo ? <span className="brand-mark cms-brand-logo"><img src={logo.src ?? `/api/gallery/images/${logo.id}?role=thumbnail`} alt={logo.altText || settings.brand.name} width={96} height={96} decoding="async" /></span> : <span className="brand-mark">{settings.brand.abbreviation}</span>}<span className="brand-name">{settings.brand.name}<small>{settings.brand.tagline}</small></span></>;
}

async function CmsSectionView({ section }: { section: CmsSection }) {
  if (section.type === "HERO") return <section className="cms-hero"><div className="aurora" aria-hidden="true"><i className="aurora-one" /><i className="aurora-two" /><i className="aurora-three" /></div><div className="shell cms-hero-grid"><div><SectionHeading section={section} level={1} /><Actions section={section} /></div>{section.imageItemId ? <PublicImage itemId={section.imageItemId} alt={section.heading} /> : <div className="cms-hero-proof" aria-label="จุดเด่นของระบบ"><b>ข้อมูลเดียวตลอดกระบวนการ</b><span>รับรถ · ตรวจสภาพ · จัดเก็บ · ขนส่ง · ส่งมอบ</span><small>รูปและสถานะตรวจสอบย้อนหลังตามสิทธิ์</small></div>}</div></section>;
  if (section.type === "FEATURES") return <section className="cms-section"><div className="shell"><SectionHeading section={section} /><div className="cms-feature-grid">{section.items.map((item, index) => <article key={`${section.id}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><h3>{item.title}</h3>{item.body && <p>{item.body}</p>}</article>)}</div><Actions section={section} /></div></section>;
  if (section.type === "GALLERY") return <GallerySection section={section} />;
  if (section.type === "FAQ") return <section className="cms-section cms-faq-section"><div className="shell"><SectionHeading section={section} /><div className="cms-faq-list">{section.items.map((item, index) => <details key={`${section.id}-${index}`}><summary>{item.title}</summary><p>{item.body}</p></details>)}</div><Actions section={section} /></div></section>;
  if (section.type === "CTA") return <section className="cms-section cms-cta"><div className="shell"><SectionHeading section={section} /><Actions section={section} /></div></section>;
  if (section.type === "CONTACT") return <section className="cms-section"><div className="shell"><SectionHeading section={section} /><div className="cms-contact-grid">{section.items.map((item, index) => <article key={`${section.id}-${index}`}><span>{item.title}</span><strong>{item.body}</strong></article>)}</div><Actions section={section} /></div></section>;
  return <section className="cms-section"><div className="shell cms-content-grid"><SectionHeading section={section} /><div>{section.imageItemId && <PublicImage itemId={section.imageItemId} alt={section.heading} />}<Actions section={section} /></div></div></section>;
}

async function GallerySection({ section }: { section: CmsSection }) {
  let items: PublicGalleryItem[] = [];
  try {
    const { getDb } = await import("@/db");
    const db = getDb();
    const category = section.galleryCategorySlug ? await db.select({ id: galleryCategories.id }).from(galleryCategories).where(and(eq(galleryCategories.slug, section.galleryCategorySlug), eq(galleryCategories.status, "ACTIVE"))).get() : null;
    items = await db.select({ id: galleryItems.id, title: galleryItems.title, caption: galleryItems.caption, altText: galleryItems.altText, takenAt: galleryItems.takenAt, location: galleryItems.location, categoryName: galleryCategories.name })
      .from(galleryItems).innerJoin(galleryCategories, eq(galleryCategories.id, galleryItems.categoryId))
      .where(and(eq(galleryItems.status, "PUBLISHED"), eq(galleryItems.visibility, "PUBLIC"), eq(galleryCategories.status, "ACTIVE"), category ? eq(galleryItems.categoryId, category.id) : undefined))
      .orderBy(desc(galleryItems.isFeatured), asc(galleryItems.sortOrder), desc(galleryItems.createdAt), desc(galleryItems.id)).limit(section.galleryLimit).all();
  } catch {
    items = getPublicGalleryFallback(section.galleryCategorySlug || undefined, section.galleryLimit);
  }
  if (!items.length) items = getPublicGalleryFallback(section.galleryCategorySlug || undefined, section.galleryLimit);
  return <section className="cms-section cms-gallery-section"><div className="shell"><SectionHeading section={section} />{items.length ? <GalleryLightbox items={items} /> : <div className="app-panel app-empty"><h3>ยังไม่มีภาพที่เผยแพร่</h3><p>ระบบจะแสดงเฉพาะภาพจริงที่แอดมินอนุมัติแล้ว</p></div>}<Actions section={section} /></div></section>;
}

async function PublicImage({ itemId, alt }: { itemId: string; alt: string }) {
  const item = await getPublicMedia(itemId);
  const width = item?.width ?? 1600, height = item?.height ?? 1200;
  const ratio = width / height;
  const orientation = ratio > 1.12 ? "landscape" : ratio < .88 ? "portrait" : "square";
  return item ? <figure className="cms-section-image" data-orientation={orientation}><img src={item.src ?? `/api/gallery/images/${item.id}?role=display`} alt={item.altText || alt} width={width} height={height} loading="lazy" decoding="async" sizes="(max-width: 940px) calc(100vw - 40px), 48vw" /></figure> : null;
}

async function getPublicMedia(itemId: string): Promise<{ id: string; altText: string; width: number | null; height: number | null; src?: string } | null> {
  try {
    const { getDb } = await import("@/db");
    const db = getDb();
    const item = await db.select({ id: galleryItems.id, altText: galleryItems.altText }).from(galleryItems).where(and(eq(galleryItems.id, itemId), eq(galleryItems.status, "PUBLISHED"), eq(galleryItems.visibility, "PUBLIC"))).get();
    if (!item) return fallbackPublicMedia(itemId);
    const variant = await db.select({ width: galleryImageVariants.width, height: galleryImageVariants.height }).from(galleryImageVariants).where(and(eq(galleryImageVariants.galleryItemId, itemId), eq(galleryImageVariants.role, "DISPLAY"))).limit(1).get();
    return { ...item, width: variant?.width ?? null, height: variant?.height ?? null };
  } catch {
    return fallbackPublicMedia(itemId);
  }
}

function fallbackPublicMedia(itemId: string) {
  const item = getPublicMediaFallback(itemId);
  return item ? { id: item.id, altText: item.altText, width: item.width, height: item.height, src: item.displaySrc } : null;
}

function SectionHeading({ section, level = 2 }: { section: CmsSection; level?: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return <div className="cms-section-heading">{section.eyebrow && <span className="eyebrow">{section.eyebrow}</span>}<Heading>{section.heading}</Heading>{section.body && <p>{section.body}</p>}</div>;
}

function Actions({ section }: { section: CmsSection }) {
  if (!section.primaryHref && !section.secondaryHref) return null;
  return <div className="hero-actions">{section.primaryHref && <Link className="button button-gradient" href={section.primaryHref}>{section.primaryLabel}</Link>}{section.secondaryHref && <Link className="button button-glass" href={section.secondaryHref}>{section.secondaryLabel}</Link>}</div>;
}

export function PublicSiteFooter({ settings }: { settings: SiteSettings }) {
  return <footer><div className="shell footer-inner"><span>{settings.footer.copyright}</span><span><a href={`tel:${settings.contact.primaryPhone}`}>{settings.contact.primaryPhone}</a>{settings.contact.secondaryPhone && <> · <a href={`tel:${settings.contact.secondaryPhone}`}>{settings.contact.secondaryPhone}</a></>}</span></div><div className="shell cms-footer-secondary">{settings.footer.secondaryText}</div></footer>;
}
