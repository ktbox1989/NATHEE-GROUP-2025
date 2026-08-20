export type SiteNavigationItem = { label: string; href: string };
export type SiteSettings = {
  version: 1;
  brand: {
    name: string;
    legalName: string;
    abbreviation: string;
    tagline: string;
    logoItemId: string;
  };
  contact: {
    primaryPhone: string;
    secondaryPhone: string;
  };
  navigation: {
    items: SiteNavigationItem[];
    loginLabel: string;
  };
  footer: {
    copyright: string;
    secondaryText: string;
  };
};

const mediaIdPattern = /^[A-Za-z0-9_-]{1,100}$/;
const abbreviationPattern = /^[A-Za-z0-9]{1,6}$/;
const phonePattern = /^\+?[0-9-]{7,20}$/;
const publicPathPattern = /^\/(?:[a-z0-9-]+\/?)*$/;
const blockedPublicPrefixes = ["/api", "/app", "/auth"];

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  version: 1,
  brand: {
    name: "NATHEE GROUP 2025",
    legalName: "บริษัท นทีกรุ๊ป2025 จำกัด",
    abbreviation: "NG",
    tagline: "MOTORCYCLE LOGISTICS · 2025",
    logoItemId: "",
  },
  contact: {
    primaryPhone: "063-194-1191",
    secondaryPhone: "085-680-2082",
  },
  navigation: {
    items: [
      { label: "หน้าแรก", href: "/" },
      { label: "บริการ", href: "/services" },
      { label: "ผลงาน", href: "/gallery" },
      { label: "เกี่ยวกับเรา", href: "/about" },
      { label: "ติดต่อ", href: "/contact" },
    ],
    loginLabel: "เข้าสู่ระบบ",
  },
  footer: {
    copyright: "© 2026 บริษัท นทีกรุ๊ป2025 จำกัด",
    secondaryText: "NATHEE GROUP · MOTORCYCLE LOGISTICS",
  },
};

export function parseSiteSettings(input: unknown): SiteSettings | null {
  if (!isObject(input) || input.version !== 1 || !isObject(input.brand) || !isObject(input.contact) || !isObject(input.navigation) || !isObject(input.footer)) return null;
  const name = bounded(input.brand.name, 120);
  const legalName = bounded(input.brand.legalName, 180);
  const abbreviation = bounded(input.brand.abbreviation, 6);
  const tagline = bounded(input.brand.tagline, 120);
  const logoItemId = bounded(input.brand.logoItemId, 100);
  const primaryPhone = bounded(input.contact.primaryPhone, 20);
  const secondaryPhone = bounded(input.contact.secondaryPhone, 20);
  const loginLabel = bounded(input.navigation.loginLabel, 40);
  const copyright = bounded(input.footer.copyright, 180);
  const secondaryText = bounded(input.footer.secondaryText, 180);
  if (!name || !legalName || !abbreviationPattern.test(abbreviation) || !tagline || logoItemId && !mediaIdPattern.test(logoItemId)) return null;
  if (!phonePattern.test(primaryPhone) || secondaryPhone && !phonePattern.test(secondaryPhone)) return null;
  if (!loginLabel || !copyright || !secondaryText || !Array.isArray(input.navigation.items) || input.navigation.items.length < 1 || input.navigation.items.length > 8) return null;

  const items: SiteNavigationItem[] = [];
  const hrefs = new Set<string>();
  for (const raw of input.navigation.items) {
    if (!isObject(raw)) return null;
    const label = bounded(raw.label, 40);
    const href = bounded(raw.href, 120);
    if (!label || !isSafePublicPath(href) || hrefs.has(href)) return null;
    hrefs.add(href);
    items.push({ label, href });
  }
  if (!hrefs.has("/")) return null;

  return {
    version: 1,
    brand: { name, legalName, abbreviation, tagline, logoItemId },
    contact: { primaryPhone, secondaryPhone },
    navigation: { items, loginLabel },
    footer: { copyright, secondaryText },
  };
}

export function parseSiteSettingsJson(value: string): SiteSettings | null {
  if (value.length < 2 || value.length > 20_000) return null;
  try { return parseSiteSettings(JSON.parse(value)); }
  catch { return null; }
}

export function serializeSiteSettings(settings: SiteSettings): string {
  return JSON.stringify(settings);
}

function isSafePublicPath(value: string): boolean {
  if (!publicPathPattern.test(value) || value.includes("//")) return false;
  return !blockedPublicPrefixes.some((prefix) => value === prefix || value.startsWith(`${prefix}/`));
}

function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
