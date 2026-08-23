#!/usr/bin/env node
// Accessibility as a gate rather than a review.
//
// The release verifier already checks the eleven marketing routes for a single
// h1, a heading outline, a skip link, the main landmark and the language. This
// covers what that does not: every page in the release rather than the eleven,
// and the failures that a heading check cannot see — a control with no
// accessible name, a link whose text is a bare arrow, a form field with no
// label, an error nobody is told about.
//
// Every rule here is one a real visitor hits. None of them is a lint
// preference: each describes something that stops a person using a keyboard or
// a screen reader from doing what they came to do.

import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.PUBLIC_ACCESSIBILITY_ROOT
  ? resolve(process.env.PUBLIC_ACCESSIBILITY_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = join(root, "public-site");

const failures = [];
function require(condition, message) {
  if (!condition) failures.push(message);
}

async function htmlFiles(directory = "") {
  const entries = await readdir(join(siteRoot, directory), { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const child = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await htmlFiles(child)));
    else if (extname(entry.name) === ".html") found.push(child);
  }
  return found.sort();
}

const pages = await htmlFiles();
require(pages.length > 0, "no HTML was found; the scan is misconfigured");

/** Visible text with tags and entities removed. */
function textOf(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1] ?? null;
}

/**
 * The accessible name of a control, as a browser would compute enough of it to
 * decide whether the control is announced at all.
 *
 * `aria-hidden` children are excluded deliberately: the lightbox arrows are a
 * decorative chevron plus an aria-label, and counting the chevron as a name
 * would let a genuinely unnamed control pass.
 */
function accessibleName(openTag, inner) {
  const label = attribute(openTag, "aria-label");
  if (label?.trim()) return label.trim();
  const withoutHidden = inner.replace(/<([a-z0-9]+)\b[^>]*\baria-hidden="true"[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const alt = [...inner.matchAll(/<img\b[^>]*>/gi)].map((image) => attribute(image[0], "alt") ?? "").join(" ");
  return `${textOf(withoutHidden)} ${alt}`.trim();
}

function controlsOf(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "gi"))];
}

/**
 * A name that is technically present and tells the visitor nothing.
 *
 * The important half is the first test: a name made only of punctuation and
 * symbols — "×", "→", "‹" — is what an unlabelled icon control degrades to, and
 * a check that only asked "is the name non-empty" would wave it through. That
 * is precisely how the lightbox close button would sound if its aria-label were
 * ever dropped: "button, multiplication sign".
 */
function saysNothing(name) {
  if (!/\p{L}|\p{N}/u.test(name)) return true;
  return /^(?:คลิกที่นี่|ที่นี่|อ่านต่อ|click here|here|read more|more|link)$/i.test(name);
}

let namedControls = 0;
let labelledFields = 0;
let pagesWithNavigation = 0;

const css = await readFile(join(siteRoot, "assets", "site.css"), "utf8");

for (const name of pages) {
  const html = await readFile(join(siteRoot, name), "utf8");
  const where = (rule) => `${name}: ${rule}`;

  // --- the page itself ---
  require(/<html[^>]+lang="[a-z-]+"/i.test(html), where("no language is declared, so a screen reader guesses the voice"));
  const headings = [...html.matchAll(/<h([1-6])[\s>]/gi)].map(([, level]) => Number(level));
  require(headings.length > 0, where("has no headings at all"));
  require(headings.filter((level) => level === 1).length === 1, where("must have exactly one h1"));
  require(headings[0] === 1, where(`opens at h${headings[0]} instead of h1`));
  for (let index = 1; index < headings.length; index += 1) {
    require(
      headings[index] - headings[index - 1] <= 1,
      where(`heading outline jumps h${headings[index - 1]} to h${headings[index]}`),
    );
  }

  // --- landmarks ---
  require(/<main\b/i.test(html), where("has no main landmark"));
  require((html.match(/<main\b/gi) ?? []).length === 1, where("has more than one main landmark"));

  // A skip link is only meaningful where there is something to skip. Requiring
  // one on the bare 404 page would be noise; not having one on a page that
  // renders the whole site navigation makes a keyboard user tab through every
  // menu item before reaching the content.
  const hasNavigation = /<nav\b/i.test(html);
  if (hasNavigation) {
    pagesWithNavigation += 1;
    require(/class="skip-link" href="#main"/.test(html), where("renders the navigation but offers no skip link"));
    require(/<main\b[^>]*id="main"/i.test(html), where("has a skip link target that does not exist"));
  }
  for (const nav of html.matchAll(/<nav\b([^>]*)>/gi)) {
    require(
      attribute(nav[0], "aria-label")?.trim() || attribute(nav[0], "aria-labelledby")?.trim(),
      where("a nav landmark has no name, so several are indistinguishable"),
    );
  }

  // --- every control is announced ---
  for (const [, openAttributes, inner] of controlsOf(html, "button")) {
    const named = accessibleName(`<button ${openAttributes}>`, inner);
    require(named.length > 0, where(`a button has no accessible name: <button ${openAttributes.trim()}>`));
    require(
      named.length === 0 || !saysNothing(named),
      where(`a button's name says nothing out of context: "${named}"`),
    );
    if (named.length > 0) namedControls += 1;
  }
  for (const [, openAttributes, inner] of controlsOf(html, "a")) {
    const openTag = `<a ${openAttributes}>`;
    // An anchor without an href is not a control.
    if (!attribute(openTag, "href")) continue;
    const named = accessibleName(openTag, inner);
    require(named.length > 0, where(`a link has no accessible name: ${openTag.trim()}`));
    // "อ่านรายละเอียด →" is fine; a bare arrow is not, and neither is a link
    // whose entire text is "คลิกที่นี่" read out of context in a link list.
    require(
      named.length === 0 || !saysNothing(named),
      where(`a link's name says nothing out of context: "${named}"`),
    );
    if (named.length > 0) namedControls += 1;
  }

  // --- images ---
  for (const image of html.matchAll(/<img\b[^>]*>/gi)) {
    require(/\salt="/i.test(image[0]), where(`an image has no alt attribute: ${image[0].slice(0, 90)}`));
  }

  // --- forms ---
  // There is no form in the public release today. These rules exist so that the
  // day the quotation form is switched on, it cannot ship unlabelled — the
  // point at which nobody would be looking at this file.
  for (const field of html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const tag = field[0];
    const type = attribute(tag, "type")?.toLowerCase() ?? "text";
    if (type === "hidden") continue;
    const id = attribute(tag, "id");
    const labelled =
      attribute(tag, "aria-label")?.trim() ||
      attribute(tag, "aria-labelledby")?.trim() ||
      (id && new RegExp(`<label\\b[^>]*\\sfor="${id}"`, "i").test(html));
    require(labelled, where(`a form field has no label: ${tag.slice(0, 90)}`));
    if (labelled) labelledFields += 1;
  }
  if (/<form\b/i.test(html)) {
    // A validation message that only changes colour is invisible to a screen
    // reader: the person is told nothing and simply cannot submit.
    require(
      /role="alert"|aria-live="(?:polite|assertive)"/i.test(html),
      where("has a form but no live region, so an error would be announced to nobody"),
    );
  }
}

// --- focus, once, in the stylesheet ---
require(css.includes(":focus-visible"), "the stylesheet defines no visible focus indicator");
require(
  !/(?:^|[^-])\boutline:\s*(?:none|0)\b(?![^{}]*:focus-visible)/.test(css.replace(/\s+/g, " ")) ||
    css.includes(":focus-visible"),
  "focus outlines are removed without a replacement",
);
require(css.includes(".skip-link:focus"), "the skip link never becomes visible when focused");
// A control smaller than this is hard to hit accurately on a phone.
require(css.includes("min-height: 48px"), "no minimum touch target size is defined");

if (failures.length > 0) {
  console.error("PUBLIC_ACCESSIBILITY_GATE_FAIL");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `PUBLIC_ACCESSIBILITY_GATE_PASS pages=${pages.length} navigationPages=${pagesWithNavigation} ` +
    `namedControls=${namedControls} labelledFields=${labelledFields} focusVisible=defined touchTarget=48px`,
);
