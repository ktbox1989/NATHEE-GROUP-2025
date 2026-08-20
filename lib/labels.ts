import type { MotorcycleStatus, UserRole } from "@/db/schema";

export const roleLabels: Record<UserRole, string> = {
  OWNER: "เจ้าของระบบ",
  ADMIN: "ผู้ดูแลระบบ",
  STAFF: "พนักงาน",
  SALE: "ฝ่ายขาย",
  WAREHOUSE: "คลัง / ลาน",
  CHECKER: "เจ้าหน้าที่ตรวจรถ",
  DRIVER: "พนักงานขับรถ",
  ACCOUNTING: "บัญชี",
  CUSTOMER_ADMIN: "ผู้ดูแลบริษัทลูกค้า",
  CUSTOMER_VIEWER: "ผู้ชมข้อมูลลูกค้า",
};

export const motorcycleStatusLabels: Record<MotorcycleStatus, string> = {
  PENDING_RECEIPT: "รอรับรถ",
  RECEIVED: "รับรถแล้ว",
  INSPECTED: "ตรวจสภาพแล้ว",
  IN_YARD: "อยู่ในลาน",
  SCHEDULED: "จัดเที่ยวแล้ว",
  LOADED: "ขึ้นรถแล้ว",
  IN_TRANSIT: "กำลังขนส่ง",
  ARRIVED: "ถึงปลายทาง",
  DELIVERED: "ส่งมอบแล้ว",
  CLOSED: "ปิดงาน",
  ISSUE: "พบปัญหา",
  DAMAGED: "พบความเสียหาย",
  WAITING_DOCUMENTS: "รอเอกสาร",
  CANCELLED: "ยกเลิก",
};
