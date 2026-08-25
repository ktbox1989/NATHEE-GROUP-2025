import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A gate that cannot fail is worse than no gate, because it gets reported as
// evidence. Each case is a specific way the Owner CMS wiring could stop being
// safe, applied to a copy of the tree.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts/test-owner-cms-ui-contract.mjs");
const TRACKED_TREES = ["app", "components", "lib"];

const SETTINGS_EDITOR = "components/site-settings-editor.tsx";
const SETTINGS_PAGE = "app/app/site-settings/page.tsx";
const MEDIA_PICKER = "components/media-picker.tsx";
const PAGE_EDITOR = "components/site-page-editor.tsx";
const ORDER_BOARD = "components/gallery-order-board.tsx";
const ORDER_PAGE = "app/app/gallery/order/page.tsx";
const PUBLIC_PAGE = "components/cms-public-page.tsx";

const CASES = [
  {
    name: "a contact field is renamed, so the save silently drops it",
    apply: (d) => edit(d, SETTINGS_EDITOR, (s) => s.replaceAll("contact, lineId:", "contact, lineID:")),
  },
  {
    name: "the editor stops validating and lets an invalid save look successful",
    apply: (d) => edit(d, SETTINGS_EDITOR, (s) => s.replace("offendingContactField(cleaned)", "null")),
  },
  {
    name: "blank address lines start being stored as empty lines",
    apply: (d) => edit(d, SETTINGS_EDITOR, (s) => s.replace("withBlankAddressLinesRemoved(settings)", "settings")),
  },
  {
    name: "the picker offers every gallery row again, including unpublishable ones",
    apply: (d) => edit(d, SETTINGS_PAGE, (s) => s.replace("buildMediaPickerOptions(", "rawOptions(")),
  },
  {
    name: "the picker previews through the authenticated media route",
    apply: (d) =>
      edit(d, MEDIA_PICKER, (s) => s.replace("src={selected.previewSrc}", "src={`/api/gallery/images/${selected.id}?role=thumbnail`}")),
  },
  {
    name: "the selected media can no longer be removed",
    apply: (d) => edit(d, MEDIA_PICKER, (s) => s.replace('onChange("")', "onChange(value)")),
  },
  {
    name: "the robots control stops using the backend enum",
    apply: (d) => edit(d, PAGE_EDITOR, (s) => s.replaceAll("CMS_ROBOTS", "LOCAL_ROBOTS")),
  },
  {
    name: "the home page is offered NOINDEX, which publish then refuses",
    apply: (d) => edit(d, PAGE_EDITOR, (s) => s.replace('!isHome || value === "INDEX"', "true")),
  },
  {
    name: "an OG image field is invented outside the write contract",
    apply: (d) =>
      edit(d, PAGE_EDITOR, (s) => s.replace("const isHome =", "const ogImageItemId = content.seo.ogImageItemId;\n  const isHome =")),
  },
  {
    name: "the reorder goes back to writing one item at a time",
    apply: (d) =>
      edit(d, ORDER_BOARD, (s) => s.replace('action="/api/gallery/order"', 'action="/api/gallery/${item.id}"')),
  },
  {
    name: "the reorder stops sending the category, so the set cannot be complete",
    apply: (d) => edit(d, ORDER_BOARD, (s) => s.replace('name="categoryId"', 'name="scope"')),
  },
  {
    name: "the request key loses the shape the endpoint accepts, so a replay reorders twice",
    apply: (d) => edit(d, ORDER_BOARD, (s) => s.replace('browserSecureId("gallery-order")', 'String(Math.random())')),
  },
  {
    name: "reordering becomes possible from the mixed-category view",
    apply: (d) => edit(d, ORDER_PAGE, (s) => s.replace("active !== null &&", "")),
  },
  {
    name: "an over-large category is ordered in part instead of refused",
    apply: (d) => edit(d, ORDER_PAGE, (s) => s.replaceAll("tooLarge", "neverTooLarge")),
  },
  {
    name: "a refusal stops saying that nothing was moved",
    apply: (d) => edit(d, ORDER_PAGE, (s) => s.replaceAll("ไม่มีรูปใดถูกย้าย", "ลองใหม่")),
  },
  {
    name: "the move controls lose their accessible names",
    apply: (d) => edit(d, ORDER_BOARD, (s) => s.replaceAll("aria-label={`เลื่อน", "title={`เลื่อน")),
  },
  {
    name: "the address inputs lose their names",
    apply: (d) => edit(d, SETTINGS_EDITOR, (s) => s.replace('className="sr-only"', 'className="hidden"')),
  },
  {
    name: "an unresolvable QR renders as a broken image instead of nothing",
    apply: (d) => edit(d, PUBLIC_PAGE, (s) => s.replace("if (!lineQr) return null;", "")),
  },
  {
    name: "a contact detail renders even when the Owner left it empty",
    apply: (d) => edit(d, PUBLIC_PAGE, (s) => s.replace("settings.contact.email &&", "true &&")),
  },
  {
    name: "a client component imports a value from a D1-backed module, breaking the browser build",
    apply: (d) =>
      edit(d, PAGE_EDITOR, (s) =>
        s.replace('} from "@/lib/site-cms-content";', '} from "@/lib/site-cms";'),
      ),
  },
];

function edit(directory, file, transform) {
  const path = join(directory, file);
  // Normalise to LF first: .ts and .tsx are unpinned in .gitattributes, so on a
  // Windows checkout every anchor written with "\n" would match nothing and each
  // case would become a silent no-op.
  const before = readFileSync(path, "utf8").split("\r\n").join("\n");
  const after = transform(before);
  if (after === before) throw new Error(`the edit to ${file} changed nothing, so the case proves nothing`);
  writeFileSync(path, after);
}

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-owner-cms-ui-"));
  for (const tree of TRACKED_TREES) cpSync(join(root, tree), join(directory, tree), { recursive: true });
  mkdirSync(join(directory, "scripts"), { recursive: true });
  return directory;
}

const runGate = (directory) =>
  spawnSync(process.execPath, [gate], { env: { ...process.env, OWNER_CMS_UI_ROOT: directory }, encoding: "utf8" });

let failures = 0;

const clean = makeCopy();
const cleanResult = runGate(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`OWNER_CMS_UI_NEGATIVE_FAIL unmodified tree was rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (runGate(directory).status === 0) {
      failures += 1;
      console.error(`OWNER_CMS_UI_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`OWNER_CMS_UI_NEGATIVE_FAIL case failed to run: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(`OWNER_CMS_UI_NEGATIVE_PASS rejections=${CASES.length} acceptances=1`);
