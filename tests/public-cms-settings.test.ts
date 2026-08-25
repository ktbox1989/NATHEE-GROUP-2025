import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "../lib/site-settings-content.ts";
import {
  buildSiteChrome,
  isPublicNavigationHref,
  normalisePublicHref,
} from "../lib/public-cms/settings.ts";

function settings(overrides: Partial<SiteSettings> = {}): SiteSettings {
  return { ...DEFAULT_SITE_SETTINGS, ...overrides } as SiteSettings;
}

function withNavigation(items: Array<{ label: string; href: string }>): SiteSettings {
  return settings({ navigation: { ...DEFAULT_SITE_SETTINGS.navigation, items } });
}

function withContact(primaryPhone: string, secondaryPhone = ""): SiteSettings {
  return settings({ contact: { ...DEFAULT_SITE_SETTINGS.contact, primaryPhone, secondaryPhone } });
}

// --- what may appear in the header -----------------------------------------

test("the shipped defaults build usable chrome", () => {
  const chrome = buildSiteChrome(DEFAULT_SITE_SETTINGS);
  assert.equal(chrome.fallbackReason, null);
  assert.equal(chrome.brand.name, "NATHEE GROUP 2025");
  assert.ok(chrome.navigation.length >= 4);
  assert.deepEqual(chrome.telephones.map((entry) => entry.display), ["063-194-1191", "085-680-2082"]);
});

test("a navigation item may never point into the authenticated application", () => {
  // A customer sent from the marketing header to a login screen reads the site
  // as broken; a header link off-site is how one compromised settings row
  // becomes a phishing redirect on every page at once.
  for (const href of [
    "/app/",
    "/app/jobs",
    "/api/quotation",
    "/auth/callback",
    "https://example.com/",
    "//example.com",
    "/services/../app/",
    "\\\\evil",
    "javascript:alert(1)",
    "",
    "services",
  ]) {
    assert.equal(isPublicNavigationHref(href), false, `${href} must not be a public navigation target`);
  }
});

test("a navigation item must lead somewhere the public site actually serves", () => {
  for (const href of ["/", "/services", "/services/", "/gallery/", "/contact", "/news/a-post/"]) {
    assert.equal(isPublicNavigationHref(href), true, `${href} should be allowed`);
  }
  // A path that is syntactically fine but is not a page.
  assert.equal(isPublicNavigationHref("/nowhere/"), false);
  assert.equal(isPublicNavigationHref("/news/"), true, "the news index is a public route");
});

test("Lane B stores paths without a trailing slash and the site serves them with one", () => {
  assert.equal(normalisePublicHref("/services"), "/services/");
  assert.equal(normalisePublicHref("/services/"), "/services/");
  assert.equal(normalisePublicHref("/"), "/");
  const chrome = buildSiteChrome(withNavigation([{ label: "บริการ", href: "/services" }]));
  assert.equal(chrome.navigation[0]?.href, "/services/");
});

test("a refused item is dropped and reported, not silently missing", () => {
  const chrome = buildSiteChrome(
    withNavigation([
      { label: "หน้าแรก", href: "/" },
      { label: "ระบบภายใน", href: "/app/jobs" },
      { label: "ติดต่อ", href: "/contact" },
    ]),
  );
  assert.deepEqual(chrome.navigation.map((link) => link.href), ["/", "/contact/"]);
  assert.match(chrome.fallbackReason ?? "", /1 navigation item/);
});

test("the same destination is not listed twice", () => {
  const chrome = buildSiteChrome(
    withNavigation([
      { label: "บริการ", href: "/services" },
      { label: "Services", href: "/services/" },
    ]),
  );
  assert.equal(chrome.navigation.length, 1);
});

test("the current page is marked so it is announced, not only coloured", () => {
  const chrome = buildSiteChrome(DEFAULT_SITE_SETTINGS, { currentPath: "/gallery/" });
  const gallery = chrome.navigation.find((link) => link.href === "/gallery/");
  assert.equal(gallery?.current, true);
  assert.equal(chrome.navigation.filter((link) => link.current).length, 1);
  // And it works from the un-slashed form the CMS stores.
  const fromCms = buildSiteChrome(DEFAULT_SITE_SETTINGS, { currentPath: "/gallery" });
  assert.equal(fromCms.navigation.find((link) => link.href === "/gallery/")?.current, true);
});

// --- telephone numbers ------------------------------------------------------

test("a telephone link is dialable, separators removed", () => {
  const chrome = buildSiteChrome(withContact("063-194-1191"));
  assert.equal(chrome.telephones[0]?.display, "063-194-1191");
  // Some handsets dial a tel: href containing separators incorrectly, which on
  // a phone-first site is the difference between a call and a lost customer.
  assert.equal(chrome.telephones[0]?.href, "tel:0631941191");
});

test("an international number keeps its plus", () => {
  const chrome = buildSiteChrome(withContact("+66 63 194 1191"));
  assert.equal(chrome.telephones[0]?.href, "tel:+66631941191");
});

test("a number that cannot be dialled is not offered as a link", () => {
  // Falls back rather than rendering a header with no reachable number.
  const chrome = buildSiteChrome(withContact("โทรหาเรา"));
  assert.ok(chrome.telephones.length > 0);
  assert.match(chrome.fallbackReason ?? "", /telephone/);
  assert.equal(chrome.telephones[0]?.href, "tel:0631941191", "the shipped number is used instead");
});

test("one number is enough, and an empty second is not published", () => {
  const chrome = buildSiteChrome(withContact("063-194-1191", ""));
  assert.equal(chrome.telephones.length, 1);
  assert.equal(chrome.fallbackReason, null);
});

// --- the fallback that matters ---------------------------------------------

test("unusable settings render the shipped chrome rather than an empty header", () => {
  // Body content that fails falls back to the static release and the visitor
  // never knows. Chrome that fails leaves the site with no way to get
  // anywhere, on every URL at once.
  const cases: Array<[string, SiteSettings | null]> = [
    ["nothing published", null],
    ["every link refused", withNavigation([{ label: "ระบบ", href: "/app/" }])],
    ["no links at all", withNavigation([])],
    ["no brand", settings({ brand: { ...DEFAULT_SITE_SETTINGS.brand, name: "", legalName: "" } })],
  ];

  for (const [name, input] of cases) {
    const chrome = buildSiteChrome(input);
    assert.ok(chrome.navigation.length > 0, `${name}: the header must still navigate`);
    assert.ok(chrome.telephones.length > 0, `${name}: the telephone route must survive`);
    assert.ok(chrome.brand.name.length > 0, `${name}: the brand must still be named`);
    assert.ok(chrome.fallbackReason, `${name}: the fallback must be reported, not silent`);
  }
});

test("the brand link is named for a screen reader rather than left as a logo", () => {
  const chrome = buildSiteChrome(DEFAULT_SITE_SETTINGS);
  assert.equal(chrome.brand.homeLabel, "NATHEE GROUP 2025 หน้าแรก");
});

test("the footer repeats the navigation without the home link above it", () => {
  const chrome = buildSiteChrome(DEFAULT_SITE_SETTINGS);
  assert.equal(chrome.footer.links.some((link) => link.href === "/"), false);
  assert.equal(chrome.footer.links.length, chrome.navigation.length - 1);
  assert.ok(chrome.footer.copyright.length > 0);
});

test("an editor renaming the brand changes it everywhere at once", () => {
  const renamed = buildSiteChrome(
    settings({ brand: { ...DEFAULT_SITE_SETTINGS.brand, name: "NATHEE LOGISTICS", legalName: "บริษัท ทดสอบ จำกัด" } }),
  );
  assert.equal(renamed.brand.name, "NATHEE LOGISTICS");
  assert.equal(renamed.brand.homeLabel, "NATHEE LOGISTICS หน้าแรก");
  assert.equal(renamed.fallbackReason, null);
});
