import { readFile, readdir, lstat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = resolve(process.argv[2] ?? join(repositoryRoot, "public-site"));

const requiredFiles = [
  ".htaccess",
  "index.html",
  "login-status.html",
  "404.html",
  "favicon.svg",
  "robots.txt",
  "sitemap.xml",
  "assets/site.css",
  "assets/site.js",
];

const forbiddenPatterns = [
  ["wrong canonical hostname", /https:\/\/nateegroup2025\.com/i],
  ["placeholder phone", /02-000-0000/i],
  ["unverified LINE ID", /@natheegroup/i],
  ["fictional company", /ABC MOTOR/i],
  ["prototype quote store", /nathee-quotes|window\.storage|localStorage/i],
  ["demo credentials", /abc123|owner123|staff123|nathee2025/i],
  ["unverified statistics", /10\+\s*ปี|1,000\+|10,000\+/i],
  ["WordPress rewrite", /RewriteRule[^\n]*index\.php/i],
];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in public-site: ${relative(siteRoot, path)}`);
    }
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

for (const file of requiredFiles) {
  const path = join(siteRoot, file);
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile()) throw new Error(`Required public-site file is missing: ${file}`);
}

const files = await listFiles(siteRoot);
const deployableText = new Map();
for (const file of files) {
  const extension = extname(file).toLowerCase();
  if (["", ".html", ".css", ".js", ".txt", ".xml", ".svg"].includes(extension)) {
    deployableText.set(relative(siteRoot, file).replaceAll("\\", "/"), await readFile(file, "utf8"));
  }
}

for (const [label, pattern] of forbiddenPatterns) {
  for (const [file, content] of deployableText) {
    if (pattern.test(content)) throw new Error(`${label} found in ${file}`);
  }
}

const home = deployableText.get("index.html");
const htaccess = deployableText.get(".htaccess");
const robots = deployableText.get("robots.txt");
const sitemap = deployableText.get("sitemap.xml");

const homeRequirements = [
  '<link rel="canonical" href="https://natheegroup2025.com/">',
  '<meta property="og:url" content="https://natheegroup2025.com/">',
  'href="tel:0631941191"',
  'href="tel:0856802082"',
  'href="login-status.html"',
  'href="#quotation"',
  'LINE Official',
  'อยู่ระหว่างอัปเดต',
];
for (const requirement of homeRequirements) {
  if (!home.includes(requirement)) throw new Error(`Homepage contract missing: ${requirement}`);
}
if (/<form\b/i.test(home)) throw new Error("Public site must not expose a fake quotation form.");
if (/type=["']password["']/i.test(home)) throw new Error("Public site must not expose prototype login fields.");

for (const requirement of [
  "DirectoryIndex index.html",
  "ErrorDocument 404 /404.html",
  "^www\\.natheegroup2025\\.com$",
  "X-Content-Type-Options",
  "Content-Security-Policy",
  "Strict-Transport-Security",
]) {
  if (!htaccess.includes(requirement)) throw new Error(`.htaccess contract missing: ${requirement}`);
}

if (!robots.includes("https://natheegroup2025.com/sitemap.xml")) {
  throw new Error("robots.txt points to the wrong sitemap URL.");
}
if (!sitemap.includes("<loc>https://natheegroup2025.com/</loc>")) {
  throw new Error("sitemap.xml points to the wrong canonical URL.");
}

const localReferencePattern = /(?:href|src)=["']([^"']+)["']/g;
for (const [name, content] of deployableText) {
  if (extname(name) !== ".html") continue;
  for (const match of content.matchAll(localReferencePattern)) {
    const reference = match[1].split("#", 1)[0];
    if (!reference || /^(?:https?:|tel:|mailto:|data:)/i.test(reference)) continue;
    const target = resolve(siteRoot, reference);
    if (!target.startsWith(`${siteRoot}${sep}`) && target !== siteRoot) {
      throw new Error(`Reference escapes public-site in ${name}: ${reference}`);
    }
    const info = await lstat(target).catch(() => null);
    if (!info?.isFile()) throw new Error(`Broken local reference in ${name}: ${reference}`);
  }
}

console.log(`PUBLIC_SITE_VERIFY_PASS files=${files.length} textFiles=${deployableText.size}`);
