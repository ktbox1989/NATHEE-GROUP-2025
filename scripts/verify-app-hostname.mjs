#!/usr/bin/env node
// The mandatory first Production hostname gate.
//
// Nothing about the application runtime may be diagnosed until this reports
// SERVING. The evidence is gathered by scripts/probe-hostname.mjs and judged by
// lib/hostname-diagnosis.ts, which refuses to attribute any HTTP status to the
// application until the name resolves consistently and TLS completes.
//
// Usage: node scripts/verify-app-hostname.mjs [hostname]

import { classifyHostname } from "../lib/hostname-diagnosis.ts";
import { probeHostname } from "./probe-hostname.mjs";

const HOSTNAME = (process.argv[2] ?? "app.natheegroup2025.com").trim().replace(/\.$/, "");

const { evidence, notes, control } = await probeHostname(HOSTNAME);
const verdict = classifyHostname(evidence);

const describe = (entry) =>
  entry.error ? `error ${entry.error}` : entry.records.length ? entry.records.join(", ") : "no record";

console.log(`hostname   ${HOSTNAME}`);
console.log(`control    ${control}`);
console.log("");
console.log("authoritative nameservers");
if (evidence.authoritative.length === 0) console.log("  (none usable)");
for (const entry of evidence.authoritative) console.log(`  ${entry.server.padEnd(24)} ${describe(entry)}`);
console.log("public resolvers");
if (evidence.publicResolvers.length === 0) console.log("  (not reached)");
for (const entry of evidence.publicResolvers) console.log(`  ${entry.server.padEnd(24)} ${describe(entry)}`);
console.log(`TLS        ${evidence.tls ? `${evidence.tls.ok ? "ok" : "failed"} - ${evidence.tls.detail}` : "not attempted"}`);
console.log(`HTTP       ${evidence.http ? evidence.http.detail : "not attempted"}`);
for (const note of notes) console.log(`note       ${note}`);
console.log("");
console.log(`APP_HOSTNAME_${verdict.code} ${verdict.summary}`);
console.log(`runtimeDiagnosable=${verdict.runtimeDiagnosable}`);
console.log(`next: ${verdict.nextAction}`);
if (!verdict.runtimeDiagnosable) {
  console.log("Any 5xx seen elsewhere describes the observer, not this application.");
}

// Set rather than called: process.exit() while the TLS socket was still closing
// aborted the process with a libuv assertion on Windows, replacing the verdict
// with exit 127.
process.exitCode = verdict.code === "SERVING" ? 0 : 1;
