export const SITE_PAGE_DEFINITIONS = {
  home: { label: "หน้าแรก", path: "/" },
  services: { label: "บริการ", path: "/services" },
  "motorcycle-transport": { label: "ขนส่งรถจักรยานยนต์ทั่วประเทศ", path: "/motorcycle-transport" },
  international: { label: "ขนส่งต่างประเทศ", path: "/international" },
  storage: { label: "รับฝากและสต๊อกรถ", path: "/storage" },
  "container-loading": { label: "ขึ้นตู้ Container", path: "/container-loading" },
  "dealer-fleet": { label: "Dealer และ Fleet", path: "/dealer-fleet" },
  quotation: { label: "ขอใบเสนอราคา", path: "/quotation" },
  about: { label: "เกี่ยวกับเรา", path: "/about" },
  contact: { label: "ติดต่อ", path: "/contact" },
} as const;

export type SitePageSlug = keyof typeof SITE_PAGE_DEFINITIONS;
export type CmsSectionType = "HERO" | "CONTENT" | "FEATURES" | "GALLERY" | "FAQ" | "CTA" | "CONTACT";
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
/**
 * Whether a published page asks to be indexed.
 *
 * The same two values posts already use - `POST_ROBOTS` is this list - so a
 * page and a post answer one question one way rather than two lists that agree
 * today. `NOINDEX` means published but unlisted: a seasonal landing page, or
 * one linked only from a quotation. It is a different state from hidden, which
 * is not served at all.
 */
export const CMS_ROBOTS = ["INDEX", "NOINDEX"] as const;
export type CmsRobots = (typeof CMS_ROBOTS)[number];

export type CmsPageSeo = {
  title: string;
  description: string;
  robots: CmsRobots;
};

export type CmsPageContent = {
  version: 1;
  seo: CmsPageSeo;
  sections: CmsSection[];
};

/**
 * The SEO block for a page that ships with the release.
 *
 * Every managed page is indexable, which is exactly what the site published
 * before the field existed - the default reproduces today's behaviour rather
 * than changing it silently.
 */
function pageSeo(title: string, description: string): CmsPageSeo {
  return { title, description, robots: "INDEX" };
}

const sectionTypes = new Set<CmsSectionType>(["HERO", "CONTENT", "FEATURES", "GALLERY", "FAQ", "CTA", "CONTACT"]);
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
  // Absent means INDEX. Revisions are immutable, so a revision written before
  // this field existed has to keep parsing and has to keep meaning what it
  // meant when it was published. A value this list has never heard of is
  // refused rather than defaulted: silently widening to INDEX would publish a
  // page the Owner asked to keep out of search.
  const robots = input.seo.robots === undefined ? "INDEX" : bounded(input.seo.robots, 20);
  if (!CMS_ROBOTS.includes(robots as CmsRobots)) return null;
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
    if ((type === "FEATURES" || type === "FAQ") && !items.length) return null;
    sections.push({ id, type, enabled: raw.enabled !== false, eyebrow, heading, body, imageItemId, primaryLabel, primaryHref, secondaryLabel, secondaryHref, galleryCategorySlug, galleryLimit, items });
  }
  if (!sections.some((section) => section.enabled)) return null;
  return { version: 1, seo: { title, description, robots: robots as CmsRobots }, sections };
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
    seo: pageSeo("NATHEE GROUP 2025 | ขนส่งรถจักรยานยนต์ครบวงจร", "บริการขนส่งรถจักรยานยนต์ รับฝากรถ ลานสต๊อก โหลดรถ และเตรียมงานส่งออก พร้อมหลักฐานและสถานะที่ตรวจสอบได้"),
    sections: [
      section("home-hero", "HERO", "ขนส่งรถจักรยานยนต์ · ทั่วประเทศและต่างประเทศ", "ขนส่งรถจักรยานยนต์ครบวงจร ตรวจสอบได้ทุกคัน", "รองรับงานรายคันถึงงานล็อต บริการรับฝากรถ ลานสต๊อก การโหลดรถและ Container พร้อมระบบติดตามสถานะสำหรับงานจริง", { imageItemId: "motorcycle-truck-loading-01", primaryLabel: "ดูบริการของเรา", primaryHref: "/services", secondaryLabel: "ขอใบเสนอราคา", secondaryHref: "/quotation" }),
      section("home-services", "FEATURES", "บริการของเรา", "ครอบคลุมทุกขั้นตอนการขนส่ง", "ตั้งแต่รับรถเข้าลาน ตรวจสภาพ จัดเก็บ ไปจนถึงส่งมอบปลายทาง", { items: [["ขนส่งในประเทศ", "รองรับรถใหม่ รถมือสอง งานรายคัน และงานล็อต"], ["ขนส่งต่างประเทศ", "เตรียมรถ จัดเรียง โหลดตู้ และเก็บหลักฐาน"], ["ลานสต๊อกและรับฝากรถ", "รับรถ ตรวจสภาพ และจัดเก็บตามพื้นที่"], ["โหลดรถและ Container", "จัดคิวการโหลด บันทึกภาพ และข้อมูลตู้กับ Seal"]] }),
      section("home-gallery", "GALLERY", "ผลงานจริง", "ภาพการปฏิบัติงานของบริษัท", "แสดงเฉพาะภาพที่ได้รับอนุญาตให้เผยแพร่", { galleryLimit: 8 }),
      section("home-contact", "CTA", "ติดต่อทีมงาน", "แจ้งรายละเอียดเพื่อประเมินงาน", "เตรียมจุดรับ จุดส่ง จำนวนรถ และวันที่ต้องการ", { primaryLabel: "โทร 063-194-1191", primaryHref: "tel:0631941191", secondaryLabel: "ขอใบเสนอราคา", secondaryHref: "/quotation" }),
    ],
  },
  services: {
    version: 1,
    seo: pageSeo("บริการขนส่งรถจักรยานยนต์ | NATHEE GROUP 2025", "บริการขนส่งรถจักรยานยนต์ในประเทศและต่างประเทศ รับฝาก สต๊อก โหลดตู้ และส่งมอบสำหรับงานรายคันและงานล็อต"),
    sections: [
      section("services-hero", "HERO", "บริการของเรา", "บริการขนส่งรถจักรยานยนต์ครบวงจร", "รองรับงานรายคัน งานล็อต Dealer และ Fleet ตั้งแต่รับรถจนส่งมอบ", { imageItemId: "motorcycle-fleet-staging-01", primaryLabel: "ขอใบเสนอราคา", primaryHref: "/quotation" }),
      section("services-list", "FEATURES", "ขอบเขตบริการ", "งานที่ทีมงานรองรับ", "เลือกบริการให้เหมาะกับจำนวนรถและเส้นทาง", { items: [["ขนส่งทั่วประเทศ", "รับงานรถจักรยานยนต์รายคันและงานล็อต"], ["ขนส่งต่างประเทศ", "เตรียมรถและงาน Container สำหรับส่งออก"], ["รับฝากและสต๊อก", "จัดเก็บรถและติดตามตำแหน่งในลาน"], ["ตรวจสภาพและหลักฐาน", "บันทึกภาพและสถานะก่อนรับ–ส่ง"], ["รถขนส่ง 4 ล้อ / 6 ล้อ", "จัดรถตามลักษณะและปริมาณงาน"], ["ส่งมอบปลายทาง", "เก็บหลักฐานการส่งมอบเพื่อการตรวจสอบ"]] }),
      section("services-process", "FEATURES", "ขั้นตอนการทำงาน", "ตั้งแต่รับข้อมูลจนส่งมอบ", "ทีมงานยืนยันขอบเขตจากข้อมูลจริงก่อนเริ่มงาน", { items: [["รับรายละเอียด", "ตรวจต้นทาง ปลายทาง จำนวนรถ และกำหนดเวลา"], ["วางแผน", "เลือกวิธีขนส่งและพื้นที่จัดเก็บตามลักษณะงาน"], ["ปฏิบัติงาน", "รับรถ จัดเรียง ขนส่ง หรือขึ้นตู้ตามขอบเขตที่ยืนยัน"], ["ส่งมอบ", "ตรวจรายการและเก็บหลักฐานตามที่ได้รับอนุญาต"]] }),
      section("services-gallery", "GALLERY", "ผลงานจริง", "รถขนส่ง ลาน และงานโหลดของบริษัท", "แสดงภาพจริงที่ได้รับอนุญาตให้เผยแพร่", { galleryLimit: 9 }),
      section("services-faq", "FAQ", "คำถามที่พบบ่อย", "ข้อมูลก่อนขอรับบริการ", "หากรายละเอียดต่างจากนี้ ทีมงานจะตรวจสอบเป็นรายงาน", { items: [["รับงานรายคันหรือไม่", "รองรับทั้งงานรายคันและงานล็อต โดยประเมินจากเส้นทางและกำหนดเวลาจริง"], ["มีบริการรับฝากรถหรือไม่", "มีบริการรับฝากและสต๊อกรถ โดยต้องยืนยันพื้นที่และระยะเวลากับทีมงานก่อน"], ["ต้องเตรียมข้อมูลอะไร", "ควรมีต้นทาง ปลายทาง จำนวนและประเภทรถ วันที่ต้องการ และบริการเพิ่มเติม"]] }),
      section("services-cta", "CTA", "ประเมินงาน", "ขอใบเสนอราคาตามรายละเอียดจริง", "แจ้งต้นทาง ปลายทาง จำนวนรถ และวันที่ต้องการ", { primaryLabel: "ขอใบเสนอราคา", primaryHref: "/quotation", secondaryLabel: "โทร 063-194-1191", secondaryHref: "tel:0631941191" }),
    ],
  },
  "motorcycle-transport": {
    version: 1,
    seo: pageSeo("ขนส่งรถจักรยานยนต์ทั่วประเทศ | NATHEE GROUP 2025", "บริการขนส่งรถจักรยานยนต์ทั่วประเทศ รองรับงานรายคันและงานล็อต ด้วยรถขนส่ง 4 ล้อและ 6 ล้อ ตามลักษณะงานจริง"),
    sections: [
      section("motorcycle-transport-hero", "HERO", "ขนส่งภายในประเทศ", "ขนส่งรถจักรยานยนต์ทั่วประเทศ", "รองรับรถใหม่ รถมือสอง งานรายคัน และงานล็อต โดยจัดรูปแบบรถขนส่งให้เหมาะกับจำนวนและเส้นทาง", { imageItemId: "motorcycle-truck-loading-01", primaryLabel: "ขอใบเสนอราคา", primaryHref: "/quotation", secondaryLabel: "ดูผลงาน", secondaryHref: "/gallery" }),
      section("motorcycle-transport-scope", "FEATURES", "ขอบเขตงาน", "วางแผนตามงานจริงทุกเที่ยว", "รายละเอียดรถ ต้นทาง ปลายทาง และวันนัดหมายถูกใช้ประกอบการประเมินก่อนรับงาน", { items: [["รถขนส่ง 4 ล้อ", "รองรับงานตามลักษณะและจำนวนรถที่เหมาะสม"], ["รถขนส่ง 6 ล้อ", "รองรับงานล็อตและการวางแผนพื้นที่บรรทุก"], ["รับ–ส่งตามจุดนัดหมาย", "ยืนยันต้นทาง ปลายทาง และผู้ประสานงานก่อนปฏิบัติงาน"], ["หลักฐานการปฏิบัติงาน", "บันทึกข้อมูลและภาพตามขั้นตอนที่ได้รับอนุญาต"]] }),
      section("motorcycle-transport-gallery", "GALLERY", "ผลงานจริง", "ภาพงานขนส่งรถจักรยานยนต์", "แสดงเฉพาะภาพที่แอดมินอนุมัติให้เผยแพร่", { galleryCategorySlug: "truck-loading", galleryLimit: 12 }),
      section("motorcycle-transport-faq", "FAQ", "คำถามที่พบบ่อย", "ขนส่งรถจักรยานยนต์ในประเทศ", "คำตอบขึ้นอยู่กับข้อมูลและกำหนดเวลาจริงของงาน", { items: [["รับรถแบบใด", "รองรับรถจักรยานยนต์ใหม่ รถมือสอง งานรายคัน และงานล็อต"], ["ใช้รถขนส่งแบบใด", "ทีมงานเลือกใช้รถ 4 ล้อหรือ 6 ล้อตามจำนวนรถ เส้นทาง และความเหมาะสม"], ["ติดตามงานอย่างไร", "ทีมงานประสานสถานะตามข้อมูลผู้ติดต่อและขอบเขตที่ตกลง"]] }),
      section("motorcycle-transport-cta", "CTA", "เริ่มประเมินงาน", "แจ้งจำนวนรถและเส้นทาง", "เตรียมต้นทาง ปลายทาง จำนวนรถ และวันที่ต้องการ", { primaryLabel: "ขอใบเสนอราคา", primaryHref: "/quotation", secondaryLabel: "โทร 063-194-1191", secondaryHref: "tel:0631941191" }),
    ],
  },
  international: {
    version: 1,
    seo: pageSeo("ขนส่งรถจักรยานยนต์ต่างประเทศ | NATHEE GROUP 2025", "บริการเตรียมรถจักรยานยนต์ จัดเรียง ขึ้นตู้ Container และจัดเก็บหลักฐานสำหรับงานขนส่งต่างประเทศ"),
    sections: [
      section("international-hero", "HERO", "งานส่งออก", "ขนส่งรถจักรยานยนต์ต่างประเทศ", "รองรับการเตรียมรถ จัดเรียง ขึ้นตู้ Container และจัดเก็บหลักฐานตามขอบเขตงานที่ตกลง", { imageItemId: "motorcycle-container-loading-01", primaryLabel: "ขอใบเสนอราคา", primaryHref: "/quotation", secondaryLabel: "ดูงานขึ้นตู้", secondaryHref: "/container-loading" }),
      section("international-process", "FEATURES", "ขั้นตอนงาน", "เตรียมข้อมูลก่อนดำเนินการ", "ขอบเขตและเอกสารที่ต้องใช้ขึ้นอยู่กับปลายทางและผู้รับผิดชอบงาน", { items: [["ตรวจรายการรถ", "ยืนยันจำนวนและข้อมูลรถตามรายการที่ได้รับ"], ["เตรียมและจัดเรียง", "วางแผนการจัดเรียงตามพื้นที่และรูปแบบงาน"], ["ขึ้นตู้ Container", "ดำเนินการโหลดและเก็บภาพตามขั้นตอน"], ["ส่งมอบหลักฐาน", "รวบรวมข้อมูลที่ได้รับอนุญาตให้ผู้เกี่ยวข้องตรวจสอบ"]] }),
      section("international-gallery", "GALLERY", "ผลงานจริง", "ภาพการเตรียมและโหลดรถ", "ไม่มีการใช้ภาพ Stock แทนผลงานบริษัท", { galleryCategorySlug: "container", galleryLimit: 12 }),
      section("international-faq", "FAQ", "คำถามที่พบบ่อย", "ข้อมูลสำหรับงานต่างประเทศ", "เอกสารและข้อกำหนดต้องตรวจตามประเทศปลายทางและผู้รับผิดชอบ", { items: [["บริษัทดูแลขั้นตอนไหน", "รองรับการเตรียมรถ จัดเรียง ขึ้นตู้ และเก็บหลักฐานตามขอบเขตที่ตกลง"], ["เอกสารส่งออกใช้อะไรบ้าง", "รายการเอกสารขึ้นอยู่กับปลายทางและคู่สัญญา ทีมงานจะไม่เดาเอกสารแทนผู้รับผิดชอบ"], ["ประเมินราคาอย่างไร", "ใช้จำนวนรถ รูปแบบตู้ จุดปฏิบัติงาน ปลายทาง และกำหนดเวลาจริง"]] }),
      section("international-cta", "CTA", "ประเมินงานต่างประเทศ", "แจ้งปลายทางและจำนวนรถ", "ทีมงานจะตรวจขอบเขตงานจากข้อมูลจริงก่อนเสนอราคา", { primaryLabel: "ขอใบเสนอราคา", primaryHref: "/quotation", secondaryLabel: "ติดต่อทีมงาน", secondaryHref: "/contact" }),
    ],
  },
  storage: {
    version: 1,
    seo: pageSeo("รับฝากรถและสต๊อกรถจักรยานยนต์ | NATHEE GROUP 2025", "บริการรับฝากรถ สต๊อกรถจักรยานยนต์และสินค้า พร้อมการรับเข้า จัดเก็บ และส่งมอบตามข้อมูลจริง"),
    sections: [
      section("storage-hero", "HERO", "ลานและคลัง", "รับฝากรถ สต๊อกรถ และสต๊อกสินค้า", "รองรับการรับเข้า จัดเก็บ และเตรียมส่งมอบ โดยประเมินพื้นที่และระยะเวลาจากงานจริง", { imageItemId: "motorcycle-storage-yard-01", primaryLabel: "ขอใบเสนอราคา", primaryHref: "/quotation", secondaryLabel: "ดูผลงาน", secondaryHref: "/gallery" }),
      section("storage-process", "FEATURES", "การดูแลรายการ", "ข้อมูลรถชัดเจนตลอดการจัดเก็บ", "ขั้นตอนจริงขึ้นอยู่กับขอบเขตบริการที่ตกลงกับลูกค้า", { items: [["รับรถเข้าพื้นที่", "บันทึกรายการรถและข้อมูลที่จำเป็นก่อนจัดเก็บ"], ["ตรวจสภาพ", "เก็บหลักฐานตามสิทธิ์และขอบเขตงาน"], ["จัดเก็บตามพื้นที่", "บริหารตำแหน่งรถตามการปฏิบัติงานจริง"], ["เตรียมส่งมอบ", "ตรวจรายการและนัดหมายก่อนนำรถออก"]] }),
      section("storage-gallery", "GALLERY", "พื้นที่และผลงาน", "ภาพการจัดเก็บรถจริง", "แสดงเฉพาะภาพที่ได้รับอนุญาตให้เผยแพร่", { galleryCategorySlug: "storage", galleryLimit: 12 }),
      section("storage-faq", "FAQ", "คำถามที่พบบ่อย", "การรับฝากและสต๊อกรถ", "พื้นที่และระยะเวลาต้องได้รับการยืนยันก่อนนำรถเข้าลาน", { items: [["รับฝากรถระยะสั้นหรือไม่", "ทีมงานประเมินตามระยะเวลา จำนวนรถ และพื้นที่ที่มีจริงในช่วงนั้น"], ["มีการบันทึกรถเข้าออกหรือไม่", "ขอบเขตงานรองรับการบันทึกรายการ ตรวจสภาพ และเตรียมส่งมอบตามที่ตกลง"], ["นำรถเข้าลานได้ทันทีหรือไม่", "ควรติดต่อยืนยันพื้นที่ จุดรับรถ และเวลานัดหมายก่อนทุกครั้ง"]] }),
      section("storage-cta", "CTA", "ต้องการพื้นที่จัดเก็บ", "แจ้งจำนวนรถและช่วงเวลาที่ต้องการ", "ทีมงานจะประเมินจากพื้นที่และเงื่อนไขงานจริง", { primaryLabel: "ขอใบเสนอราคา", primaryHref: "/quotation", secondaryLabel: "โทร 085-680-2082", secondaryHref: "tel:0856802082" }),
    ],
  },
  "container-loading": {
    version: 1,
    seo: pageSeo("รับขึ้นตู้รถจักรยานยนต์และส่งออก | NATHEE GROUP 2025", "บริการเตรียม จัดเรียง และขึ้นตู้ Container สำหรับรถจักรยานยนต์ พร้อมบันทึกหลักฐานตามขอบเขตงาน"),
    sections: [
      section("container-loading-hero", "HERO", "Container", "รับขึ้นตู้ Container และเตรียมส่งออก", "จัดเตรียมรถ วางแผนการจัดเรียง และดำเนินการขึ้นตู้ตามรายการงานจริง", { imageItemId: "motorcycle-container-loading-01", primaryLabel: "ขอใบเสนอราคา", primaryHref: "/quotation", secondaryLabel: "ดูผลงาน", secondaryHref: "/gallery" }),
      section("container-loading-process", "FEATURES", "กระบวนการ", "ตรวจสอบก่อนปิดงาน", "ข้อมูลตู้และข้อกำหนดที่เกี่ยวข้องต้องได้รับการยืนยันจากผู้รับผิดชอบ", { items: [["ตรวจรายการรถ", "เทียบจำนวนและข้อมูลรถก่อนเริ่มโหลด"], ["เตรียมรถ", "จัดเตรียมตามขอบเขตงานที่ตกลง"], ["จัดเรียงและขึ้นตู้", "วางตำแหน่งและยึดรถตามการปฏิบัติงาน"], ["เก็บหลักฐาน", "บันทึกภาพและข้อมูลที่ได้รับอนุญาตก่อนส่งมอบงาน"]] }),
      section("container-loading-gallery", "GALLERY", "ผลงานจริง", "ภาพการขึ้นตู้รถจักรยานยนต์", "ภาพจากการปฏิบัติงานจริงของบริษัท", { galleryCategorySlug: "container", galleryLimit: 12 }),
      section("container-loading-faq", "FAQ", "คำถามที่พบบ่อย", "การเตรียมและขึ้นตู้", "รายละเอียดต้องยืนยันจากรายการรถและข้อมูลตู้จริง", { items: [["รองรับรถจำนวนเท่าใด", "จำนวนขึ้นอยู่กับรุ่นรถ รูปแบบตู้ และแผนการจัดเรียง จึงต้องตรวจรายการจริงก่อน"], ["มีภาพหลักฐานหรือไม่", "สามารถเก็บภาพตามขั้นตอนและขอบเขตที่ผู้รับผิดชอบอนุญาต"], ["ต้องเตรียมอะไร", "ควรมีรายการรถ ข้อมูลตู้ จุดปฏิบัติงาน กำหนดเวลา และข้อกำหนดจากผู้รับผิดชอบ"]] }),
      section("container-loading-cta", "CTA", "ประเมินงาน Container", "แจ้งจำนวนรถและรายละเอียดตู้", "ทีมงานจะตรวจความพร้อมจากข้อมูลจริงก่อนเสนอราคา", { primaryLabel: "ขอใบเสนอราคา", primaryHref: "/quotation", secondaryLabel: "ติดต่อทีมงาน", secondaryHref: "/contact" }),
    ],
  },
  "dealer-fleet": {
    version: 1,
    seo: pageSeo("ขนส่งรถมอเตอร์ไซค์ Dealer และ Fleet | NATHEE GROUP 2025", "บริการขนส่งรถจักรยานยนต์สำหรับ Dealer, Fleet และงานล็อตใหญ่ พร้อมการวางแผนรับเข้า ขนส่ง และส่งมอบ"),
    sections: [
      section("dealer-fleet-hero", "HERO", "งานล็อต", "งาน Dealer, Fleet และงานล็อตใหญ่", "รองรับการวางแผนรถขนส่ง ลำดับรับ–ส่ง และข้อมูลรถจำนวนมากตามรายการที่ได้รับ", { imageItemId: "motorcycle-fleet-staging-01", primaryLabel: "ขอใบเสนอราคา", primaryHref: "/quotation", secondaryLabel: "ดูผลงาน", secondaryHref: "/gallery" }),
      section("dealer-fleet-process", "FEATURES", "การประสานงาน", "จัดการรายการจำนวนมากอย่างเป็นระบบ", "ทุกงานประเมินจากจำนวนรถ เส้นทาง และกำหนดเวลาจริง", { items: [["ตรวจรายการรถ", "รับข้อมูลรถและตรวจความครบถ้วนก่อนวางแผน"], ["จัดรอบขนส่ง", "วางแผนรถ 4 ล้อหรือ 6 ล้อตามลักษณะงาน"], ["ติดตามสถานะ", "บันทึกสถานะตามขั้นตอนที่เกิดขึ้นจริง"], ["ส่งมอบและหลักฐาน", "เก็บข้อมูลการส่งมอบตามขอบเขตที่ตกลง"]] }),
      section("dealer-fleet-gallery", "GALLERY", "ผลงานจริง", "ภาพงานล็อตและการจัดเตรียมรถ", "แสดงเฉพาะภาพจริงที่ได้รับอนุญาต", { galleryCategorySlug: "dealer-fleet", galleryLimit: 12 }),
      section("dealer-fleet-faq", "FAQ", "คำถามที่พบบ่อย", "งาน Dealer, Fleet และงานล็อต", "วางแผนจากรายการรถและกำหนดส่งมอบจริง", { items: [["รองรับหลายจุดส่งหรือไม่", "สามารถประเมินงานหลายจุดได้เมื่อมีรายการ จุดรับส่ง และช่วงเวลาครบถ้วน"], ["จัดรถขนส่งอย่างไร", "เลือกใช้รถ 4 ล้อหรือ 6 ล้อตามจำนวนรถ เส้นทาง และข้อจำกัดหน้างาน"], ["ส่งรายการรถแบบใด", "ทีมงานจะยืนยันรูปแบบรายการที่ใช้จริงก่อนเริ่มงานเพื่อลดข้อมูลคลาดเคลื่อน"]] }),
      section("dealer-fleet-cta", "CTA", "วางแผนงานล็อต", "ส่งรายละเอียดให้ทีมงานประเมิน", "ระบุจำนวนรถ จุดรับ จุดส่ง และช่วงเวลาที่ต้องการ", { primaryLabel: "ขอใบเสนอราคา", primaryHref: "/quotation", secondaryLabel: "โทร 063-194-1191", secondaryHref: "tel:0631941191" }),
    ],
  },
  quotation: {
    version: 1,
    seo: pageSeo("ขอใบเสนอราคาขนส่งรถจักรยานยนต์ | NATHEE GROUP 2025", "เตรียมข้อมูลต้นทาง ปลายทาง จำนวนรถ ประเภทรถ และวันที่ต้องการ เพื่อขอใบเสนอราคาจาก NATHEE GROUP 2025"),
    sections: [
      section("quotation-hero", "HERO", "ประเมินจากงานจริง", "ขอใบเสนอราคา", "ติดต่อทีมงานพร้อมรายละเอียดงาน เพื่อให้ตรวจขอบเขตและประเมินราคาโดยไม่ใช้ตัวเลขตัวอย่าง", { primaryLabel: "โทร 063-194-1191", primaryHref: "tel:0631941191", secondaryLabel: "ช่องทางติดต่อ", secondaryHref: "/contact" }),
      section("quotation-details", "FEATURES", "ข้อมูลที่ควรเตรียม", "ช่วยให้ประเมินงานได้ครบถ้วน", "หากข้อมูลส่วนใดยังไม่พร้อม สามารถแจ้งทีมงานเพื่อช่วยตรวจสอบรายการที่ต้องใช้", { items: [["ต้นทางและปลายทาง", "ระบุพื้นที่รับรถและพื้นที่ส่งมอบ"], ["จำนวนและประเภทรถ", "แจ้งจำนวนรถและข้อมูลที่เกี่ยวข้องกับการจัดขนส่ง"], ["วันที่ต้องการ", "ระบุวันรับรถหรือช่วงเวลาที่ต้องการให้ดำเนินงาน"], ["บริการเพิ่มเติม", "แจ้งความต้องการรับฝาก สต๊อก ขึ้นตู้ หรือส่งออก"]] }),
      section("quotation-faq", "FAQ", "คำถามที่พบบ่อย", "ก่อนส่งคำขอใบเสนอราคา", "ระบบออกเลขอ้างอิงเมื่อบันทึกข้อมูลลงฐานข้อมูลสำเร็จเท่านั้น", { items: [["ส่งคำขอแล้วเป็นการยืนยันรับงานหรือไม่", "ยังไม่ใช่ ทีมงานต้องตรวจรายละเอียด ความพร้อม และยืนยันราคาเงื่อนไขก่อน"], ["ข้อมูลใดจำเป็น", "ชื่อผู้ติดต่อ เบอร์โทร ต้นทาง ปลายทาง จำนวนรถ และประเภทรถเป็นข้อมูลขั้นต่ำ"], ["ยังไม่ทราบวันที่แน่นอนได้หรือไม่", "ได้ สามารถเว้นวันที่ไว้และระบุช่วงเวลาหรือรายละเอียดเพิ่มเติมในช่องหมายเหตุ"]] }),
      section("quotation-contact", "CONTACT", "ติดต่อทีมงาน", "สอบถามและส่งรายละเอียด", "ทีมงานจะยืนยันขอบเขตและข้อมูลที่จำเป็นก่อนเสนอราคา", { items: [["โทรศัพท์หลัก", "063-194-1191"], ["โทรศัพท์สำรอง", "085-680-2082"]], primaryLabel: "ดูบริการทั้งหมด", primaryHref: "/services" }),
    ],
  },
  about: {
    version: 1,
    seo: pageSeo("เกี่ยวกับบริษัท นทีกรุ๊ป2025 จำกัด", "รู้จัก NATHEE GROUP 2025 ผู้ให้บริการขนส่ง รับฝาก จัดเก็บ และเตรียมรถจักรยานยนต์สำหรับงานในประเทศและส่งออก"),
    sections: [
      section("about-hero", "HERO", "เกี่ยวกับเรา", "บริษัท นทีกรุ๊ป2025 จำกัด", "ให้บริการขนส่งรถจักรยานยนต์ รับฝากและจัดเก็บรถ พร้อมรองรับงานโหลดและส่งออก", { imageItemId: "nathee-yard-front-01", primaryLabel: "ขอใบเสนอราคา", primaryHref: "/quotation" }),
      section("about-capability", "FEATURES", "ศักยภาพจากงานจริง", "ลาน รถขนส่ง และทีมโหลดที่มีภาพยืนยัน", "นำเสนอเฉพาะสิ่งที่ตรวจสอบได้จากการปฏิบัติงานจริงโดยไม่ใช้ตัวเลขสถิติที่ยังไม่ยืนยัน", { items: [["พื้นที่ลาน", "มีภาพพื้นที่รับรถ จัดเรียง และเตรียมรถจักรยานยนต์จำนวนมาก"], ["รถขนส่ง 4 ล้อ", "มีภาพรถ 4 ล้อพร้อมโครงบรรทุกสำหรับงานขนส่งรถจักรยานยนต์"], ["รถขนส่ง 6 ล้อ", "มีภาพรถบรรทุก 6 ล้อพร้อมชื่อและข้อมูลติดต่อของบริษัท"], ["งาน Container", "มีภาพการจัดเรียงและยึดรถจักรยานยนต์ภายในตู้ระหว่างปฏิบัติงาน"]] }),
      section("about-work", "CONTENT", "การทำงาน", "ข้อมูลและหลักฐานที่ตรวจสอบได้", "ระบบงานออกแบบให้รถแต่ละคันมีสถานะ รูป และประวัติการปฏิบัติงานตามสิทธิ์ของผู้ใช้งาน", { imageItemId: "nathee-six-wheel-truck-01" }),
      section("about-gallery", "GALLERY", "ผลงาน", "ภาพจากการปฏิบัติงานจริง", "ไม่มีการใช้ภาพ Stock แทนผลงานบริษัท", { galleryLimit: 12 }),
    ],
  },
  contact: {
    version: 1,
    seo: pageSeo("ติดต่อ NATHEE GROUP 2025", "ติดต่อบริษัท นทีกรุ๊ป2025 จำกัด เพื่อสอบถามงานขนส่งรถจักรยานยนต์ รับฝาก สต๊อก และงานส่งออก"),
    sections: [
      section("contact-hero", "HERO", "ติดต่อเรา", "แจ้งรายละเอียดงานเพื่อให้ทีมงานประเมิน", "เตรียมจุดรับ จุดส่ง จำนวนรถ และวันที่ต้องการ", { imageItemId: "nathee-yard-front-01", primaryLabel: "ขอใบเสนอราคา", primaryHref: "/quotation" }),
      section("contact-details", "CONTACT", "ช่องทางติดต่อ", "โทรติดต่อทีมงาน", "หน้าเว็บไซต์สาธารณะมี QR LINE ที่ Owner มอบให้โดยตรง โดยไม่มีการเดาชื่อ LINE ID", { items: [["โทรศัพท์หลัก", "063-194-1191"], ["โทรศัพท์สำรอง", "085-680-2082"], ["LINE", "สแกน QR บนหน้าติดต่อของเว็บไซต์"]] }),
      section("contact-location", "CONTENT", "การเดินทาง", "ค้นหาชื่อบริษัทบน Google Maps แล้วโทรยืนยันก่อนเดินทาง", "ระบบยังไม่มีพิกัดหรือที่อยู่ที่ Owner ยืนยัน จึงไม่ปักหมุดเดา กรุณาโทรยืนยันจุดนัดหมายก่อนเดินทาง", { primaryLabel: "ค้นหาใน Google Maps", primaryHref: "https://www.google.com/maps/search/?api=1&query=%E0%B8%9A%E0%B8%A3%E0%B8%B4%E0%B8%A9%E0%B8%B1%E0%B8%97+%E0%B8%99%E0%B8%97%E0%B8%B5%E0%B8%81%E0%B8%A3%E0%B8%B8%E0%B9%8A%E0%B8%9B2025+%E0%B8%88%E0%B8%B3%E0%B8%81%E0%B8%B1%E0%B8%94", secondaryLabel: "โทร 063-194-1191", secondaryHref: "tel:0631941191" }),
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
  if (href === "https://www.google.com/maps/search/?api=1&query=%E0%B8%9A%E0%B8%A3%E0%B8%B4%E0%B8%A9%E0%B8%B1%E0%B8%97+%E0%B8%99%E0%B8%97%E0%B8%B5%E0%B8%81%E0%B8%A3%E0%B8%B8%E0%B9%8A%E0%B8%9B2025+%E0%B8%88%E0%B8%B3%E0%B8%81%E0%B8%B1%E0%B8%94") return href;
  return "";
}

function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
