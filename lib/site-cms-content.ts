export const SITE_PAGE_DEFINITIONS = {
  home: { label: "หน้าแรก", path: "/" },
  services: { label: "บริการ", path: "/services" },
  about: { label: "เกี่ยวกับเรา", path: "/about" },
  contact: { label: "ติดต่อ", path: "/contact" },
} as const;

export type SitePageSlug = keyof typeof SITE_PAGE_DEFINITIONS;
export type CmsSectionType = "HERO" | "CONTENT" | "FEATURES" | "GALLERY" | "CTA" | "CONTACT";
export type CmsFeature = { title: string; body: string };
export type CmsSection = {
  id: string;
  type: CmsSectionType;
  enabled: boolean;
  eyebrow: string;
  heading: string;
  body: string;
  imageItemId: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel: string;
  secondaryHref: string;
  galleryCategorySlug: string;
  galleryLimit: number;
  items: CmsFeature[];
};
export type CmsPageContent = {
  version: 1;
  seo: { title: string; description: string };
  sections: CmsSection[];
};

const sectionTypes = new Set<CmsSectionType>(["HERO", "CONTENT", "FEATURES", "GALLERY", "CTA", "CONTACT"]);
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const slugPattern = /^[a-z0-9-]{2,80}$/;

export function isSitePageSlug(value: string): value is SitePageSlug {
  return Object.hasOwn(SITE_PAGE_DEFINITIONS, value);
}

export function parseCmsPageContent(input: unknown): CmsPageContent | null {
  if (!isObject(input) || input.version !== 1 || !isObject(input.seo) || !Array.isArray(input.sections)) return null;
  const title = bounded(input.seo.title, 120);
  const description = bounded(input.seo.description, 300);
  if (title.length < 5 || description.length < 20 || input.sections.length < 1 || input.sections.length > 20) return null;
  const ids = new Set<string>();
  const sections: CmsSection[] = [];
  for (const raw of input.sections) {
    if (!isObject(raw)) return null;
    const id = bounded(raw.id, 100);
    const type = bounded(raw.type, 30) as CmsSectionType;
    if (!idPattern.test(id) || ids.has(id) || !sectionTypes.has(type)) return null;
    ids.add(id);
    const heading = bounded(raw.heading, 180);
    const body = bounded(raw.body, 2000);
    const eyebrow = bounded(raw.eyebrow, 100);
    const imageItemId = bounded(raw.imageItemId, 100);
    const primaryLabel = bounded(raw.primaryLabel, 80);
    const primaryHref = safeHref(raw.primaryHref);
    const secondaryLabel = bounded(raw.secondaryLabel, 80);
    const secondaryHref = safeHref(raw.secondaryHref);
    const galleryCategorySlug = bounded(raw.galleryCategorySlug, 80);
    const galleryLimit = Number(raw.galleryLimit ?? 12);
    const rawItems = Array.isArray(raw.items) ? raw.items : [];
    if (!heading || (imageItemId && !idPattern.test(imageItemId)) || (galleryCategorySlug && !slugPattern.test(galleryCategorySlug))) return null;
    if (!Number.isSafeInteger(galleryLimit) || galleryLimit < 1 || galleryLimit > 24 || rawItems.length > 12) return null;
    if ((primaryLabel && !primaryHref) || (primaryHref && !primaryLabel) || (secondaryLabel && !secondaryHref) || (secondaryHref && !secondaryLabel)) return null;
    const items: CmsFeature[] = [];
    for (const item of rawItems) {
      if (!isObject(item)) return null;
      const itemTitle = bounded(item.title, 160);
      const itemBody = bounded(item.body, 500);
      if (!itemTitle) return null;
      items.push({ title: itemTitle, body: itemBody });
    }
    if (type === "FEATURES" && !items.length) return null;
    sections.push({ id, type, enabled: raw.enabled !== false, eyebrow, heading, body, imageItemId, primaryLabel, primaryHref, secondaryLabel, secondaryHref, galleryCategorySlug, galleryLimit, items });
  }
  if (!sections.some((section) => section.enabled)) return null;
  return { version: 1, seo: { title, description }, sections };
}

export function parseCmsPageContentJson(value: string): CmsPageContent | null {
  if (value.length < 2 || value.length > 50_000) return null;
  try { return parseCmsPageContent(JSON.parse(value)); }
  catch { return null; }
}

export function serializeCmsPageContent(content: CmsPageContent): string {
  return JSON.stringify(content);
}

export const DEFAULT_SITE_CONTENT: Record<SitePageSlug, CmsPageContent> = {
  home: {
    version: 1,
    seo: { title: "NATHEE GROUP 2025 | ขนส่งรถจักรยานยนต์ครบวงจร", description: "บริการขนส่งรถจักรยานยนต์ รับฝากรถ ลานสต๊อก โหลดรถ และเตรียมงานส่งออก พร้อมหลักฐานและสถานะที่ตรวจสอบได้" },
    sections: [
      section("home-hero", "HERO", "ขนส่งรถจักรยานยนต์ · ทั่วประเทศและต่างประเทศ", "ขนส่งรถจักรยานยนต์ครบวงจร ตรวจสอบได้ทุกคัน", "รองรับงานรายคันถึงงานล็อต บริการรับฝากรถ ลานสต๊อก การโหลดรถและ Container พร้อมระบบติดตามสถานะสำหรับงานจริง", { primaryLabel: "ดูบริการของเรา", primaryHref: "/services", secondaryLabel: "ขอใบเสนอราคา", secondaryHref: "/contact" }),
      section("home-services", "FEATURES", "บริการของเรา", "ครอบคลุมทุกขั้นตอนการขนส่ง", "ตั้งแต่รับรถเข้าลาน ตรวจสภาพ จัดเก็บ ไปจนถึงส่งมอบปลายทาง", { items: [["ขนส่งในประเทศ", "รองรับรถใหม่ รถมือสอง งานรายคัน และงานล็อต"], ["ขนส่งต่างประเทศ", "เตรียมรถ จัดเรียง โหลดตู้ และเก็บหลักฐาน"], ["ลานสต๊อกและรับฝากรถ", "รับรถ ตรวจสภาพ และจัดเก็บตามพื้นที่"], ["โหลดรถและ Container", "จัดคิวการโหลด บันทึกภาพ และข้อมูลตู้กับ Seal"]] }),
      section("home-gallery", "GALLERY", "ผลงานจริง", "ภาพการปฏิบัติงานของบริษัท", "แสดงเฉพาะภาพที่ได้รับอนุญาตให้เผยแพร่", { galleryLimit: 8 }),
      section("home-contact", "CTA", "ติดต่อทีมงาน", "แจ้งรายละเอียดเพื่อประเมินงาน", "เตรียมจุดรับ จุดส่ง จำนวนรถ และวันที่ต้องการ", { primaryLabel: "โทร 063-194-1191", primaryHref: "tel:0631941191", secondaryLabel: "ขอใบเสนอราคา", secondaryHref: "/contact" }),
    ],
  },
  services: {
    version: 1,
    seo: { title: "บริการขนส่งรถจักรยานยนต์ | NATHEE GROUP 2025", description: "บริการขนส่งรถจักรยานยนต์ในประเทศและต่างประเทศ รับฝาก สต๊อก โหลดตู้ และส่งมอบสำหรับงานรายคันและงานล็อต" },
    sections: [
      section("services-hero", "HERO", "บริการของเรา", "บริการขนส่งรถจักรยานยนต์ครบวงจร", "รองรับงานรายคัน งานล็อต Dealer และ Fleet ตั้งแต่รับรถจนส่งมอบ"),
      section("services-list", "FEATURES", "ขอบเขตบริการ", "งานที่ทีมงานรองรับ", "เลือกบริการให้เหมาะกับจำนวนรถและเส้นทาง", { items: [["ขนส่งทั่วประเทศ", "รับงานรถจักรยานยนต์รายคันและงานล็อต"], ["ขนส่งต่างประเทศ", "เตรียมรถและงาน Container สำหรับส่งออก"], ["รับฝากและสต๊อก", "จัดเก็บรถและติดตามตำแหน่งในลาน"], ["ตรวจสภาพและหลักฐาน", "บันทึกภาพและสถานะก่อนรับ–ส่ง"], ["รถขนส่ง 4 ล้อ / 6 ล้อ", "จัดรถตามลักษณะและปริมาณงาน"], ["ส่งมอบปลายทาง", "เก็บหลักฐานการส่งมอบเพื่อการตรวจสอบ"]] }),
      section("services-cta", "CTA", "ประเมินงาน", "ขอใบเสนอราคาตามรายละเอียดจริง", "แจ้งต้นทาง ปลายทาง จำนวนรถ และวันที่ต้องการ", { primaryLabel: "ติดต่อทีมงาน", primaryHref: "/contact" }),
    ],
  },
  about: {
    version: 1,
    seo: { title: "เกี่ยวกับบริษัท นทีกรุ๊ป2025 จำกัด", description: "รู้จัก NATHEE GROUP 2025 ผู้ให้บริการขนส่ง รับฝาก จัดเก็บ และเตรียมรถจักรยานยนต์สำหรับงานในประเทศและส่งออก" },
    sections: [
      section("about-hero", "HERO", "เกี่ยวกับเรา", "บริษัท นทีกรุ๊ป2025 จำกัด", "ให้บริการขนส่งรถจักรยานยนต์ รับฝากและจัดเก็บรถ พร้อมรองรับงานโหลดและส่งออก"),
      section("about-work", "CONTENT", "การทำงาน", "ข้อมูลและหลักฐานที่ตรวจสอบได้", "ระบบงานออกแบบให้รถแต่ละคันมีสถานะ รูป และประวัติการปฏิบัติงานตามสิทธิ์ของผู้ใช้งาน"),
      section("about-gallery", "GALLERY", "ผลงาน", "ภาพจากการปฏิบัติงานจริง", "ไม่มีการใช้ภาพ Stock แทนผลงานบริษัท", { galleryLimit: 12 }),
    ],
  },
  contact: {
    version: 1,
    seo: { title: "ติดต่อ NATHEE GROUP 2025", description: "ติดต่อบริษัท นทีกรุ๊ป2025 จำกัด เพื่อสอบถามงานขนส่งรถจักรยานยนต์ รับฝาก สต๊อก และงานส่งออก" },
    sections: [
      section("contact-hero", "HERO", "ติดต่อเรา", "แจ้งรายละเอียดงานเพื่อให้ทีมงานประเมิน", "เตรียมจุดรับ จุดส่ง จำนวนรถ และวันที่ต้องการ"),
      section("contact-details", "CONTACT", "ช่องทางติดต่อ", "โทรติดต่อทีมงาน", "LINE Official อยู่ระหว่างยืนยัน หลีกเลี่ยงการส่งข้อมูลส่วนบุคคลผ่านช่องทางที่ยังไม่ได้ตรวจสอบ", { items: [["โทรศัพท์หลัก", "063-194-1191"], ["โทรศัพท์สำรอง", "085-680-2082"]] }),
    ],
  },
};

type SectionOptions = Omit<Partial<CmsSection>, "items"> & { items?: [string, string][] };

function section(id: string, type: CmsSectionType, eyebrow: string, heading: string, body: string, options: SectionOptions = {}): CmsSection {
  return {
    id, type, enabled: true, eyebrow, heading, body,
    imageItemId: options.imageItemId ?? "",
    primaryLabel: options.primaryLabel ?? "", primaryHref: options.primaryHref ?? "",
    secondaryLabel: options.secondaryLabel ?? "", secondaryHref: options.secondaryHref ?? "",
    galleryCategorySlug: options.galleryCategorySlug ?? "", galleryLimit: options.galleryLimit ?? 12,
    items: options.items?.map(([title, itemBody]) => ({ title, body: itemBody })) ?? [],
  };
}

function safeHref(value: unknown): string {
  const href = bounded(value, 300);
  if (!href) return "";
  if ((href.startsWith("/") && !href.startsWith("//")) || href.startsWith("#") || /^tel:\+?[0-9-]{7,20}$/.test(href)) return href;
  return "";
}

function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
