import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");

const hosting = JSON.parse(await read(".openai/hosting.json"));
if (hosting.d1 !== "DB" || hosting.r2 !== "FILES") {
  throw new Error("Full application must retain D1 DB and R2 FILES bindings");
}

const deploy = await read("scripts/deploy-zcom.sh");
if (!deploy.includes('SOURCE_ROOT="$REPO_ROOT/public-site"')) throw new Error("Z.com deploy source boundary is missing");
if (!deploy.includes("DEPLOY_SCOPE=PUBLIC_STATIC_WEBSITE_ONLY")) throw new Error("Z.com deploy scope disclosure is missing");
if (!deploy.includes("FULL_APPLICATION_DEPLOYED=NO")) throw new Error("Z.com full-app non-claim is missing");

const postcheck = await read("scripts/postcheck-production.sh");
if (!postcheck.includes("fullApplication=NOT_CLAIMED")) throw new Error("Public postcheck can be mistaken for a full-app check");

const probe = await read("scripts/probe-zcom-runtime.sh");
for (const forbidden of ["/dev/fd", "rsync", "<("]) {
  if (probe.includes(forbidden)) throw new Error(`Z.com runtime probe is not portable: ${forbidden}`);
}
if (!probe.includes("ZCOM_FULL_APP_COMPATIBILITY=NOT_PROVEN")) throw new Error("Runtime probe must fail closed for application compatibility");

const productionAudit = await read("scripts/audit-production-components.sh");
for (const check of ["authentication", "adminAuthentication", "canonicalOrigin", "database", "storage"]) {
  if (!productionAudit.includes(`"${check}"`)) throw new Error(`Application runtime audit is missing ${check}`);
}

const publicLogin = await read("public-site/login/index.html");
if (!publicLogin.includes("ยังไม่เปิดรับการเข้าสู่ระบบ")) throw new Error("Static login route must remain an explicit placeholder");
if (publicLogin.includes("/api/auth/login") || /<input[^>]+type=["']password/i.test(publicLogin)) {
  throw new Error("Static public site must not expose a non-running login form");
}

const publicEntries = new Set(await readdir(join(root, "public-site")));
for (const forbidden of ["api", "app", "auth", "db", "drizzle", "worker"]) {
  if (publicEntries.has(forbidden)) throw new Error(`Runtime component leaked into public-site: ${forbidden}`);
}

const architecture = await read("docs/DEPLOYMENT_ARCHITECTURE.md");
for (const contract of [
  "PUBLIC_STATIC_LIVE",
  "LOGIN_STATIC_PLACEHOLDER",
  "FULL_APPLICATION_NOT_DEPLOYED",
  "BACKEND_API_NOT_DEPLOYED",
  "DATABASE_NOT_PRODUCTION_VERIFIED",
  "PRIVATE_SITES_RUNTIME_NOT_ACCEPTED",
  "NOTIFICATIONS_SOURCE_ONLY",
]) {
  if (!architecture.includes(contract)) throw new Error(`Deployment status contract missing: ${contract}`);
}

console.log("DEPLOYMENT_ARCHITECTURE_GUARD_PASS zcom=public-static-only fullApplication=separate-runtime-required d1=DB r2=FILES");
