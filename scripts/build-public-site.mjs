import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public-site");
const domain = "https://natheegroup2025.com";
const company = "บริษัท นทีกรุ๊ป2025 จำกัด";
const appName = "NATHEE GROUP 2025";
const appShortName = "NATHEE 2025";
const appDescription = "บริการขนส่งรถจักรยานยนต์ทั่วประเทศและต่างประเทศ รับฝาก สต๊อก ขึ้นตู้ Container และงาน Dealer หรือ Fleet";
const mapsSearch = "https://www.google.com/maps/search/?api=1&query=%E0%B8%9A%E0%B8%A3%E0%B8%B4%E0%B8%A9%E0%B8%B1%E0%B8%97+%E0%B8%99%E0%B8%97%E0%B8%B5%E0%B8%81%E0%B8%A3%E0%B8%B8%E0%B9%8A%E0%B8%9B2025+%E0%B8%88%E0%B8%B3%E0%B8%81%E0%B8%B1%E0%B8%94";
const manifest = JSON.parse(await readFile(join(root, "assets", "gallery.json"), "utf8"));
const categoryLabels = new Map(manifest.categories.map((item) => [item.id, item.label]));
const galleryItems = manifest.items
  .filter((item) => item.status === "PUBLISHED")
  .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || Number(a.order) - Number(b.order));

const pages = [
  {
    route: "/services/", title: "บริการขนส่งรถจักรยานยนต์ครบวงจร | NATHEE GROUP 2025", description: "รวมบริการขนส่งรถจักรยานยนต์ทั่วประเทศและต่างประเทศ รับฝากรถ สต๊อก ขึ้นตู้ Container และงาน Dealer หรือ Fleet",
    eyebrow: "OUR SERVICES", heading: "บริการขนส่งที่วางแผนตามงานจริง", intro: "รองรับรถใหม่ รถมือสอง งานรายคัน และงานล็อตใหญ่ โดยประเมินจากจุดรับส่ง จำนวนรถ ช่วงเวลา และข้อกำหนดของแต่ละงาน",
    cards: [["ขนส่งในประเทศ", "รับส่งรถจักรยานยนต์ระหว่างจังหวัด พร้อมวางแผนรถ 4 ล้อหรือ 6 ล้อตามจำนวน", "/motorcycle-transport/"], ["ขนส่งต่างประเทศ", "ประสานงานการเตรียมรถและรายละเอียดสำหรับการขนส่งต่างประเทศ", "/international/"], ["รับฝากและสต๊อก", "รองรับการรับฝากรถ สต๊อกรถ และสต๊อกสินค้าตามข้อตกลง", "/storage/"], ["Container และส่งออก", "เตรียมและจัดลำดับรถสำหรับขึ้นตู้ Container", "/container-loading/"], ["Dealer / Fleet", "รองรับงานประจำ งานหลายคัน และการวางแผนเป็นล็อต", "/dealer-fleet/"]],
    workflow: [["รับรายละเอียด", "ตรวจเส้นทาง จำนวนรถ วันที่ และบริการที่ต้องใช้"], ["ประเมินงาน", "เลือกแนวทาง รถขนส่ง และขั้นตอนจากข้อมูลจริง"], ["ยืนยันขอบเขต", "ตกลงจุดรับส่ง ผู้ประสานงาน และหลักฐานที่ต้องจัดเก็บ"], ["ปฏิบัติงาน", "ดำเนินงานและส่งมอบตามรายการที่ยืนยัน"]], categories: [],
    faqs: [["ต้องเตรียมข้อมูลอะไรเพื่อขอราคา", "แจ้งต้นทาง ปลายทาง จำนวนและประเภทรถ วันที่ต้องการ และบริการเพิ่มเติม เช่น รับฝากหรือขึ้นตู้"], ["รับงานรายคันและงานล็อตหรือไม่", "บริษัทให้บริการทั้งงานรายคันและงานล็อต โดยประเมินวิธีขนส่งจากรายละเอียดจริง"], ["มีรถขนส่งแบบใด", "ข้อมูลที่ยืนยันแล้วระบุว่ารองรับรถขนส่ง 4 ล้อและ 6 ล้อ โดยเลือกใช้ตามลักษณะงาน"]],
  },
  {
    route: "/motorcycle-transport/", title: "ขนส่งรถจักรยานยนต์ทั่วประเทศ | NATHEE GROUP 2025", description: "บริการขนส่งมอเตอร์ไซค์ทั่วประเทศและต่างจังหวัด รองรับรถใหม่ รถมือสอง งานรายคัน และงานจำนวนมาก",
    eyebrow: "DOMESTIC TRANSPORT", heading: "ขนส่งรถจักรยานยนต์ทั่วประเทศ", intro: "แจ้งต้นทาง ปลายทาง จำนวนรถ และวันที่ต้องการ ทีมงานจะประเมินรูปแบบรถขนส่งและแผนการรับส่งให้เหมาะกับงานจริง",
    workflow: [["ส่งข้อมูลรถ", "แจ้งจำนวน ประเภท และสภาพข้อมูลเบื้องต้นของรถ"], ["ยืนยันจุดรับ–ส่ง", "ระบุพื้นที่ ผู้ประสานงาน และช่วงเวลาที่ต้องการ"], ["จัดรถขนส่ง", "ประเมินรถ 4 ล้อหรือ 6 ล้อตามลักษณะและจำนวน"], ["ส่งมอบ", "ตรวจรายการปลายทางตามขอบเขตงานที่ตกลง"]], categories: ["truck-4", "truck-6", "truck-loading", "delivery"],
    faqs: [["ขนส่งได้ทั้งรถใหม่และรถมือสองหรือไม่", "รองรับทั้งรถใหม่และรถมือสอง โดยทีมงานประเมินจากรายละเอียดรถและงานจริง"], ["ต้องจองล่วงหน้านานเท่าใด", "ระยะเวลาขึ้นอยู่กับเส้นทาง จำนวนรถ และตารางงาน กรุณาแจ้งวันที่ต้องการเพื่อให้ทีมงานตรวจคิวจริง"], ["คิดราคาจากอะไร", "ทีมงานประเมินจากต้นทาง ปลายทาง จำนวนรถ ประเภทรถ วันที่ และบริการเพิ่มเติม โดยไม่ใช้ราคาตัวอย่างบนเว็บไซต์"]],
  },
  {
    route: "/international/", title: "ขนส่งรถจักรยานยนต์ต่างประเทศ | NATHEE GROUP 2025", description: "บริการประสานงานขนส่งรถจักรยานยนต์ต่างประเทศ เตรียมรถ จัดลำดับงาน และรองรับกระบวนการส่งออก",
    eyebrow: "INTERNATIONAL", heading: "ขนส่งรถจักรยานยนต์ต่างประเทศ", intro: "รองรับการเตรียมรถและการประสานงานขนส่งต่างประเทศตามปลายทาง จำนวนรถ เอกสาร และเงื่อนไขของแต่ละเที่ยว",
    workflow: [["ตรวจปลายทาง", "รับประเทศปลายทาง จำนวนรถ และผู้รับผิดชอบเอกสาร"], ["ตรวจรายการรถ", "เทียบรายการรถกับขอบเขตที่ได้รับ"], ["เตรียมและจัดเรียง", "วางแผนการจัดเรียงและงาน Container ตามข้อมูลจริง"], ["รวบรวมหลักฐาน", "จัดเก็บข้อมูลและภาพที่ได้รับอนุญาตตามขั้นตอน"]], categories: ["international", "container", "large-batch"],
    faqs: [["ต้องเตรียมเอกสารอะไร", "เอกสารขึ้นอยู่กับประเทศปลายทางและผู้รับผิดชอบการส่งออก ทีมงานจะตรวจรายการที่เกี่ยวข้องก่อนยืนยันงาน"], ["รับงานหลายคันหรือไม่", "รองรับงานหลายคันและงานล็อต โดยต้องตรวจจำนวนรถ พื้นที่ตู้ และกำหนดการจริง"], ["เว็บไซต์รับประกันกำหนดส่งหรือไม่", "ไม่มีการแสดงกำหนดส่งตัวอย่าง ต้องประเมินจากปลายทาง เอกสาร และแผนขนส่งของงานนั้น"]],
  },
  {
    route: "/storage/", title: "รับฝากรถและสต๊อกรถจักรยานยนต์ | NATHEE GROUP 2025", description: "บริการรับฝากรถจักรยานยนต์ สต๊อกรถและสินค้า รองรับการจัดเก็บก่อนขนส่งหรือส่งมอบตามข้อตกลง",
    eyebrow: "STORAGE", heading: "รับฝากรถ สต๊อกรถ และสต๊อกสินค้า", intro: "รองรับการรับรถเข้าพื้นที่ จัดเก็บ และเตรียมรถสำหรับขั้นตอนถัดไป โดยกำหนดรายละเอียดและระยะเวลาตามงานจริง",
    workflow: [["รับรายการ", "ยืนยันจำนวนรถและผู้ประสานงานก่อนนำเข้าพื้นที่"], ["รับเข้า", "บันทึกรายการและหลักฐานตามขอบเขตที่ตกลง"], ["จัดเก็บ", "วางรถในพื้นที่ปฏิบัติงานและติดตามรายการ"], ["เตรียมนำออก", "ตรวจรายการและนัดหมายก่อนส่งต่อหรือส่งมอบ"]], categories: ["storage"],
    faqs: [["รับฝากระยะสั้นหรือระยะยาว", "ระยะเวลาต้องประเมินจากจำนวนรถ พื้นที่ และช่วงวันที่จริงก่อนยืนยัน"], ["รับรถจำนวนมากได้หรือไม่", "ภาพผลงานยืนยันว่ามีการจัดเก็บรถจำนวนมาก แต่จำนวนที่รับได้แต่ละครั้งต้องตรวจพื้นที่ว่างจริง"], ["มีการบันทึกข้อมูลรถหรือไม่", "ระบบงานรองรับการบันทึกรายการ สถานะ และหลักฐานตามสิทธิ์และขอบเขตที่ตกลง"]],
  },
  {
    route: "/container-loading/", title: "รับขึ้นตู้รถจักรยานยนต์และส่งออก | NATHEE GROUP 2025", description: "รับขึ้นตู้ Container และเตรียมส่งออกรถจักรยานยนต์ รองรับงานรายคันและล็อตใหญ่ตามแผนขนส่ง",
    eyebrow: "CONTAINER LOADING", heading: "รับขึ้นตู้ Container และเตรียมส่งออก", intro: "วางลำดับรถและขั้นตอนการโหลดตามจำนวน ขนาดตู้ และข้อกำหนดของงาน เพื่อให้การเตรียมส่งออกเป็นระบบ",
    workflow: [["ตรวจรายการ", "ยืนยันรถที่ต้องขึ้นตู้และข้อมูลตู้ที่เกี่ยวข้อง"], ["เตรียมพื้นที่", "จัดลำดับรถและวัสดุสำหรับปฏิบัติงาน"], ["จัดวางและยึดรถ", "ดำเนินการตามแผนงานและพื้นที่ภายในตู้"], ["เก็บหลักฐาน", "บันทึกภาพและข้อมูลก่อนส่งมอบขั้นตอนถัดไป"]], categories: ["container", "large-batch"],
    faqs: [["ต้องแจ้งข้อมูลตู้ใดบ้าง", "ควรแจ้งประเภทหรือขนาดตู้ จำนวนรถ กำหนดการ และข้อกำหนดจากผู้รับผิดชอบการส่งออก"], ["มีภาพผลงานจริงหรือไม่", "Gallery แสดงภาพการจัดวางและยึดรถจักรยานยนต์ภายในตู้จากการปฏิบัติงานจริง"], ["รับรองจำนวนรถต่อตู้หรือไม่", "จำนวนขึ้นอยู่กับรถ พื้นที่ตู้ และวิธีจัดวาง จึงต้องตรวจจากรายการจริงก่อนเสนอราคา"]],
  },
  {
    route: "/dealer-fleet/", title: "ขนส่งรถมอเตอร์ไซค์ Dealer และ Fleet | NATHEE GROUP 2025", description: "บริการขนส่งรถจักรยานยนต์สำหรับ Dealer, Fleet และงานล็อตใหญ่ รองรับการวางแผนหลายคันและหลายเที่ยว",
    eyebrow: "DEALER / FLEET", heading: "งาน Dealer, Fleet และงานล็อตใหญ่", intro: "รองรับองค์กรที่ต้องขนส่งรถหลายคัน งานประจำ หรือหลายจุดส่ง โดยประเมินแผนรถและรอบงานจากข้อมูลจริง",
    workflow: [["รับบัญชีรถ", "ตรวจจำนวนและข้อมูลรถจากรายการที่ลูกค้าส่ง"], ["วางรอบงาน", "แบ่งเที่ยว จุดรับ และจุดส่งตามกำหนดจริง"], ["จัดเตรียมรถ", "เรียงคิวรถก่อนโหลดและประสานผู้เกี่ยวข้อง"], ["ติดตามการส่งมอบ", "เทียบรายการและหลักฐานตามขอบเขตงาน"]], categories: ["dealer-fleet", "large-batch", "truck-4", "truck-6"],
    faqs: [["รองรับหลายจุดส่งหรือไม่", "รองรับการประเมินงานหลายจุดส่ง โดยต้องตรวจรายการรถ เส้นทาง และช่วงเวลาจริง"], ["ทำงานเป็นล็อตได้อย่างไร", "ทีมงานรับบัญชีรถ วางลำดับและเที่ยวขนส่ง แล้วตรวจรายการตามขั้นตอนที่ตกลง"], ["มีตัวเลขความจุสูงสุดหรือไม่", "เว็บไซต์ไม่แสดงตัวเลขที่ยังไม่ยืนยัน ความจุจะประเมินจากรถขนส่ง ลักษณะรถและเงื่อนไขงาน"]],
  },
];

const home = page({
  route: "/", title: `${company} | ขนส่งรถจักรยานยนต์ทั่วประเทศ`, description: "บริการขนส่งรถจักรยานยนต์ทั่วประเทศและต่างประเทศ รถใหม่ รถมือสอง รับฝาก สต๊อก ขึ้นตู้ Container และงาน Dealer หรือ Fleet", type: "Organization",
  body: `<section class="hero"><div class="hero-grid" aria-hidden="true"></div><div class="shell hero-layout"><div class="hero-copy"><p class="eyebrow"><span></span> MOTORCYCLE LOGISTICS</p><h1>ขนส่งรถจักรยานยนต์<br><em>ครบทั้งในประเทศและต่างประเทศ</em></h1><p class="hero-lead">รองรับรถใหม่ รถมือสอง รถขนส่ง 4 ล้อและ 6 ล้อ งานรายคัน งาน Dealer / Fleet รับฝาก สต๊อก และขึ้นตู้ส่งออก</p><div class="hero-actions"><a class="button" href="/quotation/">ขอใบเสนอราคา</a><a class="button button-secondary" href="tel:0631941191">โทร 063-194-1191</a></div><ul class="trust-list"><li>ทั่วประเทศ</li><li>ต่างประเทศ</li><li>งานล็อตใหญ่</li></ul></div><div class="hero-visual">${responsivePicture(galleryItems.find((item) => item.id === "motorcycle-truck-loading-01"), "hero-work-photo", true)}</div></div></section>
  <section class="ticker"><div class="ticker-track"><span>ขนส่งรถจักรยานยนต์</span><i></i><span>รถใหม่ / รถมือสอง</span><i></i><span>รับฝากและสต๊อก</span><i></i><span>Container Export</span><i></i><span>Dealer / Fleet</span></div></section>
  <section class="section"><div class="shell"><div class="section-heading"><div><p class="eyebrow"><span></span> SERVICES</p><h2>งานขนส่งที่รองรับการใช้งานจริง</h2></div><p>เลือกดูรายละเอียดบริการตามประเภทงาน หรือโทรแจ้งข้อมูลเพื่อให้ทีมงานประเมิน</p></div>${cardGrid(pages.slice(1).map((item) => [item.heading, item.intro, item.route]))}</div></section>
  <section class="section section-dark"><div class="shell"><div class="section-heading"><div><p class="eyebrow"><span></span> REAL WORK PORTFOLIO</p><h2>ภาพผลงานจริงของบริษัท</h2></div><p>รถขนส่ง ลานจัดเก็บ งานล็อต และการขึ้นตู้จากภาพที่ Owner อนุมัติให้เผยแพร่</p></div><div data-gallery-preview class="gallery-preview">${galleryCards(galleryItems.slice(0, 6), false)}</div><a class="text-link" href="/gallery/">ดู Gallery ทั้งหมด <span aria-hidden="true">→</span></a></div></section>
  <section class="section contact-section"><div class="shell contact-panel"><div class="contact-copy"><p class="eyebrow"><span></span> GET A QUOTE</p><h2>แจ้งรายละเอียดเพื่อประเมินงาน</h2><p>เตรียมจุดรับ จุดส่ง จำนวนรถ และวันที่ต้องการ แล้วติดต่อทีมงานโดยตรง</p></div>${contactActions()}</div></section>`,
});

await write("index.html", home);
for (const item of pages) await write(`${item.route.slice(1)}index.html`, servicePage(item));

const aboutFaqs = [["ให้บริการอะไรบ้าง", "บริการที่ยืนยันแล้วครอบคลุมขนส่งรถจักรยานยนต์ทั่วประเทศและต่างประเทศ รับฝาก สต๊อก ขึ้นตู้ Container และงาน Dealer/Fleet"], ["มีการใช้ภาพ Stock หรือไม่", "หน้า Portfolio ใช้ภาพบริษัทที่ Owner ส่งและอนุมัติให้เผยแพร่ ไม่ใช้ภาพ Stock แทนผลงานจริง"], ["จะตรวจความพร้อมก่อนรับงานอย่างไร", "ทีมงานรับรายละเอียดจำนวนรถ เส้นทาง วันที่ และบริการที่ต้องใช้ก่อนประเมินขอบเขตงาน"]];
const aboutProof = galleryItems.filter((item) => ["nathee-yard-front-01", "motorcycle-fleet-staging-01", "nathee-six-wheel-truck-01", "motorcycle-container-loading-01"].includes(item.id));
await write("about/index.html", page({
  route: "/about/", title: `เกี่ยวกับ ${company} | NATHEE GROUP 2025`, description: "รู้จักบริษัท นทีกรุ๊ป2025 จำกัด ผ่านภาพลาน รถขนส่ง งานจัดเก็บ และงานขึ้นตู้ Container ที่บริษัทปฏิบัติจริง", type: "AboutPage", faqs: aboutFaqs,
  body: contentHero("ABOUT NATHEE", `เกี่ยวกับ ${company}`, "ผู้ให้บริการขนส่งรถจักรยานยนต์ รับฝากและจัดเก็บรถ รองรับรถขนส่ง 4 ล้อและ 6 ล้อ งานล็อต และการเตรียมขึ้นตู้ Container") +
    `<section class="section"><div class="shell split-layout"><div><p class="eyebrow"><span></span> VERIFIED CAPABILITY</p><h2>ความพร้อมที่เห็นได้จากงานจริง</h2><p class="section-copy">ภาพที่เผยแพร่ยืนยันพื้นที่ลาน การจัดเรียงรถจำนวนมาก รถขนส่งของบริษัท และการปฏิบัติงานภายในตู้ Container โดยไม่ใช้สถิติที่ยังไม่ได้รับการยืนยัน</p></div><div class="capability-list"><article><strong>Yard</strong><span>พื้นที่รับเข้า จัดเรียง และเตรียมรถ</span></article><article><strong>Fleet</strong><span>รองรับรถขนส่ง 4 ล้อและ 6 ล้อ</span></article><article><strong>Loading</strong><span>การจัดวางรถบนรถขนส่ง</span></article><article><strong>Container</strong><span>เตรียมและจัดเรียงรถภายในตู้</span></article></div></div></section>` +
    `<section class="section section-dark"><div class="shell"><div class="section-heading"><div><p class="eyebrow"><span></span> PROOF, NOT CLAIMS</p><h2>ลาน รถขนส่ง และการโหลด</h2></div><p>ภาพจริงเป็นหลักฐานเชิงพาณิชย์หลักของบริษัท จึงแสดงพร้อมคำอธิบายที่ตรวจสอบได้</p></div>${galleryCards(aboutProof, false)}</div></section>` + faqSection(aboutFaqs),
}));

await write("contact/index.html", page({
  route: "/contact/", title: `ติดต่อ ${company} | NATHEE GROUP 2025`, description: "โทร สแกน LINE หรือเปิด Google Maps เพื่อค้นหาชื่อบริษัท นทีกรุ๊ป2025 จำกัด ก่อนยืนยันจุดรับรถ", type: "ContactPage",
  body: contentHero("CONTACT", "ติดต่อทีมงาน", "แจ้งต้นทาง ปลายทาง จำนวนรถ และวันที่ต้องการ เพื่อให้ทีมงานประเมินบริการ") +
    `<section class="section"><div class="shell contact-panel"><div class="contact-copy"><h2>${company}</h2><p>โทรหาเรา สแกน QR LINE หรือเปิด Google Maps เพื่อค้นหาชื่อบริษัท กรุณายืนยันจุดรับรถกับทีมงานก่อนเดินทางทุกครั้ง</p><a class="button map-button" href="${mapsSearch}" target="_blank" rel="noopener noreferrer">ค้นหาชื่อบริษัทใน Google Maps</a></div>${contactActions()}</div></section>` +
    `<section class="section section-dark"><div class="shell line-contact-card" id="line"><div class="line-contact-copy"><p class="eyebrow"><span></span> LINE CONTACT</p><h2>ส่งรายละเอียดและขอพิกัดจุดรับรถ</h2><p>QR นี้เป็นไฟล์ที่ Owner มอบให้โดยตรง เว็บไซต์ไม่เดาชื่อ LINE ID และไม่ใช้บัญชีตัวอย่าง</p></div><figure class="line-qr-frame"><img src="/assets/contact/line-qr-owner-supplied.png" width="900" height="900" loading="lazy" decoding="async" alt="QR Code LINE ที่ Owner มอบให้สำหรับติดต่อ NATHEE GROUP 2025"><figcaption>สแกนด้วยแอป LINE แล้วส่งต้นทาง ปลายทาง จำนวนรถ และวันที่ต้องการ</figcaption></figure></div></section>` +
    `<section class="section"><div class="shell location-proof"><div>${responsivePicture(galleryItems.find((item) => item.id === "nathee-yard-front-01"), "location-proof-photo", false)}</div><div><p class="eyebrow"><span></span> YARD CONTACT</p><h2>ยืนยันจุดรับรถก่อนเดินทาง</h2><p>ภาพด้านข้างเป็นพื้นที่ลานจริง แต่ repository ยังไม่มีเลขที่อยู่หรือพิกัดที่ Owner ยืนยัน จึงไม่แสดงหมุดหรือที่อยู่จากการคาดเดา</p><div class="hero-actions"><a class="button" href="tel:0631941191">โทรขอพิกัด 063-194-1191</a><a class="button button-secondary" href="#line">ส่งข้อความทาง LINE</a></div></div></div></section>`,
}));

const quoteFaqs = [["ส่งข้อมูลแล้วได้ราคาทันทีหรือไม่", "ไม่ เว็บไซต์ไม่สร้างราคาตัวอย่าง ทีมงานต้องตรวจข้อมูลจริงก่อนเสนอราคา"], ["หากยังไม่ทราบวันที่แน่นอนทำอย่างไร", "แจ้งช่วงเวลาที่คาดไว้ได้ ทีมงานจะสอบถามข้อมูลเพิ่มเติมก่อนยืนยันคิว"], ["ต้องชำระเงินผ่านหน้าเว็บไซต์หรือไม่", "หน้า Public Website ยังไม่มีการรับชำระเงิน และจะไม่ขอข้อมูลบัตรหรือบัญชีธนาคาร"]];
await write("quotation/index.html", page({
  route: "/quotation/", title: "ขอใบเสนอราคาขนส่งรถจักรยานยนต์ | NATHEE GROUP 2025", description: "เตรียมต้นทาง ปลายทาง จำนวนรถ ประเภทรถ และวันที่ต้องการ เพื่อให้ทีมงาน NATHEE GROUP 2025 ประเมินจากงานจริง", type: "WebPage", faqs: quoteFaqs,
  body: contentHero("GET A QUOTE", "ขอใบเสนอราคา", "เตรียมข้อมูลให้ครบแล้วติดต่อทีมงาน ระบบจะประเมินจากงานจริงและไม่แสดงราคาเดาหรือสถานะสำเร็จปลอม") +
    `<section class="section"><div class="shell split-layout"><div><h2>ข้อมูลที่ช่วยให้ประเมินได้เร็ว</h2><ol class="quote-checklist"><li>จุดรับและจุดส่ง</li><li>จำนวนและประเภทรถจักรยานยนต์</li><li>วันที่ต้องการรับหรือส่ง</li><li>ชื่อและเบอร์ผู้ประสานงาน</li><li>บริการรับฝาก สต๊อก ขึ้นตู้ หรือส่งออก (ถ้ามี)</li></ol><p class="section-copy">แบบฟอร์มออนไลน์จะเปิดเฉพาะเมื่อ Backend และฐานข้อมูล Production ผ่านการตรวจจริง ระหว่างนี้ใช้โทรศัพท์หรือ LINE ซึ่งเป็นช่องทางที่ยืนยันแล้ว</p></div>${contactActions()}</div></section>` + faqSection(quoteFaqs),
}));

await write("gallery/index.html", page({
  route: "/gallery/", title: "Gallery ผลงานขนส่งรถจักรยานยนต์ | NATHEE GROUP 2025", description: "ชมภาพผลงานจริงด้านขนส่งรถจักรยานยนต์ ลานสต๊อก งาน Container ส่งออก Dealer และ Fleet ของ NATHEE GROUP 2025", type: "CollectionPage",
  body: contentHero("REAL WORK PORTFOLIO", "ผลงานและ Gallery", "ภาพลาน รถขนส่ง งานล็อตและ Container ที่ Owner อนุมัติให้เผยแพร่ พร้อมหมวด คำบรรยาย และ Alt text") +
    `<section class="section gallery-section"><div class="shell"><div class="gallery-filters" data-gallery-filters aria-label="กรองหมวดผลงาน"><button class="is-active" type="button" data-category="all" aria-pressed="true">ทั้งหมด</button></div><div class="gallery-grid" data-gallery-grid data-gallery-initial aria-live="polite">${galleryCards(galleryItems, true)}</div><button class="button gallery-load-more" type="button" data-gallery-more hidden>ดูภาพเพิ่มเติม</button></div></section><div class="gallery-lightbox" data-lightbox hidden role="dialog" aria-modal="true" aria-label="ภาพผลงาน"><button type="button" class="lightbox-close" data-lightbox-close aria-label="ปิด">×</button><button type="button" class="lightbox-prev" data-lightbox-prev aria-label="ภาพก่อนหน้า">‹</button><figure><picture data-lightbox-picture></picture><figcaption><strong data-lightbox-title></strong><span data-lightbox-caption></span></figcaption></figure><button type="button" class="lightbox-next" data-lightbox-next aria-label="ภาพถัดไป">›</button></div>`,
}));

await write("site.webmanifest", `${JSON.stringify({
  id: "/",
  name: `${appName} | ${company}`,
  short_name: appShortName,
  description: appDescription,
  lang: "th",
  dir: "ltr",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "any",
  theme_color: "#0a1020",
  background_color: "#0a1020",
  icons: [
    { src: "/assets/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/assets/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/assets/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
  shortcuts: [
    { name: "ขอใบเสนอราคา", short_name: "ใบเสนอราคา", url: "/quotation/", icons: [{ src: "/assets/brand/icon-192.png", sizes: "192x192", type: "image/png" }] },
    { name: "ผลงานและ Gallery", short_name: "ผลงาน", url: "/gallery/", icons: [{ src: "/assets/brand/icon-192.png", sizes: "192x192", type: "image/png" }] },
    { name: "ติดต่อทีมงาน", short_name: "ติดต่อ", url: "/contact/", icons: [{ src: "/assets/brand/icon-192.png", sizes: "192x192", type: "image/png" }] },
  ],
}, null, 2)}
`);

await write("login/index.html", noindexPage("เข้าสู่ระบบ | NATHEE GROUP 2025", "ระบบเข้าสู่ระบบ Production อยู่ระหว่างการเชื่อมต่อ", "เพื่อความปลอดภัย ไม่มีบัญชีหรือรหัสผ่าน Demo บนเว็บไซต์จริง"));

async function write(path, content) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content.replaceAll("\r\n", "\n"), "utf8");
}

function servicePage(item) {
  const selected = item.categories.length ? galleryItems.filter((image) => item.categories.includes(image.category)).slice(0, 6) : galleryItems.slice(0, 6);
  const proof = selected.length ? selected : galleryItems.slice(0, 3);
  return page({ route: item.route, title: item.title, description: item.description, type: "Service", faqs: item.faqs, body: contentHero(item.eyebrow, item.heading, item.intro) +
    (item.cards ? `<section class="section" aria-labelledby="service-overview-heading"><div class="shell"><h2 class="sr-only" id="service-overview-heading">บริการทั้งหมด</h2>${cardGrid(item.cards)}</div></section>` : "") + workflowSection(item.workflow) +
    `<section class="section section-dark"><div class="shell"><div class="section-heading"><div><p class="eyebrow"><span></span> REAL WORK</p><h2>หลักฐานจากการปฏิบัติงานจริง</h2></div><p>เลือกภาพที่เกี่ยวข้องกับบริการนี้จาก Portfolio ที่ Owner อนุมัติแล้ว</p></div><div class="gallery-preview">${galleryCards(proof, false)}</div><a class="text-link" href="/gallery/">ดูผลงานทั้งหมด <span aria-hidden="true">→</span></a></div></section>` + faqSection(item.faqs) +
    `<section class="section contact-section"><div class="shell contact-panel"><div class="contact-copy"><p class="eyebrow"><span></span> GET A QUOTE</p><h2>ขอให้ทีมงานประเมินจากรายละเอียดจริง</h2><p>แจ้งต้นทาง ปลายทาง จำนวนรถ วันที่ และบริการเพิ่มเติมที่ต้องการ</p><a class="button" href="/quotation/">เตรียมข้อมูลขอใบเสนอราคา</a></div>${contactActions()}</div></section>` });
}

function workflowSection(steps) {
  return `<section class="section"><div class="shell"><div class="section-heading"><div><p class="eyebrow"><span></span> WORKFLOW</p><h2>ขั้นตอนที่ลูกค้าเข้าใจได้ก่อนเริ่มงาน</h2></div><p>รายละเอียดแต่ละงานยืนยันอีกครั้งตามเส้นทาง จำนวนรถ และขอบเขตบริการ</p></div><ol class="process-grid">${steps.map(([title, body], index) => `<li><span>${String(index + 1).padStart(2, "0")}</span><h3>${title}</h3><p>${body}</p></li>`).join("")}</ol></div></section>`;
}

function faqSection(faqs) {
  return `<section class="section"><div class="shell faq-section"><div class="section-heading compact"><div><p class="eyebrow"><span></span> FAQ</p><h2>คำถามที่พบบ่อย</h2></div><p>คำตอบใช้เฉพาะข้อมูลบริการที่ยืนยันแล้ว และไม่รับรองราคา เวลา หรือความจุโดยไม่มีการประเมินจริง</p></div><div class="faq-list">${faqs.map(([question, answer]) => `<details><summary>${question}</summary><p>${answer}</p></details>`).join("")}</div></div></section>`;
}

function galleryCards(items, interactive) {
  return items.map((item) => {
    const control = interactive
      ? `<a href="${item.display}" aria-label="เปิดภาพขนาดใหญ่: ${item.alt}">${responsivePicture(item)}</a>`
      : `<a href="/gallery/#${item.id}" aria-label="ดูผลงาน: ${item.title}">${responsivePicture(item)}</a>`;
    return `<figure class="gallery-card" id="${item.id}" data-orientation="${orientation(item)}">${control}<figcaption><span>${categoryLabels.get(item.category) ?? "ผลงานจริง"}</span><strong>${item.title}</strong><p>${item.caption}</p></figcaption></figure>`;
  }).join("");
}

function responsivePicture(item, className = "", eager = false) {
  if (!item) return "";
  const small = Math.min(item.width, 640), large = Math.min(item.width, 1600);
  const sizes = className === "hero-work-photo" ? "(max-width: 980px) calc(100vw - 40px), 520px" : "(max-width: 680px) calc(100vw - 28px), (max-width: 980px) calc(50vw - 32px), 374px";
  return `<picture${className ? ` class="${className}"` : ""}><source type="image/avif" srcset="${item.thumbnailAvif} ${small}w, ${item.displayAvif} ${large}w" sizes="${sizes}"><source type="image/webp" srcset="${item.thumbnailWebp} ${small}w, ${item.displayWebp} ${large}w" sizes="${sizes}"><img src="${eager ? item.display : item.thumbnail}" srcset="${item.thumbnail} ${small}w, ${item.display} ${large}w" sizes="${sizes}" alt="${item.alt}" width="${item.width}" height="${item.height}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></picture>`;
}

function orientation(item) { const ratio = item.width / item.height; return ratio > 1.12 ? "landscape" : ratio < 0.88 ? "portrait" : "square"; }
function contentHero(eyebrow, heading, intro) { return `<section class="page-hero"><div class="shell"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">หน้าแรก</a><span aria-hidden="true">/</span><span>${heading}</span></nav><p class="eyebrow"><span></span> ${eyebrow}</p><h1>${heading}</h1><p>${intro}</p></div></section>`; }
function cardGrid(cards) { return `<div class="service-grid">${cards.map(([title, description, href], index) => `<article class="service-card${index === 0 ? " featured" : ""}"><span class="service-number">${String(index + 1).padStart(2, "0")}</span><h3>${title}</h3><p>${description}</p>${href ? `<a class="text-link" href="${href}">อ่านรายละเอียด <span aria-hidden="true">→</span></a>` : ""}</article>`).join("")}</div>`; }
function contactActions() { return `<div class="contact-actions"><a class="contact-button" href="tel:0631941191"><span>โทรศัพท์หลัก</span><strong>063-194-1191</strong></a><a class="contact-button" href="tel:0856802082"><span>โทรศัพท์สำรอง</span><strong>085-680-2082</strong></a><a class="contact-button" href="/contact/#line"><span>LINE</span><strong>สแกน QR ติดต่อทีมงาน</strong></a></div>`; }

function page({ route, title, description, type, body, faqs = [] }) {
  const url = `${domain}${route}`;
  const mainEntity = type === "Organization"
    ? { "@context": "https://schema.org", "@type": ["Organization", "LocalBusiness"], name: company, url: `${domain}/`, image: `${domain}/assets/brand/nathee-logo-display.jpg`, telephone: ["+66-63-194-1191", "+66-85-680-2082"], areaServed: "TH", knowsAbout: ["ขนส่งรถจักรยานยนต์", "รับฝากรถจักรยานยนต์", "ขึ้นตู้รถจักรยานยนต์", "ส่งออกรถจักรยานยนต์"] }
    : { "@context": "https://schema.org", "@type": type, name: title.split(" | ")[0], description, url, provider: { "@type": "Organization", name: company, url: `${domain}/` }, breadcrumb: { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "หน้าแรก", item: `${domain}/` }, { "@type": "ListItem", position: 2, name: title.split(" | ")[0], item: url }] } };
  const structured = faqs.length ? [mainEntity, { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(([name, text]) => ({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } })) }] : mainEntity;
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1"><meta name="theme-color" content="#0a1020"><meta name="referrer" content="strict-origin-when-cross-origin"><link rel="canonical" href="${url}"><link rel="alternate" hreflang="th-TH" href="${url}"><link rel="alternate" hreflang="x-default" href="${url}"><meta property="og:type" content="website"><meta property="og:locale" content="th_TH"><meta property="og:site_name" content="NATHEE GROUP 2025"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${url}"><meta property="og:image" content="${domain}/assets/brand/nathee-logo-display.jpg"><meta property="og:image:width" content="1000"><meta property="og:image:height" content="1000"><meta property="og:image:alt" content="โลโก้ NATHEE GROUP 2025 พร้อมภาพรถจักรยานยนต์และรถบรรทุก"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${domain}/assets/brand/nathee-logo-display.jpg"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><link rel="icon" href="/favicon.svg" type="image/svg+xml">${installLinks()}<link rel="stylesheet" href="/assets/site.css"><script type="application/ld+json">${JSON.stringify(structured).replaceAll("<", "\\u003c")}</script></head><body><a class="skip-link" href="#main">ข้ามไปยังเนื้อหาหลัก</a>${header()}<main id="main">${body}</main>${footer()}<script src="/assets/site.js" defer></script></body></html>`;
}

// Installability metadata. The site is installable and correctly branded;
// it deliberately ships no Service Worker, because a cache-first worker on
// a static marketing site can keep serving a superseded release after a
// deployment. Offline support is a separate, reviewed decision.
function installLinks() { return `<link rel="manifest" href="/site.webmanifest"><link rel="apple-touch-icon" sizes="180x180" href="/assets/brand/apple-touch-icon-180.png"><meta name="apple-mobile-web-app-title" content="${appShortName}"><meta name="application-name" content="${appShortName}"><meta name="mobile-web-app-capable" content="yes">`; }

function header() { return `<header class="site-header" data-header><div class="shell header-inner"><a class="brand" href="/" aria-label="NATHEE GROUP 2025 หน้าแรก"><span class="brand-mark" aria-hidden="true">N</span><span><strong>NATHEE GROUP 2025</strong><small>Motorcycle Logistics</small></span></a><button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-menu-toggle><span class="sr-only">เปิดเมนู</span><span></span><span></span><span></span></button><nav class="site-nav" id="site-nav" aria-label="เมนูหลัก" data-menu><a href="/services/">บริการ</a><a href="/gallery/">ผลงาน</a><a href="/about/">เกี่ยวกับเรา</a><a href="/contact/">ติดต่อ</a><a href="/login/">เข้าสู่ระบบ</a><a class="button button-small" href="/quotation/">ขอใบเสนอราคา</a></nav></div></header>`; }
function footer() { return `<footer class="site-footer"><div class="shell footer-layout"><div><a class="brand footer-brand" href="/"><span class="brand-mark" aria-hidden="true">N</span><span><strong>NATHEE GROUP 2025</strong><small>Motorcycle Logistics</small></span></a><p>${company}</p></div><div class="footer-links"><a href="/services/">บริการ</a><a href="/gallery/">ผลงาน</a><a href="/about/">เกี่ยวกับเรา</a><a href="/contact/">ติดต่อ</a></div><div class="footer-contact"><a href="tel:0631941191">063-194-1191</a><a href="tel:0856802082">085-680-2082</a><a href="/contact/#line">LINE: สแกน QR</a></div></div><div class="shell footer-bottom"><span>© 2026 ${company}</span><a href="/login/">ระบบลูกค้า</a></div></footer>`; }
function noindexPage(title, heading, message) { return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#0a1020"><link rel="icon" href="/favicon.svg" type="image/svg+xml">${installLinks()}<link rel="stylesheet" href="/assets/site.css"></head><body><a class="skip-link" href="#main">ข้ามไปยังเนื้อหาหลัก</a>${header()}<main id="main">${contentHero("CUSTOMER SYSTEM", heading, message)}<section class="section"><div class="shell"><div class="empty-state"><strong>ยังไม่เปิดรับการเข้าสู่ระบบ</strong><span>กรุณาติดต่อทีมงานที่ 063-194-1191 หรือ 085-680-2082</span></div></div></section></main>${footer()}<script src="/assets/site.js" defer></script></body></html>`; }

console.log(`PUBLIC_SITE_BUILD_PASS pages=${pages.length + 6} realPhotos=${galleryItems.length} webmanifest=1 serviceWorker=0`);
