import { readFile, readdir, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(process.argv[2] ?? join(repo, "public-site"));
const routes = ["/", "/services/", "/motorcycle-transport/", "/international/", "/storage/", "/container-loading/", "/dealer-fleet/", "/gallery/", "/about/", "/contact/", "/quotation/"];
const routeFile = route => route === "/" ? "index.html" : `${route.slice(1)}index.html`;
const wrongDomain = ["natee", "group2025.com"].join("");
const required = [".htaccess", "404.html", "favicon.svg", "robots.txt", "sitemap.xml", "assets/site.css", "assets/site.js", "assets/gallery.json", "assets/brand/nathee-logo-display.jpg", "assets/brand/nathee-logo-display.webp", "assets/brand/nathee-logo-thumbnail.jpg", "assets/brand/nathee-logo-thumbnail.webp", "assets/contact/line-qr-owner-supplied.png", "login/index.html", "login-status.html", ...routes.map(routeFile)];

async function walk(directory) { const files = []; for (const entry of await readdir(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isSymbolicLink()) throw new Error(`Symbolic link forbidden: ${relative(root, path)}`); if (entry.isDirectory()) files.push(...await walk(path)); if (entry.isFile()) files.push(path); } return files; }
for (const name of required) if (!(await lstat(join(root, name)).catch(() => null))?.isFile()) throw new Error(`Required file missing: ${name}`);
const files = await walk(root), text = new Map();
for (const file of files) if (["", ".html", ".css", ".js", ".json", ".txt", ".xml", ".svg"].includes(extname(file).toLowerCase())) text.set(relative(root, file).replaceAll("\\", "/"), await readFile(file, "utf8"));
const forbidden = [["wrong canonical host", new RegExp(`https://${wrongDomain.replace(".", "\\.")}`, "i")], ["placeholder phone", /02-000-0000/i], ["unverified LINE", /@natheegroup/i], ["demo company", /ABC MOTOR/i], ["browser database", /nathee-quotes|window\.storage|localStorage/i], ["demo credentials", /abc123|owner123|staff123|nathee2025/i], ["unverified claims", /10\+\s*ปี|1,000\+|10,000\+/i]];
for (const [label, pattern] of forbidden) for (const [name, value] of text) if (pattern.test(value)) throw new Error(`${label} found in ${name}`);

const titles = new Set(), descriptions = new Set();
for (const route of routes) {
  const name = routeFile(route), html = text.get(name), canonical = `https://natheegroup2025.com${route}`;
  for (const token of [`<link rel="canonical" href="${canonical}">`, `<meta property="og:url" content="${canonical}">`, '<meta property="og:title"', '<meta property="og:description"', '<meta property="og:image" content="https://natheegroup2025.com/assets/brand/nathee-logo-display.jpg">', '<meta name="twitter:card" content="summary_large_image">', '<meta name="twitter:image" content="https://natheegroup2025.com/assets/brand/nathee-logo-display.jpg">', '<meta name="twitter:title"', '<meta name="twitter:description"', '<meta name="viewport" content="width=device-width, initial-scale=1">', '<script src="/assets/site.js" defer></script>']) if (!html.includes(token)) throw new Error(`${name} missing ${token}`);
  if (!/<html lang="th">/i.test(html) || (html.match(/<h1\b/gi) ?? []).length !== 1 || (html.match(/rel="canonical"/gi) ?? []).length !== 1) throw new Error(`${name} semantic page contract failed.`);
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1], description = html.match(/<meta name="description" content="([^"]+)"/i)?.[1];
  if (!title || titles.has(title)) throw new Error(`${name} title missing/duplicate.`); titles.add(title);
  if (!description || descriptions.has(description)) throw new Error(`${name} description missing/duplicate.`); descriptions.add(description);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)]; if (blocks.length !== 1) throw new Error(`${name} JSON-LD count failed.`);
  try { const parsed = JSON.parse(blocks[0][1]); if (parsed?.["@context"] !== "https://schema.org" || !parsed?.["@type"]) throw new Error(); } catch { throw new Error(`${name} JSON-LD invalid.`); }
}

const home = text.get("index.html");
for (const token of ['href="tel:0631941191"', 'href="tel:0856802082"', 'href="/quotation/"', 'href="/gallery/"', 'href="/login/"']) if (!home.includes(token)) throw new Error(`Homepage CTA missing: ${token}`);
for (const token of ['src="/assets/brand/nathee-logo-display.jpg"', 'href="/contact/#line"']) if (!home.includes(token)) throw new Error(`Homepage Owner media missing: ${token}`);
const contact = text.get("contact/index.html");
for (const token of ['id="line"', 'src="/assets/contact/line-qr-owner-supplied.png"', 'alt="QR Code LINE ที่ Owner มอบให้สำหรับติดต่อ NATHEE GROUP 2025"']) if (!contact.includes(token)) throw new Error(`Contact Owner media missing: ${token}`);
const qrBytes = await readFile(join(root, "assets/contact/line-qr-owner-supplied.png"));
if (createHash("sha256").update(qrBytes).digest("hex") !== "b2bae9fb2424bd2a316f942f56b95b75c7a767e898c778ebb241e3c952572de7") throw new Error("Owner-supplied LINE QR checksum changed.");
if (/<form\b/i.test(home) || /type=["']password["']/i.test(home)) throw new Error("Unsupported form/login fields found.");
for (const [name, html] of text) if (extname(name) === ".html") for (const image of html.matchAll(/<img\b[^>]*>/gi)) if (!/\balt=["'][^"']*["']/i.test(image[0])) throw new Error(`Image alt missing in ${name}`);
for (const name of ["login/index.html", "login-status.html", "404.html"]) if (!text.get(name).includes('<meta name="robots" content="noindex,nofollow,noarchive">')) throw new Error(`${name} noindex missing.`);

const gallery = JSON.parse(text.get("assets/gallery.json"));
const expected = ["domestic", "international", "truck-4", "truck-6", "storage", "container", "dealer-fleet", "large-batch", "truck-loading", "delivery"];
if (gallery?.version !== 1 || !Array.isArray(gallery.categories) || !Array.isArray(gallery.items)) throw new Error("Gallery manifest invalid.");
const categoryIds = new Set(gallery.categories.map(value => value.id)); for (const value of expected) if (!categoryIds.has(value)) throw new Error(`Gallery category missing: ${value}`);
const ids = new Set();
for (const item of gallery.items) {
  if (!item.id || ids.has(item.id) || item.status !== "PUBLISHED" || !categoryIds.has(item.category) || !item.title?.trim() || item.alt?.trim().length < 3 || !Number.isInteger(item.width) || item.width < 1 || !Number.isInteger(item.height) || item.height < 1) throw new Error(`Gallery item invalid: ${item.id ?? "UNKNOWN"}`); ids.add(item.id);
  for (const field of ["thumbnail", "display", "thumbnailWebp", "thumbnailAvif", "displayWebp", "displayAvif"]) if (item[field]) await assertAsset(item[field], item.id);
  for (const field of ["companyId", "customerId", "vin", "registration", "storageKey"]) if (field in item) throw new Error(`Gallery item leaks ${field}: ${item.id}`);
}
const ownerMediaIds = ["motorcycle-truck-loading-01", "motorcycle-storage-yard-01", "nathee-yard-front-01", "motorcycle-yard-container-01", "motorcycle-storage-yard-02", "motorcycle-fleet-staging-01", "nathee-six-wheel-truck-01", "motorcycle-pickup-loading-01", "motorcycle-container-loading-01"];
for (const id of ownerMediaIds) if (!ids.has(id)) throw new Error(`Owner-approved Gallery item missing: ${id}`);
if (gallery.items.length !== ownerMediaIds.length) throw new Error(`Unexpected public Gallery item count: ${gallery.items.length}`);
async function assertAsset(value, id) { if (typeof value !== "string" || !/^\/assets\/gallery\/[a-zA-Z0-9/_-]+\.(?:avif|webp|jpe?g|png)$/.test(value) || !(await lstat(join(root, value.slice(1))).catch(() => null))?.isFile()) throw new Error(`Gallery asset unsafe/missing: ${id} ${value}`); }

const robots = text.get("robots.txt"), sitemap = text.get("sitemap.xml"), htaccess = text.get(".htaccess");
for (const route of routes) if (!sitemap.includes(`<loc>https://natheegroup2025.com${route}</loc>`)) throw new Error(`Sitemap route missing: ${route}`);
if (/login-status|\/login\/|\/auth\/|\/app\/|\/api\//i.test(sitemap)) throw new Error("Sitemap contains private path.");
for (const path of ["/login/", "/login-status.html", "/auth/", "/app/", "/api/"]) if (!robots.includes(`Disallow: ${path}`)) throw new Error(`robots private path missing: ${path}`);
for (const token of ["DirectoryIndex index.html", "ErrorDocument 404 /404.html", "^www\\.natheegroup2025\\.com$", "Content-Security-Policy", "private_route"]) if (!htaccess.includes(token)) throw new Error(`.htaccess token missing: ${token}`);

for (const [name, html] of text) if (extname(name) === ".html") for (const match of html.matchAll(/(?:href|src)=["']([^"']+)["']/g)) { const ref = match[1].split("#", 1)[0]; if (!ref || /^(?:https?:|tel:|mailto:|data:)/i.test(ref)) continue; let target = ref.startsWith("/") ? resolve(root, ref.slice(1)) : resolve(root, dirname(name), ref); let info = await lstat(target).catch(() => null); if (info?.isDirectory()) { target = join(target, "index.html"); info = await lstat(target).catch(() => null); } if ((!target.startsWith(`${root}${sep}`) && target !== root) || !info?.isFile()) throw new Error(`Broken reference in ${name}: ${ref}`); }
const bytes = { home: Buffer.byteLength(home), css: Buffer.byteLength(text.get("assets/site.css")), js: Buffer.byteLength(text.get("assets/site.js")) }; const critical = bytes.home + bytes.css + bytes.js;
if (bytes.home > 45 * 1024 || bytes.css > 40 * 1024 || bytes.js > 16 * 1024 || critical > 100 * 1024) throw new Error(`Mobile byte budget exceeded ${JSON.stringify(bytes)}`);
const css = text.get("assets/site.css"); if (!css.includes("@media (max-width: 980px)") || !css.includes("@media (max-width: 680px)")) throw new Error("Responsive breakpoints missing.");

console.log(`PUBLIC_SITE_VERIFY_PASS files=${files.length} publicRoutes=${routes.length}`);
console.log(`PUBLIC_SEO_VERIFY_PASS pages=${routes.length} uniqueTitles=${titles.size} uniqueDescriptions=${descriptions.size} sitemap=public-only noindex=verified`);
console.log(`PUBLIC_GALLERY_VERIFY_PASS version=1 categories=${gallery.categories.length} publishedItems=${gallery.items.length} privateFields=blocked`);
console.log(`PUBLIC_MOBILE_PERFORMANCE_PASS criticalBytes=${critical} budget=${100 * 1024}`);
