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
    /**
     * The company email. May be empty, and is empty in the shipped defaults.
     *
     * There is no Owner-confirmed email address anywhere in this repository and
     * the static contact page says so in its own copy. An empty field renders
     * as nothing; it must never render as a placeholder, because a plausible
     * wrong address on a logistics site is a lost enquiry.
     */
    email: string;
    /**
     * The postal address, one line per line.
     *
     * Not one string: a Thai address is written over several lines and joining
     * it with commas reads wrong. At most four, each bounded.
     */
    addressLines: string[];
    /** The LINE id shown beside the QR, so the channel is usable on desktop. */
    lineId: string;
    /**
     * A Gallery item holding the Owner-supplied LINE QR.
     *
     * Resolved exactly as `brand.logoItemId` is - a published, public gallery
     * item - so there is no second media mechanism, and `collectSettingsReferences`
     * verifies it at publish time. Empty means the site shows no QR.
     */
    lineQrItemId: string;
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
// Deliberately conservative rather than RFC-complete. This address is rendered
// as a `mailto:` on public pages, so the useful questions are "could this be a
// header injection" and "could this be a dead link", not "is every legal
// address accepted".
const emailPattern = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+$/;
// LINE personal ids are latin, 4-20 characters; official accounts are the same
// with a leading `@`. Anything else is not an id anyone can search for.
const lineIdPattern = /^@?[A-Za-z0-9._-]{3,32}$/;
/** At most four lines, so the block cannot grow without bound. */
export const MAX_ADDRESS_LINES = 4;
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
    // Empty on purpose, all four. The repository holds no Owner-confirmed
    // email, address or LINE id, and `public-site/contact/index.html` says so
    // in the page text rather than showing a sample. A default here would put
    // an invented contact detail on every public page.
    email: "",
    addressLines: [],
    lineId: "",
    lineQrItemId: "",
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
  const email = bounded(input.contact.email, 160);
  const lineId = bounded(input.contact.lineId, 60);
  const lineQrItemId = bounded(input.contact.lineQrItemId, 100);
  const addressLines = parseAddressLines(input.contact.addressLines);
  const loginLabel = bounded(input.navigation.loginLabel, 40);
  const copyright = bounded(input.footer.copyright, 180);
  const secondaryText = bounded(input.footer.secondaryText, 180);
  if (!name || !legalName || !abbreviationPattern.test(abbreviation) || !tagline || logoItemId && !mediaIdPattern.test(logoItemId)) return null;
  if (!phonePattern.test(primaryPhone) || secondaryPhone && !phonePattern.test(secondaryPhone)) return null;
  // Each optional channel is either absent or well formed. Half a typed email
  // address on every public page is worse than no email address.
  if (email && !emailPattern.test(email)) return null;
  if (lineId && !lineIdPattern.test(lineId)) return null;
  if (lineQrItemId && !mediaIdPattern.test(lineQrItemId)) return null;
  if (addressLines === null) return null;
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
    contact: { primaryPhone, secondaryPhone, email, addressLines, lineId, lineQrItemId },
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

/**
 * The address lines, or null when the payload is malformed.
 *
 * Absent is an empty address, because every settings revision written before
 * this field existed has to keep parsing - revisions are immutable, so the
 * parser is the only thing that can stay compatible with them. A blank line is
 * dropped rather than kept, so an Owner who fills lines one and three does not
 * publish a gap in the middle of their address; a non-string is a malformed
 * payload and is refused rather than coerced.
 */
function parseAddressLines(input: unknown): string[] | null {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > MAX_ADDRESS_LINES) return null;
  const lines: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") return null;
    const line = bounded(raw, 120);
    if (line) lines.push(line);
  }
  return lines;
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
