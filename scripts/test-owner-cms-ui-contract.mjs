import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The Owner CMS is now wired to write contracts someone else owns, and the
// failure mode of that wiring is quiet: a field name that drifts, a picker that
// offers something publish will refuse, a reorder that sends part of a
// category, a control that reports success the server never gave.
//
// Every rule below is one of those. None of them is a style preference.

const root = process.env.OWNER_CMS_UI_ROOT
  ? resolve(process.env.OWNER_CMS_UI_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
// .ts and .tsx are unpinned in .gitattributes, so a Windows checkout is CRLF.
const read = async (path) => (await readFile(join(root, path), "utf8")).split("\r\n").join("\n");
const failures = [];
const require = (condition, message) => { if (!condition) failures.push(message); };

const SETTINGS_EDITOR = "components/site-settings-editor.tsx";
const SETTINGS_PAGE = "app/app/site-settings/page.tsx";
const MEDIA_PICKER = "components/media-picker.tsx";
const PAGE_EDITOR = "components/site-page-editor.tsx";
const ORDER_BOARD = "components/gallery-order-board.tsx";
const ORDER_PAGE = "app/app/gallery/order/page.tsx";
const PUBLIC_PAGE = "components/cms-public-page.tsx";

const [settingsEditor, settingsPage, mediaPicker, pageEditor, orderBoard, orderPage, publicPage] = await Promise.all(
  [SETTINGS_EDITOR, SETTINGS_PAGE, MEDIA_PICKER, PAGE_EDITOR, ORDER_BOARD, ORDER_PAGE, PUBLIC_PAGE].map(read),
);

// 1. The four contact fields, by the names the write contract uses. A field
//    named anything else is silently dropped on save.
for (const field of ["contact.email", "contact.addressLines", "contact.lineId", "contact.lineQrItemId"]) {
  const property = field.split(".")[1];
  require(
    settingsEditor.includes(`contact, ${property}:`),
    `${SETTINGS_EDITOR}: does not write ${field}; a field name that is not the contract's is dropped on save`,
  );
}

// 2. The editor refuses a document the server would refuse, using the server's
//    own validator rather than a second copy of its rules — and it names the
//    field. A save that appears to work and did not is the failure this exists
//    to prevent.
require(
  settingsEditor.includes("offendingContactField(") && settingsEditor.includes("parseSiteSettings("),
  `${SETTINGS_EDITOR}: must validate with the server's validator before submitting`,
);
require(
  settingsEditor.includes("event.preventDefault()"),
  `${SETTINGS_EDITOR}: an invalid document must stop the submission rather than report success`,
);
require(
  settingsEditor.includes("withBlankAddressLinesRemoved("),
  `${SETTINGS_EDITOR}: blank address lines must be dropped before the document is built`,
);

// 3. The picker offers only what can be served, and previews it from the one
//    delivery contract. An /api/ URL here is the form the public contract
//    refuses outright; a storage key is a private path.
require(
  settingsPage.includes("resolvePublicMedia(") && settingsPage.includes("buildMediaPickerOptions("),
  `${SETTINGS_PAGE}: picker options must come from a resolved public-media set`,
);
for (const [path, source] of [[SETTINGS_EDITOR, settingsEditor], [MEDIA_PICKER, mediaPicker]]) {
  require(
    !source.includes("/api/gallery/images/"),
    `${path}: previews media through the authenticated route instead of the delivery contract`,
  );
  for (const forbidden of ["storageKey", "storage_key", "env.FILES"]) {
    require(!source.includes(forbidden), `${path}: references ${forbidden}, which is private storage`);
  }
}
require(
  mediaPicker.includes("option.previewSrc") || mediaPicker.includes("selected.previewSrc"),
  `${MEDIA_PICKER}: the preview must use the resolved source rather than a URL built here`,
);
// Selecting nothing, and un-selecting, are both real states.
require(mediaPicker.includes('onChange("")'), `${MEDIA_PICKER}: must offer a way to remove the selected media`);
require(mediaPicker.includes('<option value="">'), `${MEDIA_PICKER}: "not selected" must be a choice, not an absence`);

// 4. Robots uses the backend enum, and home is never offered NOINDEX — the
//    publish route refuses it, and a control that offers a rejected option is a
//    trap rather than a feature.
require(pageEditor.includes("CMS_ROBOTS"), `${PAGE_EDITOR}: the robots control must use the backend enum`);
require(
  pageEditor.includes("seo, robots:"),
  `${PAGE_EDITOR}: the robots control must write seo.robots`,
);
require(
  pageEditor.includes('slug === "home"') && pageEditor.includes("isHome"),
  `${PAGE_EDITOR}: the home page must not be offered NOINDEX, which publish refuses`,
);
require(
  pageEditor.includes('!isHome || value === "INDEX"'),
  `${PAGE_EDITOR}: the home page's options must be filtered, not merely labelled`,
);
// The explicit OG field is deliberately absent; the share image is derived.
require(
  !pageEditor.includes("ogImageItemId"),
  `${PAGE_EDITOR}: an explicit OG image field is not in the write contract and must not be invented`,
);

// 5. The reorder posts a complete category to the atomic endpoint. A partial
//    order leaves every unnamed item in front of the ones just arranged, which
//    is why the endpoint refuses one and why this must never send one.
require(
  orderBoard.includes('action="/api/gallery/order"') && orderBoard.includes('method="post"'),
  `${ORDER_BOARD}: must submit to the atomic order endpoint`,
);
for (const field of ["requestKey", "categoryId", "orderedIds", "returnTo"]) {
  require(orderBoard.includes(`name="${field}"`), `${ORDER_BOARD}: must send ${field}`);
}
require(
  orderBoard.includes('browserSecureId("gallery-order")'),
  `${ORDER_BOARD}: the request key must have the shape the endpoint accepts, so a replay is recognised`,
);
require(
  !orderBoard.includes("fetch("),
  `${ORDER_BOARD}: a fetch would need optimistic state; the form post reloads from the database instead`,
);
require(
  !orderBoard.includes("/api/gallery/${"),
  `${ORDER_BOARD}: must not write items one at a time any more`,
);
require(
  orderPage.includes("canReorder") && orderPage.includes("active !== null"),
  `${ORDER_PAGE}: reordering must require a single category, or the submitted set cannot be complete`,
);
require(
  orderPage.includes("GALLERY_ORDER_MAX_ITEMS"),
  `${ORDER_PAGE}: the category must be bounded by the endpoint's own limit`,
);
require(
  orderPage.includes("tooLarge"),
  `${ORDER_PAGE}: a category too large to order in one batch must be reported, not ordered in part`,
);
require(
  orderPage.includes("incomplete_order") && orderPage.includes("ไม่มีรูปใดถูกย้าย"),
  `${ORDER_PAGE}: a refusal must say plainly that nothing was moved`,
);

// 6. Keyboard and screen-reader access on the controls that are icons or bare
//    inputs. An arrow button with no name is unusable without sight.
for (const label of ["aria-label={`เลื่อน", 'aria-live="polite"']) {
  require(orderBoard.includes(label), `${ORDER_BOARD}: missing ${label}`);
}
require(settingsEditor.includes('className="sr-only"'), `${SETTINGS_EDITOR}: address line inputs must be named`);
require(
  mediaPicker.includes("htmlFor={selectId}") && mediaPicker.includes("id={selectId}"),
  `${MEDIA_PICKER}: the select must be associated with its label`,
);

// 7. The public side renders a contact detail only when it is populated, and
//    the QR only through the resolver. A placeholder address on a logistics
//    site is a lost enquiry, and an unreadable QR is worse than none.
require(
  publicPage.includes("resolveSettingsMedia("),
  `${PUBLIC_PAGE}: the QR must come from the settings media resolver`,
);
require(
  publicPage.includes("settings.contact.email &&") && publicPage.includes("settings.contact.lineId &&"),
  `${PUBLIC_PAGE}: optional contact details must render only when populated`,
);
require(
  publicPage.includes("if (!lineQr) return null"),
  `${PUBLIC_PAGE}: an unresolvable QR must render nothing rather than a broken image`,
);

// 8. A client component may not import a *value* from a module that resolves
//    the D1 binding.
//
//    Types are erased; values are bundled, and bundling one of these drags
//    `cloudflare:workers` into the browser build. The failure is the whole
//    application build, not a subtle bug — but it is easy to reintroduce,
//    because the db-backed module re-exports everything the pure one has and
//    the editor imports read identically.
const DB_BACKED_MODULES = ["@/lib/site-cms", "@/lib/site-settings", "@/db"];
for (const path of [SETTINGS_EDITOR, MEDIA_PICKER, PAGE_EDITOR, ORDER_BOARD]) {
  const source = await read(path);
  if (!source.startsWith('"use client"')) continue;
  for (const line of source.split("\n")) {
    if (!line.startsWith("import ")) continue;
    const backing = DB_BACKED_MODULES.find((candidate) => line.includes(`from "${candidate}"`));
    if (!backing) continue;
    // `import type { … }` is erased whole; otherwise every named specifier has
    // to carry its own `type` keyword to be erased.
    if (line.startsWith("import type ")) continue;
    const open = line.indexOf("{");
    const close = line.indexOf("}");
    const specifiers = open >= 0 && close > open ? line.slice(open + 1, close) : line;
    const values = specifiers
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry && !entry.startsWith("type "));
    require(
      values.length === 0,
      `${path}: imports the value(s) ${values.join(", ")} from ${backing}, which pulls cloudflare:workers into the client bundle — use the content module`,
    );
  }
}

// 9. The new controls collapse on a phone. The CMS is used from one, and a
//    two-column picker at 320px pushes the select off the screen.
const stylesheet = await read("app/globals.css");
for (const rule of [".media-picker-body", ".gallery-order-toolbar", ".site-settings-address", ".cms-contact-qr"]) {
  require(stylesheet.includes(rule), `app/globals.css: ${rule} has no styling at all`);
}
const smallScreen = stylesheet.slice(stylesheet.indexOf("@media (max-width: 600px)"));
for (const rule of [".media-picker-body", ".gallery-order-toolbar"]) {
  require(smallScreen.includes(rule), `app/globals.css: ${rule} does not collapse on a small screen`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`OWNER_CMS_UI_FAIL ${failure}`);
  process.exit(1);
}

console.log(
  "OWNER_CMS_UI_PASS contactFields=4 mediaPicker=resolved-only robots=backend-enum homeNoindex=refused reorder=atomic-per-category fakeSuccess=0 mobile=collapsed",
);
