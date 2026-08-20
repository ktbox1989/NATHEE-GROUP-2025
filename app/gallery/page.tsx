import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, gt, lt, or } from "drizzle-orm";
import { GalleryLightbox, type PublicGalleryItem } from "@/components/gallery-lightbox";
import { getDb } from "@/db";
import { galleryCategories, galleryItems } from "@/db/schema";
import { GALLERY_PAGE_SIZE } from "@/lib/gallery";
import { getPublicGalleryFallback, getPublicGalleryFallbackCategories } from "@/lib/public-gallery-fallback";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ผลงานขนส่งรถจักรยานยนต์ | NATHEE GROUP 2025", description: "ภาพผลงานจริงด้านขนส่งรถจักรยานยนต์ ลานสต๊อก Container Dealer และ Fleet", alternates: { canonical: "https://natheegroup2025.com/gallery/" } };
type Props = { searchParams: Promise<{ category?: string; afterOrder?: string; afterCreated?: string; afterId?: string }> };

export default async function PublicGalleryPage({ searchParams }: Props) {
  const params = await searchParams;
  const order = Number(params.afterOrder);
  const cursor = Number.isSafeInteger(order) && order >= 0 && params.afterCreated && params.afterId ? { order, created: params.afterCreated, id: params.afterId } : null;
  let categories = getPublicGalleryFallbackCategories();
  let active = categories.find((category) => category.slug === params.category);
  let items: PublicGalleryItem[] = getPublicGalleryFallback(active?.slug, GALLERY_PAGE_SIZE);
  let hasMore = false;
  let next: { sortOrder: number; createdAt: string; id: string } | undefined;
  try {
    const db = getDb();
    const databaseCategories = await db.select({ id: galleryCategories.id, slug: galleryCategories.slug, name: galleryCategories.name }).from(galleryCategories).where(eq(galleryCategories.status, "ACTIVE")).orderBy(galleryCategories.sortOrder, galleryCategories.name).all();
    if (databaseCategories.length) categories = databaseCategories;
    active = categories.find((category) => category.slug === params.category);
    const cursorFilter = cursor ? or(gt(galleryItems.sortOrder, cursor.order), and(eq(galleryItems.sortOrder, cursor.order), lt(galleryItems.createdAt, cursor.created)), and(eq(galleryItems.sortOrder, cursor.order), eq(galleryItems.createdAt, cursor.created), lt(galleryItems.id, cursor.id))) : undefined;
    const rows = await db.select({ id: galleryItems.id, title: galleryItems.title, caption: galleryItems.caption, altText: galleryItems.altText, takenAt: galleryItems.takenAt, location: galleryItems.location, categoryName: galleryCategories.name, sortOrder: galleryItems.sortOrder, createdAt: galleryItems.createdAt }).from(galleryItems).innerJoin(galleryCategories, eq(galleryCategories.id, galleryItems.categoryId)).where(and(eq(galleryItems.status, "PUBLISHED"), eq(galleryItems.visibility, "PUBLIC"), eq(galleryCategories.status, "ACTIVE"), active ? eq(galleryItems.categoryId, active.id) : undefined, cursorFilter)).orderBy(asc(galleryItems.sortOrder), desc(galleryItems.createdAt), desc(galleryItems.id)).limit(GALLERY_PAGE_SIZE + 1).all();
    if (rows.length) {
      hasMore = rows.length > GALLERY_PAGE_SIZE;
      const pageRows = rows.slice(0, GALLERY_PAGE_SIZE);
      next = pageRows.at(-1);
      items = pageRows.map(({ id, title, caption, altText, takenAt, location, categoryName }) => ({ id, title, caption, altText, takenAt, location, categoryName }));
    }
  } catch {
    // The checked-in real-photo manifest keeps the public portfolio useful while D1 is unavailable.
  }
  return <main className="public-gallery-page"><header className="public-gallery-hero"><div className="shell"><Link href="/">NATHEE GROUP 2025</Link><p>REAL WORK PORTFOLIO</p><h1>ภาพผลงานจริง</h1><span>แสดงเฉพาะภาพที่ได้รับอนุญาตให้เผยแพร่ รูปหลักฐานงานของลูกค้ายังคงเป็นข้อมูล Private</span></div></header><section className="shell public-gallery-content"><nav className="public-gallery-filters" aria-label="หมวดผลงาน"><Link className={!active ? "active" : ""} href="/gallery">ทั้งหมด</Link>{categories.map((category) => <Link className={active?.id === category.id ? "active" : ""} href={`/gallery?category=${encodeURIComponent(category.slug)}`} key={category.id}>{category.name}</Link>)}</nav>{items.length ? <GalleryLightbox items={items} /> : <div className="app-panel app-empty"><h2>ยังไม่มีภาพที่เผยแพร่</h2><p>ระบบไม่ใช้ภาพ Stock หรือรูปของลูกค้าแทนผลงานจริง</p></div>}{hasMore && next && <nav className="batch-navigation"><Link className="button button-glass" href={`/gallery?${active ? `category=${encodeURIComponent(active.slug)}&` : ""}afterOrder=${next.sortOrder}&afterCreated=${encodeURIComponent(next.createdAt)}&afterId=${encodeURIComponent(next.id)}`}>ดูภาพเพิ่มเติม</Link></nav>}</section></main>;
}
