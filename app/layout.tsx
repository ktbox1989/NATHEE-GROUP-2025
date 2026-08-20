import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NATHEE GROUP 2025 | Motorcycle Logistics",
  description: "บริการขนส่งรถจักรยานยนต์ รับฝากรถ ลานสต๊อก โหลดรถ และเตรียมงานส่งออก พร้อมระบบติดตามสถานะ",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th"><body>{children}</body></html>;
}
