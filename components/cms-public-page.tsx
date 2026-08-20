/* eslint-disable @next/next/no-img-element -- public CMS media is served through an authorization-aware R2 image route */
import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { GalleryLightbox, type PublicGalleryItem } from "@/components/gallery-lightbox";
import { galleryCategories, galleryItems } from "@/db/schema";
import { SITE_PAGE_DEFINITIONS, type CmsPageContent, type CmsSection, type SitePageSlug } from "@/lib/site-cms";
import { getPublishedSiteSettings, type SiteSettings } from "@/lib/site-settings";
import { serializeStructuredData, siteOrganizationSchema } from "@/lib/site-structured-data";

export async function CmsPublicPage({ content, slug, preview = false }: { content: CmsPageContent; slug: SitePageSlug; preview?: boolean }) {
  const settings = await getPublishedSiteSettings();
  return <main className="cms-public-page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(siteOrganizationSchema(settings)) }} />
    {preview && <div className="cms-preview-banner" role="status">ตัวอย่างฉบับร่าง — ยังไม่เผยแพร่</div>}
    <PublicHeader active={slug} settings={settings} />
    {content.sections.filter((section) => section.enabled).map((section) => <CmsSectionView key={section.id} section={section} />)}
    <PublicFooter settings={settings} />
  </main>;
}

async function PublicHeader({ active, settings }: { active: SitePageSlug; settings: SiteSettings }) {
  const servicePages: SitePageSlug[] = ["services", "motorcycle-transport", "international", "storage", "container-loading", "dealer-fleet", "quotation"];
  const activePath = SITE_PAGE_DEFINITIONS[active].path;
  return <header className="cms-site-header"><div className="shell cms-nav"><Link className="brand" href="/" aria-label={`${settings.brand.name} หน้าแรก`}><PublicBrandIdentity settings={settings} /></Link><nav aria-label="เมนูหลัก">{settings.navigation.items.map((item) => <Link className={item.href === activePath || item.href === "/services" && servicePages.includes(active) ? "active" : ""} href={item.href} key={item.href}>{item.label}</Link>)}<Link className="button button-small button-gradient" href="/login">{settings.navigation.loginLabel}</Link></nav></div></header>;
}

export async function PublicBrandIdentity({ settings }: { settings: SiteSettings }) {
  const logo = settings.brand.logoItemId ? await getPublicMedia(settings.brand.logoItemId) : null;
  return <>{logo ? <span className="brand-mark cms-brand-logo"><img src={`/api/gallery/images/${logo.id}?role=thumbnail`} alt={logo.altText || settings.brand.name} decoding="async" /></span> : <span className="brand-mark">{settings.brand.abbreviation}</span>}<span className="brand-name">{settings.brand.name}<small>{settings.brand.tagline}</small></span></>;
}

async function CmsSectionView({ section }: { section: CmsSection }) {
  if (section.type === "HERO") return <section className="cms-hero"><div className="aurora" aria-hidden="true"><i className="aurora-one" /><i className="aurora-two" /><i className="aurora-three" /></div><div className="shell cms-hero-grid"><div><SectionHeading section={section} level={1} /><Actions section={section} /></div>{section.imageItemId ? <PublicImage itemId={section.imageItemId} alt={section.heading} /> : <div className="cms-hero-proof" aria-label="จุดเด่นของระบบ"><b>ข้อมูลเดียวตลอดกระบวนการ</b><span>รับรถ · ตรวจสภาพ · จัดเก็บ · ขนส่ง · ส่งมอบ</span><small>รูปและสถานะตรวจสอบย้อนหลังตามสิทธิ์</small></div>}</div></section>;
  if (section.type === "FEATURES") return <section className="cms-section"><div className="shell"><SectionHeading section={section} /><div className="cms-feature-grid">{section.items.map((item, index) => <article key={`${section.id}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><h3>{item.title}</h3>{item.body && <p>{item.body}</p>}</article>)}</div><Actions section={section} /></div></section>;
  if (section.type === "GALLERY") return <GallerySection section={section} />;
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
    items = [];
  }
  return <section className="cms-section cms-gallery-section"><div className="shell"><SectionHeading section={section} />{items.length ? <GalleryLightbox items={items} /> : <div className="app-panel app-empty"><h3>ยังไม่มีภาพที่เผยแพร่</h3><p>ระบบจะแสดงเฉพาะภาพจริงที่แอดมินอนุมัติแล้ว</p></div>}<Actions section={section} /></div></section>;
}

async function PublicImage({ itemId, alt }: { itemId: string; alt: string }) {
  const item = await getPublicMedia(itemId);
  return item ? <figure className="cms-section-image"><img src={`/api/gallery/images/${item.id}?role=display`} alt={item.altText || alt} loading="lazy" decoding="async" /></figure> : null;
}

async function getPublicMedia(itemId: string): Promise<{ id: string; altText: string } | null> {
  try {
    const { getDb } = await import("@/db");
    return await getDb().select({ id: galleryItems.id, altText: galleryItems.altText }).from(galleryItems).where(and(eq(galleryItems.id, itemId), eq(galleryItems.status, "PUBLISHED"), eq(galleryItems.visibility, "PUBLIC"))).get() ?? null;
  } catch {
    return null;
  }
}

function SectionHeading({ section, level = 2 }: { section: CmsSection; level?: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return <div className="cms-section-heading">{section.eyebrow && <span className="eyebrow">{section.eyebrow}</span>}<Heading>{section.heading}</Heading>{section.body && <p>{section.body}</p>}</div>;
}

function Actions({ section }: { section: CmsSection }) {
  if (!section.primaryHref && !section.secondaryHref) return null;
  return <div className="hero-actions">{section.primaryHref && <Link className="button button-gradient" href={section.primaryHref}>{section.primaryLabel}</Link>}{section.secondaryHref && <Link className="button button-glass" href={section.secondaryHref}>{section.secondaryLabel}</Link>}</div>;
}

function PublicFooter({ settings }: { settings: SiteSettings }) {
  return <footer><div className="shell footer-inner"><span>{settings.footer.copyright}</span><span><a href={`tel:${settings.contact.primaryPhone}`}>{settings.contact.primaryPhone}</a>{settings.contact.secondaryPhone && <> · <a href={`tel:${settings.contact.secondaryPhone}`}>{settings.contact.secondaryPhone}</a></>}</span></div><div className="shell cms-footer-secondary">{settings.footer.secondaryText}</div></footer>;
}
