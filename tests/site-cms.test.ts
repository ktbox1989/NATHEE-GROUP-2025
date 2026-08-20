import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SITE_CONTENT,
  SITE_PAGE_DEFINITIONS,
  isSitePageSlug,
  parseCmsPageContent,
  parseCmsPageContentJson,
} from "../lib/site-cms-content.ts";
import {
  DEFAULT_SITE_SETTINGS,
  parseSiteSettings,
  parseSiteSettingsJson,
  serializeSiteSettings,
} from "../lib/site-settings-content.ts";
import { serializeStructuredData, siteOrganizationSchema } from "../lib/site-structured-data.ts";

test("every managed page default is valid structured content", () => {
  for (const [slug, content] of Object.entries(DEFAULT_SITE_CONTENT)) {
    assert.equal(isSitePageSlug(slug), true);
    assert.deepEqual(parseCmsPageContent(content), content);
  }
});

test("CMS accepts only the allowlisted page identities", () => {
  const expected = ["home", "services", "motorcycle-transport", "international", "storage", "container-loading", "dealer-fleet", "quotation", "about", "contact"];
  assert.deepEqual(Object.keys(SITE_PAGE_DEFINITIONS), expected);
  assert.equal(new Set(Object.values(SITE_PAGE_DEFINITIONS).map((definition) => definition.path)).size, expected.length);
  for (const slug of expected) assert.equal(isSitePageSlug(slug), true);
  for (const slug of ["admin", "login", "app", "../home", "HOME"]) assert.equal(isSitePageSlug(slug), false);
});

test("CMS rejects unsafe links and malformed structured content", () => {
  const base = structuredClone(DEFAULT_SITE_CONTENT.home);
  base.sections[0].primaryHref = "javascript:alert(1)";
  assert.equal(parseCmsPageContent(base), null);

  const protocolRelative = structuredClone(DEFAULT_SITE_CONTENT.home);
  protocolRelative.sections[0].primaryHref = "//attacker.example";
  assert.equal(parseCmsPageContent(protocolRelative), null);

  const duplicateId = structuredClone(DEFAULT_SITE_CONTENT.home);
  duplicateId.sections[1].id = duplicateId.sections[0].id;
  assert.equal(parseCmsPageContent(duplicateId), null);

  assert.equal(parseCmsPageContentJson("not-json"), null);
  assert.equal(parseCmsPageContentJson("{}"), null);
});

test("CMS rejects unbounded sections, features and Gallery limits", () => {
  const tooManySections = structuredClone(DEFAULT_SITE_CONTENT.home);
  tooManySections.sections = Array.from({ length: 21 }, (_, index) => ({
    ...structuredClone(tooManySections.sections[0]),
    id: `section-${index}`,
  }));
  assert.equal(parseCmsPageContent(tooManySections), null);

  const tooManyItems = structuredClone(DEFAULT_SITE_CONTENT.home);
  tooManyItems.sections[1].items = Array.from({ length: 13 }, (_, index) => ({ title: `รายการ ${index}`, body: "รายละเอียด" }));
  assert.equal(parseCmsPageContent(tooManyItems), null);

  const galleryLimit = structuredClone(DEFAULT_SITE_CONTENT.home);
  galleryLimit.sections[2].galleryLimit = 25;
  assert.equal(parseCmsPageContent(galleryLimit), null);
});

test("content text remains data and is not interpreted as raw HTML", () => {
  const content = structuredClone(DEFAULT_SITE_CONTENT.home);
  content.sections[0].heading = "<script>alert('xss')</script>";
  const parsed = parseCmsPageContent(content);
  assert.equal(parsed?.sections[0].heading, "<script>alert('xss')</script>");
});

test("CMS allows only the exact Google Maps search navigation contract", () => {
  const valid = structuredClone(DEFAULT_SITE_CONTENT.contact);
  assert.ok(parseCmsPageContent(valid));
  const malicious = structuredClone(DEFAULT_SITE_CONTENT.contact);
  malicious.sections.at(-1)!.primaryHref = "https://www.google.com/maps/search/?api=1&query=nathee%26redirect%3Dhttps%3A%2F%2Fevil.example";
  assert.equal(parseCmsPageContent(malicious), null);
  const wrongHost = structuredClone(DEFAULT_SITE_CONTENT.contact);
  wrongHost.sections.at(-1)!.primaryHref = "https://evil.example/maps/search/?api=1&query=nathee";
  assert.equal(parseCmsPageContent(wrongHost), null);
});

test("global site settings default is valid and round-trips deterministically", () => {
  assert.deepEqual(parseSiteSettings(DEFAULT_SITE_SETTINGS), DEFAULT_SITE_SETTINGS);
  const serialized = serializeSiteSettings(DEFAULT_SITE_SETTINGS);
  assert.deepEqual(parseSiteSettingsJson(serialized), DEFAULT_SITE_SETTINGS);
  assert.equal(serializeSiteSettings(parseSiteSettingsJson(serialized)!), serialized);
});

test("global site settings reject unsafe, duplicate and private navigation", () => {
  for (const href of ["https://attacker.example", "//attacker.example", "/api/health", "/app", "/auth/callback", "/UPPERCASE"]) {
    const content = structuredClone(DEFAULT_SITE_SETTINGS);
    content.navigation.items[1].href = href;
    assert.equal(parseSiteSettings(content), null, href);
  }

  const duplicate = structuredClone(DEFAULT_SITE_SETTINGS);
  duplicate.navigation.items[1].href = "/";
  assert.equal(parseSiteSettings(duplicate), null);

  const missingHome = structuredClone(DEFAULT_SITE_SETTINGS);
  missingHome.navigation.items = missingHome.navigation.items.filter((item) => item.href !== "/");
  assert.equal(parseSiteSettings(missingHome), null);
});

test("global site settings reject malformed contact and media identity", () => {
  const invalidPhone = structuredClone(DEFAULT_SITE_SETTINGS);
  invalidPhone.contact.primaryPhone = "โทรหาทีมงาน";
  assert.equal(parseSiteSettings(invalidPhone), null);

  const invalidLogo = structuredClone(DEFAULT_SITE_SETTINGS);
  invalidLogo.brand.logoItemId = "../private-image";
  assert.equal(parseSiteSettings(invalidLogo), null);

  const tooManyLinks = structuredClone(DEFAULT_SITE_SETTINGS);
  tooManyLinks.navigation.items = Array.from({ length: 9 }, (_, index) => ({ label: `เมนู ${index}`, href: index ? `/menu-${index}` : "/" }));
  assert.equal(parseSiteSettings(tooManyLinks), null);
});

test("editable organization structured data cannot terminate its script element", () => {
  const content = structuredClone(DEFAULT_SITE_SETTINGS);
  content.brand.legalName = "บริษัท </script><script>alert(1)</script> จำกัด";
  const parsed = parseSiteSettings(content);
  assert.ok(parsed);
  const json = serializeStructuredData(siteOrganizationSchema(parsed));
  assert.doesNotMatch(json, /<\/script/i);
  assert.match(json, /\\u003c\/script/);
  assert.equal(JSON.parse(json).name, content.brand.legalName);
});
