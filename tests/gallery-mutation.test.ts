import assert from "node:assert/strict";
import test from "node:test";
import {
  canFeatureGallery,
  canPublishGallery,
  clearsFeatured,
  GALLERY_ACTIONS,
  isGalleryAction,
  isPubliclyServable,
  requiresPublishPermission,
  validateGalleryScope,
} from "../lib/gallery-mutation.ts";
import { GALLERY_ITEM_STATUSES, GALLERY_VISIBILITIES } from "../db/schema.ts";

test("only the declared actions are recognised", () => {
  for (const action of GALLERY_ACTIONS) assert.equal(isGalleryAction(action), true, action);
  for (const invalid of ["", "DELETE", "update", "PUBLISH ", "__proto__", "DROP"]) {
    assert.equal(isGalleryAction(invalid), false, invalid);
  }
});

test("editing a draft needs write; touching anything public needs publish as well", () => {
  // A draft is an editor's own working copy.
  assert.equal(requiresPublishPermission("UPDATE", "DRAFT"), false);
  assert.equal(requiresPublishPermission("ARCHIVE", "DRAFT"), false);

  // Every action that changes what the public sees.
  for (const action of ["PUBLISH", "HIDE", "FEATURE", "UNFEATURE"]) {
    for (const status of GALLERY_ITEM_STATUSES) {
      assert.equal(requiresPublishPermission(action, status), true, `${action} from ${status}`);
    }
  }

  // And any edit at all to something already live.
  for (const action of GALLERY_ACTIONS) {
    assert.equal(requiresPublishPermission(action, "PUBLISHED"), true, `${action} on a published item`);
  }
});

test("editing an archived or hidden item does not silently need publish rights", () => {
  assert.equal(requiresPublishPermission("UPDATE", "HIDDEN"), false);
  assert.equal(requiresPublishPermission("UPDATE", "ARCHIVED"), false);
});

test("a public photograph cannot carry a customer, and a customer photograph cannot lack one", () => {
  assert.deepEqual(validateGalleryScope({ visibility: "PUBLIC", companyId: null, jobId: null }), {
    ok: true,
    visibility: "PUBLIC",
  });
  // This is the leak the rule exists for: a customer's job attached to
  // something shown on the marketing site.
  assert.deepEqual(validateGalleryScope({ visibility: "PUBLIC", companyId: "company-a", jobId: null }), {
    ok: false,
    reason: "invalid_scope",
  });
  assert.deepEqual(validateGalleryScope({ visibility: "PUBLIC", companyId: null, jobId: "job-a" }), {
    ok: false,
    reason: "invalid_scope",
  });

  assert.deepEqual(validateGalleryScope({ visibility: "CUSTOMER_JOB", companyId: "company-a", jobId: "job-a" }), {
    ok: true,
    visibility: "CUSTOMER_JOB",
  });
  for (const partial of [
    { companyId: "company-a", jobId: null },
    { companyId: null, jobId: "job-a" },
    { companyId: null, jobId: null },
  ]) {
    assert.deepEqual(validateGalleryScope({ visibility: "CUSTOMER_JOB", ...partial }), {
      ok: false,
      reason: "invalid_scope",
    });
  }
});

test("an internal photograph may be scoped either way but never published", () => {
  assert.equal(validateGalleryScope({ visibility: "INTERNAL", companyId: null, jobId: null }).ok, true);
  assert.equal(validateGalleryScope({ visibility: "INTERNAL", companyId: "company-a", jobId: "job-a" }).ok, true);
  assert.equal(
    canPublishGallery({ categoryStatus: "ACTIVE", visibility: "INTERNAL", hasDisplayVariant: true, altText: "คำบรรยาย" }),
    false,
  );
});

test("an unknown visibility is refused rather than defaulted", () => {
  for (const invalid of ["", "EVERYONE", "PUBLIC;--", "__proto__", "PUBLIC PUBLIC"]) {
    assert.deepEqual(
      validateGalleryScope({ visibility: invalid, companyId: null, jobId: null }),
      { ok: false, reason: "invalid_gallery" },
      invalid,
    );
  }
  // Case and surrounding whitespace are normalised, matching what the form posts.
  for (const accepted of [" public ", "Public", "PUBLIC"]) {
    assert.deepEqual(
      validateGalleryScope({ visibility: accepted, companyId: null, jobId: null }),
      { ok: true, visibility: "PUBLIC" },
      accepted,
    );
  }
});

test("publishing requires an active category, a rendered variant and real alt text", () => {
  const base = { categoryStatus: "ACTIVE", visibility: "PUBLIC" as const, hasDisplayVariant: true, altText: "ภาพงานจริง" };
  assert.equal(canPublishGallery(base), true);
  assert.equal(canPublishGallery({ ...base, categoryStatus: "HIDDEN" }), false);
  assert.equal(canPublishGallery({ ...base, categoryStatus: undefined }), false);
  assert.equal(canPublishGallery({ ...base, hasDisplayVariant: false }), false);
  assert.equal(canPublishGallery({ ...base, altText: "" }), false);
  assert.equal(canPublishGallery({ ...base, altText: "  " }), false);
  assert.equal(canPublishGallery({ ...base, altText: "ab" }), false, "alt text must be more than a placeholder");
});

test("only a live public photograph can be featured", () => {
  assert.equal(canFeatureGallery({ status: "PUBLISHED", visibility: "PUBLIC" }), true);
  for (const status of GALLERY_ITEM_STATUSES) {
    if (status === "PUBLISHED") continue;
    assert.equal(canFeatureGallery({ status, visibility: "PUBLIC" }), false, `featured while ${status}`);
  }
  for (const visibility of GALLERY_VISIBILITIES) {
    if (visibility === "PUBLIC") continue;
    assert.equal(canFeatureGallery({ status: "PUBLISHED", visibility }), false, `featured while ${visibility}`);
  }
});

test("hiding or archiving clears featured, so nothing stays promoted while unseen", () => {
  assert.equal(clearsFeatured("HIDE"), true);
  assert.equal(clearsFeatured("ARCHIVE"), true);
  assert.equal(clearsFeatured("UNFEATURE"), true);
  assert.equal(clearsFeatured("PUBLISH"), false);
  assert.equal(clearsFeatured("UPDATE"), false);
  assert.equal(clearsFeatured("FEATURE"), false);
});

test("exactly one combination is publicly servable, and drafts are not it", () => {
  let servable = 0;
  for (const status of GALLERY_ITEM_STATUSES) {
    for (const visibility of GALLERY_VISIBILITIES) {
      for (const categoryStatus of ["ACTIVE", "HIDDEN"]) {
        const ok = isPubliclyServable({ status, visibility, categoryStatus });
        if (ok) servable += 1;
        if (status !== "PUBLISHED" || visibility !== "PUBLIC" || categoryStatus !== "ACTIVE") {
          assert.equal(ok, false, `${status}/${visibility}/${categoryStatus} must not be public`);
        }
      }
    }
  }
  assert.equal(servable, 1, "PUBLISHED + PUBLIC + ACTIVE category is the only public combination");
  assert.equal(isPubliclyServable({ status: "DRAFT", visibility: "PUBLIC", categoryStatus: "ACTIVE" }), false);
  assert.equal(isPubliclyServable({ status: "PUBLISHED", visibility: "CUSTOMER_JOB", categoryStatus: "ACTIVE" }), false);
});
