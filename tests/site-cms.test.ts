import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SITE_CONTENT,
  isSitePageSlug,
  parseCmsPageContent,
  parseCmsPageContentJson,
} from "../lib/site-cms-content.ts";

test("every managed page default is valid structured content", () => {
  for (const [slug, content] of Object.entries(DEFAULT_SITE_CONTENT)) {
    assert.equal(isSitePageSlug(slug), true);
    assert.deepEqual(parseCmsPageContent(content), content);
  }
});

test("CMS accepts only the allowlisted page identities", () => {
  for (const slug of ["home", "services", "about", "contact"]) assert.equal(isSitePageSlug(slug), true);
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
