import assert from "node:assert/strict";
import test from "node:test";
import { buildMediaPickerOptions } from "../lib/media-picker.ts";
import type { PublicMedia } from "../lib/public-cms/contract.ts";
import { buildPublicMediaPath } from "../lib/public-media-delivery.ts";
import {
  MAX_ADDRESS_LINES,
  offendingContactField,
  withBlankAddressLinesRemoved,
} from "../lib/settings-contact-validation.ts";
import { DEFAULT_SITE_SETTINGS, parseSiteSettings, type SiteSettings } from "../lib/site-settings-content.ts";

function withContact(contact: Partial<SiteSettings["contact"]>): SiteSettings {
  return { ...DEFAULT_SITE_SETTINGS, contact: { ...DEFAULT_SITE_SETTINGS.contact, ...contact } };
}

// --- the four contact fields -------------------------------------------------

test("the four contact fields round-trip through the server's own validator", () => {
  const settings = withContact({
    email: "info@natheegroup2025.com",
    addressLines: ["99/9 หมู่ 9", "ตำบลบางพลีใหญ่", "อำเภอบางพลี สมุทรปราการ 10540"],
    lineId: "@natheegroup",
    lineQrItemId: "line-qr-owner-supplied",
  });
  const parsed = parseSiteSettings(settings);
  assert.ok(parsed);
  assert.equal(parsed.contact.email, "info@natheegroup2025.com");
  assert.deepEqual(parsed.contact.addressLines, ["99/9 หมู่ 9", "ตำบลบางพลีใหญ่", "อำเภอบางพลี สมุทรปราการ 10540"]);
  assert.equal(parsed.contact.lineId, "@natheegroup");
  assert.equal(parsed.contact.lineQrItemId, "line-qr-owner-supplied");
});

test("all four are optional, and the shipped defaults leave every one empty", () => {
  // Nothing may be pre-filled: the repository holds no confirmed address, email
  // or LINE id, and a plausible wrong one on a logistics site is a lost enquiry.
  assert.equal(DEFAULT_SITE_SETTINGS.contact.email, "");
  assert.deepEqual(DEFAULT_SITE_SETTINGS.contact.addressLines, []);
  assert.equal(DEFAULT_SITE_SETTINGS.contact.lineId, "");
  assert.equal(DEFAULT_SITE_SETTINGS.contact.lineQrItemId, "");
  assert.ok(parseSiteSettings(DEFAULT_SITE_SETTINGS));
});

test("a blank line left between two filled ones does not become a stored empty line", () => {
  const cleaned = withBlankAddressLinesRemoved(
    withContact({ addressLines: ["99/9 หมู่ 9", "   ", "สมุทรปราการ 10540", ""] }),
  );
  assert.deepEqual(cleaned.contact.addressLines, ["99/9 หมู่ 9", "สมุทรปราการ 10540"]);
});

test("more address lines than the contract allows is refused, not truncated", () => {
  const tooMany = withContact({ addressLines: Array.from({ length: MAX_ADDRESS_LINES + 1 }, (_, i) => `line ${i}`) });
  assert.equal(parseSiteSettings(tooMany), null);
  assert.ok(parseSiteSettings(withContact({ addressLines: Array.from({ length: MAX_ADDRESS_LINES }, (_, i) => `line ${i}`) })));
});

test("a malformed email is named as the failing field rather than reported as 'settings invalid'", () => {
  assert.equal(offendingContactField(withContact({ email: "not an address" })), "อีเมล");
  assert.equal(offendingContactField(withContact({ email: "someone@example" })), "อีเมล");
  assert.equal(offendingContactField(withContact({ email: "info@natheegroup2025.com" })), null);
});

test("a malformed LINE id is named, and an empty one is simply optional", () => {
  assert.equal(offendingContactField(withContact({ lineId: "ก" })), "LINE ID");
  assert.equal(offendingContactField(withContact({ lineId: "" })), null);
  assert.equal(offendingContactField(withContact({ lineId: "@natheegroup" })), null);
});

test("a malformed QR reference is named, and removing it makes the document valid again", () => {
  assert.equal(offendingContactField(withContact({ lineQrItemId: "not a media id!" })), "QR Code LINE");
  // Removal is how the Owner clears the picker, so it has to be a valid state.
  assert.equal(offendingContactField(withContact({ lineQrItemId: "" })), null);
});

test("a failure outside the optional fields is not blamed on one of them", () => {
  // The phone is required and wrong here. Naming "อีเมล" would send the Owner
  // to a box that is fine.
  const badPhone = withContact({ primaryPhone: "nonsense" });
  assert.equal(parseSiteSettings(badPhone), null);
  assert.equal(offendingContactField(badPhone), null);
});

// --- the media picker --------------------------------------------------------

function media(id: string, formats: Array<{ role: "display" | "thumbnail"; format: "jpeg" | "webp" | "avif" }>): PublicMedia {
  return {
    id,
    altText: `alt ${id}`,
    caption: null,
    variants: formats.map((entry) => ({
      src: buildPublicMediaPath({ itemId: id, role: entry.role, format: entry.format })!,
      width: entry.role === "thumbnail" ? 640 : 1600,
      height: entry.role === "thumbnail" ? 480 : 1200,
      format: entry.format,
      role: entry.role,
    })),
  };
}

test("the picker offers only media that resolved, so it cannot suggest an unpublishable item", () => {
  const resolved = new Map([["photo-1", media("photo-1", [{ role: "display", format: "jpeg" }])]]);
  const options = buildMediaPickerOptions(
    [{ id: "photo-1", label: "หนึ่ง" }, { id: "photo-draft", label: "ยังไม่เผยแพร่" }],
    resolved,
  );
  assert.deepEqual(options.map((option) => option.id), ["photo-1"]);
});

test("the preview is a canonical /assets/media path, never the authenticated route", () => {
  const resolved = new Map([["photo-1", media("photo-1", [{ role: "display", format: "jpeg" }])]]);
  const [option] = buildMediaPickerOptions([{ id: "photo-1", label: "หนึ่ง" }], resolved);
  assert.equal(option.previewSrc, "/assets/media/photo-1/display.jpg");
  assert.ok(!option.previewSrc.includes("/api/"));
});

test("the small raster is preferred, and a media with no raster at all is not offered", () => {
  const withThumb = new Map([
    ["photo-1", media("photo-1", [
      { role: "display", format: "jpeg" },
      { role: "thumbnail", format: "jpeg" },
      { role: "thumbnail", format: "webp" },
    ])],
  ]);
  assert.equal(buildMediaPickerOptions([{ id: "photo-1", label: "หนึ่ง" }], withThumb)[0].previewSrc, "/assets/media/photo-1/thumbnail.jpg");

  // webp and avif only: the editor is not the place to discover a browser
  // cannot decode the preview.
  const noRaster = new Map([["photo-2", media("photo-2", [{ role: "display", format: "webp" }, { role: "display", format: "avif" }])]]);
  assert.deepEqual(buildMediaPickerOptions([{ id: "photo-2", label: "สอง" }], noRaster), []);
});

test("the picker carries intrinsic dimensions, so the editor does not reflow as previews load", () => {
  const resolved = new Map([["photo-1", media("photo-1", [{ role: "thumbnail", format: "jpeg" }])]]);
  const [option] = buildMediaPickerOptions([{ id: "photo-1", label: "หนึ่ง" }], resolved);
  assert.equal(option.width, 640);
  assert.equal(option.height, 480);
});
