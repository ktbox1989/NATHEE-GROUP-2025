import type { Metadata } from "next";
import Link from "next/link";
import { CmsPublicPage } from "@/components/cms-public-page";
import { getPublishedSitePage } from "@/lib/site-cms";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const state = await getPublishedSitePage("home");
  const title = state.status === "PUBLISHED" ? state.content.seo.title : "NATHEE GROUP 2025 | Motorcycle Logistics";
  const description = state.status === "PUBLISHED" ? state.content.seo.description : "บริการขนส่งรถจักรยานยนต์ รับฝากรถ ลานสต๊อก โหลดรถ และเตรียมงานส่งออก พร้อมระบบติดตามสถานะ";
  return {
    title,
    description,
    alternates: { canonical: "https://natheegroup2025.com/" },
    openGraph: { title, description, url: "https://natheegroup2025.com/", siteName: "NATHEE GROUP 2025", type: "website", locale: "th_TH" },
  };
}

const services = [
  ["🏍️", "ขนส่งในประเทศ", "รองรับรถใหม่ รถมือสอง งานรายคัน และงานล็อต พร้อมติดตามการทำงานเป็นขั้นตอน"],
  ["🚢", "ขนส่งต่างประเทศ", "เตรียมรถ จัดเรียง โหลดตู้ และเก็บหลักฐานสำหรับงานส่งออกต่างประเทศ"],
  ["🏭", "ลานสต๊อกและรับฝากรถ", "รับรถเข้าลาน ตรวจสภาพ และจัดเก็บตามพื้นที่เพื่อค้นหาและนำรถออกได้สะดวก"],
  ["📦", "โหลดรถและ Container", "จัดคิวการโหลด บันทึกภาพ และเตรียมข้อมูลตู้กับ Seal สำหรับตรวจสอบย้อนหลัง"],
  ["🔍", "ตรวจสภาพก่อนรับ–ส่ง", "บันทึกภาพรอบคันและตำหนิ เพื่อให้มีหลักฐานชัดเจนก่อนรับรถและก่อนส่งมอบ"],
  ["🧾", "เอกสารและหลักฐาน", "เตรียมรองรับใบรับรถ ใบตรวจสภาพ เอกสารขนส่ง และหลักฐานการส่งมอบ"],
];

const workflow = [
  ["01", "รับรถ", "ลงทะเบียนรถและผูกกับงานขนส่ง"],
  ["02", "ตรวจสภาพ", "บันทึกรูปและรายละเอียดก่อนเคลื่อนย้าย"],
  ["03", "จัดเก็บ", "ระบุตำแหน่งรถในลานและสถานะล่าสุด"],
  ["04", "ขนส่ง", "ติดตามรถตั้งแต่โหลดจนถึงปลายทาง"],
  ["05", "ส่งมอบ", "เก็บหลักฐานและปิดงานอย่างตรวจสอบได้"],
];

export default async function Home() {
  const page = await getPublishedSitePage("home");
  if (page.status === "PUBLISHED") return <CmsPublicPage content={page.content} slug="home" />;
  return <LegacyHome />;
}

function LegacyHome() {
  return (
    <main>
      <div className="topbar">
        <div className="shell topbar-inner">
          <span>ขนส่ง • รับฝาก • สต๊อก • โหลด • ส่งออก</span>
          <Link href="/login">เข้าสู่ระบบลูกค้า</Link>
        </div>
      </div>

      <nav className="nav" aria-label="เมนูหลัก">
        <div className="shell nav-inner">
          <Link className="brand" href="#top" aria-label="NATHEE GROUP หน้าแรก">
            <span className="brand-mark">NG</span>
            <span className="brand-name">
              NATHEE GROUP
              <small>MOTORCYCLE LOGISTICS · 2025</small>
            </span>
          </Link>
          <div className="nav-links">
            <a href="#services">บริการ</a>
            <a href="#workflow">ขั้นตอนการทำงาน</a>
            <a href="#about">เกี่ยวกับเรา</a>
          </div>
          <Link className="button button-small button-gradient" href="/login">
            เข้าสู่ระบบ
          </Link>
        </div>
      </nav>

      <header className="hero" id="top">
        <div className="aurora" aria-hidden="true">
          <i className="aurora-one" />
          <i className="aurora-two" />
          <i className="aurora-three" />
        </div>
        <div className="grid-lines" aria-hidden="true" />
        <div className="shell hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">ขนส่งรถจักรยานยนต์ · ทั่วประเทศและต่างประเทศ</span>
            <h1>ขนส่งรถจักรยานยนต์<br />ครบวงจร ตรวจสอบได้ทุกคัน</h1>
            <p>
              รองรับงานรายคันถึงงานล็อต บริการรับฝากรถ ลานสต๊อก การโหลดรถและ
              Container พร้อมระบบติดตามสถานะที่ออกแบบสำหรับงานจริง
            </p>
            <div className="hero-actions">
              <a className="button button-gradient" href="#services">ดูบริการของเรา</a>
              <Link className="button button-glass" href="/login">เข้าสู่ระบบลูกค้า</Link>
            </div>
            <div className="trust-row" aria-label="ความสามารถหลัก">
              <span>เว็บคอม + มือถือ</span><span>สถานะรายคัน</span><span>รูปและ Timeline</span>
            </div>
          </div>

          <aside className="tracking-card" aria-label="ขั้นตอนการติดตามรถ">
            <div className="tracking-head">
              <span>ติดตามสถานะรายคัน</span><span className="tracking-label">WORKFLOW</span>
            </div>
            <div className="tracking-body">
              <p className="tracking-kicker">MOTORCYCLE RECORD</p>
              <h2>ข้อมูลเดียว ตั้งแต่รับรถจนส่งมอบ</h2>
              <ol>
                {workflow.map(([number, title]) => (
                  <li key={number}><span>{number}</span><b>{title}</b><i aria-hidden="true" /></li>
                ))}
              </ol>
            </div>
            <div className="tracking-foot"><span>ROLE-BASED ACCESS</span><span>SERVER VERIFIED</span></div>
          </aside>
        </div>
      </header>

      <section id="services">
        <div className="shell">
          <div className="section-heading">
            <span className="eyebrow">บริการของเรา</span>
            <h2>ครอบคลุมทุกขั้นตอนการขนส่ง</h2>
            <p>ตั้งแต่รับรถเข้าลาน ตรวจสภาพ จัดเก็บ ไปจนถึงส่งมอบปลายทาง พร้อมข้อมูลที่ตรวจสอบย้อนหลังได้</p>
          </div>
          <div className="service-grid">
            {services.map(([icon, title, description]) => (
              <article className="service-card" key={title}>
                <span className="service-icon" aria-hidden="true">{icon}</span>
                <h3>{title}</h3><p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="workflow-section" id="workflow">
        <div className="shell">
          <div className="section-heading compact">
            <span className="eyebrow">การทำงานที่ตรวจสอบได้</span>
            <h2>ข้อมูลไหลต่อเนื่อง ไม่ต้องกรอกซ้ำหลายระบบ</h2>
          </div>
          <div className="workflow-grid">
            {workflow.map(([number, title, description]) => (
              <article className="workflow-card" key={number}>
                <span>{number}</span><h3>{title}</h3><p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="about">
        <div className="shell about-grid">
          <div><span className="eyebrow">เกี่ยวกับเรา</span><h2>บริษัท นทีกรุ๊ป2025 จำกัด</h2></div>
          <div className="about-copy">
            <p>ให้บริการงานขนส่งรถจักรยานยนต์ รับฝากและจัดเก็บรถ พร้อมพื้นที่สำหรับรถบรรทุกเข้าโหลดงาน และรองรับการเตรียมรถสำหรับงานส่งออก</p>
            <div className="about-points">
              <span>ตรวจสภาพและบันทึกรูป</span><span>ติดตามสถานะตามสิทธิ์</span>
              <span>รองรับงานลานและการโหลด</span><span>ออกแบบสำหรับคอมและมือถือ</span>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="shell footer-inner">
          <span>© 2026 บริษัท นทีกรุ๊ป2025 จำกัด</span>
          <span>NATHEE GROUP · MOTORCYCLE LOGISTICS</span>
        </div>
      </footer>
    </main>
  );
}
