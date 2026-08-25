import assert from "node:assert/strict";
import test from "node:test";
import { collectSettingsReferences } from "../lib/site-cms-publish.ts";
import {
  DEFAULT_SITE_SETTINGS,
  MAX_ADDRESS_LINES,
  parseSiteSettings,
  parseSiteSettingsJson,
  serializeSiteSettings,
} from "../lib/site-settings-content.ts";

// The four contact details the Owner could not edit: address, email, LINE id
// and the LINE QR. The rule that outranks all four - an unset channel renders
// as nothing, never as a plausible placeholder. There is no Owner-confirmed
// address, email or LINE id anywhere in this repository, and the static contact
// page says so in its own copy rather than showing a sample.

function withContact(patch: Record<string, unknown>) {
  return parseSiteSettings({
    ...DEFAULT_SITE_SETTINGS,
    contact: { ...DEFAULT_SITE_SETTINGS.contact, ...patch },
  });
}

test("the shipped defaults publish no address, email, LINE id or QR", () => {
  assert.equal(DEFAULT_SITE_SETTINGS.contact.email, "");
  assert.equal(DEFAULT_SITE_SETTINGS.contact.lineId, "");
  assert.equal(DEFAULT_SITE_SETTINGS.contact.lineQrItemId, "");
  assert.deepEqual(DEFAULT_SITE_SETTINGS.contact.addressLines, []);
  // And the defaults are a payload the parser accepts, so nothing is set here
  // that could not also be saved.
  assert.deepEqual(parseSiteSettings(DEFAULT_SITE_SETTINGS), DEFAULT_SITE_SETTINGS);
});

// Revisions are immutable. Every settings revision already stored was written
// before these fields existed, so the parser is the only thing that can stay
// compatible with them.
test("a settings revision written before these fields existed still parses", () => {
  const legacy = {
    version: 1,
    brand: DEFAULT_SITE_SETTINGS.brand,
    contact: { primaryPhone: "063-194-1191", secondaryPhone: "085-680-2082" },
    navigation: DEFAULT_SITE_SETTINGS.navigation,
    footer: DEFAULT_SITE_SETTINGS.footer,
  };
  const parsed = parseSiteSettings(legacy);
  assert.ok(parsed, "a legacy revision was refused");
  assert.equal(parsed.contact.primaryPhone, "063-194-1191");
  assert.equal(parsed.contact.secondaryPhone, "085-680-2082");
  assert.equal(parsed.contact.email, "");
  assert.equal(parsed.contact.lineId, "");
  assert.equal(parsed.contact.lineQrItemId, "");
  assert.deepEqual(parsed.contact.addressLines, []);
});

// The settings editor builds its payload by spreading the settings it was
// given, so it carries fields it has never heard of. This is what lets the
// write contract land before the form does without an Owner losing data.
test("an editor that does not know these fields does not drop them", () => {
  const stored = withContact({
    email: "info@natheegroup2025.com",
    lineId: "@natheegroup",
    lineQrItemId: "gallery-line-qr-01",
    addressLines: ["99/9 หมู่ 9 ถนนสายเอเชีย"],
  });
  assert.ok(stored);
  // Exactly what a form does: spread the whole object, replace one known field.
  const asAnOldEditorWouldSave = { ...stored, contact: { ...stored.contact, primaryPhone: "02-000-1111" } };
  const reparsed = parseSiteSettings(asAnOldEditorWouldSave);
  assert.ok(reparsed);
  assert.equal(reparsed.contact.primaryPhone, "02-000-1111");
  assert.equal(reparsed.contact.email, "info@natheegroup2025.com");
  assert.equal(reparsed.contact.lineId, "@natheegroup");
  assert.equal(reparsed.contact.lineQrItemId, "gallery-line-qr-01");
  assert.deepEqual(reparsed.contact.addressLines, ["99/9 หมู่ 9 ถนนสายเอเชีย"]);
});

test("an email address is either absent or one that could be delivered to", () => {
  assert.equal(withContact({ email: "" })?.contact.email, "");
  assert.equal(withContact({ email: "info@natheegroup2025.com" })?.contact.email, "info@natheegroup2025.com");
  for (const invalid of [
    "info",
    "info@",
    "@example.com",
    "info@example",
    "in fo@example.com",
    "info@example.com, other@example.com",
    "info@example.com\nBcc: someone@example.com",
  ]) {
    assert.equal(withContact({ email: invalid }), null, `${JSON.stringify(invalid)} was accepted`);
  }
});

test("a LINE id is an id someone could search for, or nothing", () => {
  assert.equal(withContact({ lineId: "@natheegroup" })?.contact.lineId, "@natheegroup");
  assert.equal(withContact({ lineId: "nathee_2025" })?.contact.lineId, "nathee_2025");
  for (const invalid of ["ab", "line id", "นที", "@@double", "id!", "a".repeat(40)]) {
    assert.equal(withContact({ lineId: invalid }), null, `${JSON.stringify(invalid)} was accepted`);
  }
});

test("the LINE QR is a gallery item id, exactly like the logo", () => {
  assert.equal(withContact({ lineQrItemId: "" })?.contact.lineQrItemId, "");
  assert.equal(withContact({ lineQrItemId: "gallery-line-qr-01" })?.contact.lineQrItemId, "gallery-line-qr-01");
  for (const invalid of ["../secrets", "gallery/line-qr", "line qr", "line.qr", "@qr"]) {
    assert.equal(withContact({ lineQrItemId: invalid }), null, `${JSON.stringify(invalid)} was accepted`);
  }
});

// Without this a published settings revision can point at an archived QR and
// the contact page loses it silently - which is the exact failure Lane A named.
test("publishing settings verifies the LINE QR beside the logo", () => {
  const settings = withContact({ lineQrItemId: "gallery-line-qr-01" });
  assert.ok(settings);
  const references = collectSettingsReferences({
    ...settings,
    brand: { ...settings.brand, logoItemId: "gallery-logo-01" },
  });
  assert.deepEqual([...references.imageItemIds], ["gallery-line-qr-01", "gallery-logo-01"]);

  // And a settings record with neither adds nothing to verify.
  const bare = withContact({ lineQrItemId: "" });
  assert.deepEqual([...collectSettingsReferences({ ...bare!, brand: { ...bare!.brand, logoItemId: "" } }).imageItemIds], []);
});

test("an address is lines, bounded, with no blank row in the middle", () => {
  const parsed = withContact({ addressLines: ["99/9 หมู่ 9", "   ", "ตำบลบ้านกรด", "อยุธยา 13000"] });
  assert.deepEqual(parsed?.contact.addressLines, ["99/9 หมู่ 9", "ตำบลบ้านกรด", "อยุธยา 13000"]);

  assert.equal(withContact({ addressLines: Array(MAX_ADDRESS_LINES + 1).fill("x") }), null, "more lines than allowed");
  assert.equal(withContact({ addressLines: "99/9 หมู่ 9" }), null, "a single string is not an address");
  assert.equal(withContact({ addressLines: [42] }), null, "a non-string line was accepted");
  assert.deepEqual(withContact({ addressLines: [] })?.contact.addressLines, []);
});

test("the whole settings document round-trips through storage", () => {
  const settings = withContact({
    email: "info@natheegroup2025.com",
    lineId: "@natheegroup",
    lineQrItemId: "gallery-line-qr-01",
    addressLines: ["99/9 หมู่ 9 ถนนสายเอเชีย", "ตำบลบ้านกรด อำเภอบางปะอิน", "จังหวัดพระนครศรีอยุธยา 13160"],
  });
  assert.ok(settings);
  const json = serializeSiteSettings(settings);
  // `ck_site_settings_revisions_json` bounds the column at 20,000 bytes; this
  // is the whole record with every optional channel filled in.
  assert.ok(json.length < 20_000, `settings document is ${json.length} bytes`);
  assert.deepEqual(parseSiteSettingsJson(json), settings);
});
