/* eslint-disable @next/next/no-img-element -- public CMS media is served through an authorization-aware R2 image route */
import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { GalleryLightbox, type PublicGalleryItem } from "@/components/gallery-lightbox";
import { galleryCategories, galleryItems } from "@/db/schema";
import type { CmsPageContent, CmsSection, SitePageSlug } from "@/lib/site-cms";

export async function CmsPublicPage({ content, slug, preview = false }: { content: CmsPageContent; slug: SitePageSlug; preview?: boolean }) {
  return <main className="cms-public-page">
    <script type="application/ld+json">{JSON.stringify(organizationSchema)}</script>
    {preview && <div className="cms-preview-banner" role="status">ตัวอย่างฉบับร่าง — ยังไม่เผยแพร่</div>}
    <PublicHeader active={slug} />
    {content.sections.filter((section) => section.enabled).map((section) => <CmsSectionView key={section.id} section={section} />)}
    <PublicFooter />
  </main>;
}

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "บริษัท นทีกรุ๊ป2025 จำกัด",
  alternateName: "NATHEE GROUP 2025",
  url: "https://natheegroup2025.com/",
  telephone: ["+66-63-194-1191", "+66-85-680-2082"],
};

function PublicHeader({ active }: { active: SitePageSlug }) {
  return <header className="cms-site-header"><div className="shell cms-nav"><Link className="brand" href="/"><span className="brand-mark">NG</span><span className="brand-name">NATHEE GROUP<small>MOTORCYCLE LOGISTICS · 2025</small></span></Link><nav aria-label="เมนูหลัก"><Link className={active === "home" ? "active" : ""} href="/">หน้าแรก</Link><Link className={active === "services" ? "active" : ""} href="/services">บริการ</Link><Link href="/gallery">ผลงาน</Link><Link className={active === "about" ? "active" : ""} href="/about">เกี่ยวกับเรา</Link><Link className={active === "contact" ? "active" : ""} href="/contact">ติดต่อ</Link><Link className="button button-small button-gradient" href="/login">เข้าสู่ระบบ</Link></nav></div></header>;
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
  let item: { id: string; altText: string } | undefined;
  try {
    const { getDb } = await import("@/db");
    item = await getDb().select({ id: galleryItems.id, altText: galleryItems.altText }).from(galleryItems).where(and(eq(galleryItems.id, itemId), eq(galleryItems.status, "PUBLISHED"), eq(galleryItems.visibility, "PUBLIC"))).get();
  } catch {
    item = undefined;
  }
  return item ? <figure className="cms-section-image"><img src={`/api/gallery/images/${item.id}?role=display`} alt={item.altText || alt} loading="lazy" decoding="async" /></figure> : null;
}

function SectionHeading({ section, level = 2 }: { section: CmsSection; level?: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return <div className="cms-section-heading">{section.eyebrow && <span className="eyebrow">{section.eyebrow}</span>}<Heading>{section.heading}</Heading>{section.body && <p>{section.body}</p>}</div>;
}

function Actions({ section }: { section: CmsSection }) {
  if (!section.primaryHref && !section.secondaryHref) return null;
  return <div className="hero-actions">{section.primaryHref && <Link className="button button-gradient" href={section.primaryHref}>{section.primaryLabel}</Link>}{section.secondaryHref && <Link className="button button-glass" href={section.secondaryHref}>{section.secondaryLabel}</Link>}</div>;
}

function PublicFooter() {
  return <footer><div className="shell footer-inner"><span>© 2026 บริษัท นทีกรุ๊ป2025 จำกัด</span><span><a href="tel:0631941191">063-194-1191</a> · <a href="tel:0856802082">085-680-2082</a></span></div></footer>;
}
