#!/usr/bin/env node
// Where the application hostname actually stands, in the only order that can be
// reasoned about:
//
//   authoritative DNS -> public resolvers -> TLS -> HTTP -> runtime
//
// The ladder is enforced in the I/O as well as in the verdict: a later rung is
// not even attempted until the earlier one holds, so this run cannot produce an
// HTTP status that invites a conclusion the DNS evidence does not support.
//
// Every resolver proves itself on a name known to exist before its answer about
// the application hostname is believed. A resolver that cannot answer the
// control is excluded from the evidence rather than counted as a missing
// record, because a blocked resolver and an absent record look identical
// otherwise.
//
// Usage: node scripts/verify-app-hostname.mjs [hostname]

import { Resolver } from "node:dns/promises";
import { connect } from "node:tls";
import { classifyHostname } from "../lib/hostname-diagnosis.ts";

const HOSTNAME = (process.argv[2] ?? "app.natheegroup2025.com").trim().replace(/\.$/, "");
const CONTROL = HOSTNAME.split(".").slice(1).join(".");
const PUBLIC_RESOLVERS = ["8.8.8.8", "1.1.1.1", "9.9.9.9", "208.67.222.222"];
const DNS_TIMEOUT_MS = 5000;
const TLS_TIMEOUT_MS = 10000;
const HTTP_TIMEOUT_MS = 15000;

const notes = [];

function resolverFor(servers) {
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
  resolver.setServers(servers);
  return resolver;
}

/** A record of any kind counts; a CNAME to a Sites runtime is the expected shape. */
async function lookupRecords(resolver, name) {
  const found = [];
  for (const [kind, method] of [["A", "resolve4"], ["AAAA", "resolve6"], ["CNAME", "resolveCname"]]) {
    try {
      for (const value of await resolver[method](name)) found.push(`${kind} ${value}`);
    } catch (error) {
      // ENODATA means this type is absent while others may exist, which is not
      // an error about the name. Anything else is recorded by the caller.
      if (error?.code !== "ENODATA" && error?.code !== "ENOTFOUND") throw error;
    }
  }
  return found;
}

async function observe(label, servers) {
  // The control first: an answer about the application hostname is only worth
  // recording from a resolver that has just proven it can answer at all.
  try {
    const control = await lookupRecords(resolverFor(servers), CONTROL);
    if (control.length === 0) {
      notes.push(`excluded ${label}: it returned nothing for the control name ${CONTROL}`);
      return null;
    }
  } catch (error) {
    notes.push(`excluded ${label}: the control query failed (${error?.code ?? error})`);
    return null;
  }

  try {
    return { server: label, records: await lookupRecords(resolverFor(servers), HOSTNAME), error: null };
  } catch (error) {
    return { server: label, records: [], error: String(error?.code ?? error) };
  }
}

// --- Rung 1: the zone nameservers, which are the source of truth ------------

const zoneResolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
let nameservers = [];
try {
  nameservers = await zoneResolver.resolveNs(CONTROL);
} catch (error) {
  notes.push(`could not list the nameservers for ${CONTROL}: ${error?.code ?? error}`);
}

const authoritative = [];
for (const nameserver of nameservers.sort()) {
  let addresses = [];
  try {
    addresses = await zoneResolver.resolve4(nameserver);
  } catch {
    notes.push(`excluded ${nameserver}: its own address did not resolve`);
    continue;
  }
  const observation = await observe(nameserver, addresses);
  if (observation) authoritative.push(observation);
}

// --- Rung 2: what the rest of the world sees --------------------------------

const publicResolvers = [];
const authoritativeHasRecord = authoritative.some((entry) => entry.error === null && entry.records.length > 0);
if (authoritativeHasRecord || authoritative.length > 0) {
  for (const server of PUBLIC_RESOLVERS) {
    const observation = await observe(server, [server]);
    if (observation) publicResolvers.push(observation);
  }
}

const dnsConsistent =
  authoritative.length > 0 &&
  publicResolvers.length > 0 &&
  authoritative.every((entry) => entry.error === null && entry.records.length > 0) &&
  publicResolvers.every((entry) => entry.error === null && entry.records.length > 0);

// --- Rung 3: TLS, attempted only once the name resolves everywhere ----------

let tlsObservation = null;
if (dnsConsistent) {
  tlsObservation = await new Promise((resolve) => {
    const socket = connect({ host: HOSTNAME, port: 443, servername: HOSTNAME, timeout: TLS_TIMEOUT_MS }, () => {
      const certificate = socket.getPeerCertificate();
      const detail = certificate?.subject?.CN
        ? `certificate CN ${certificate.subject.CN}, valid to ${certificate.valid_to}`
        : "handshake complete";
      const ok = socket.authorized;
      socket.destroy();
      resolve({ ok, detail: ok ? detail : `${socket.authorizationError}` });
    });
    socket.on("timeout", () => { socket.destroy(); resolve({ ok: false, detail: "handshake timed out" }); });
    socket.on("error", (error) => resolve({ ok: false, detail: String(error?.code ?? error?.message ?? error) }));
  });
}

// --- Rung 4: HTTP, attempted only once TLS completes ------------------------

let httpObservation = null;
if (tlsObservation?.ok) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(`https://${HOSTNAME}/api/health`, { redirect: "manual", signal: controller.signal });
    httpObservation = { status: response.status, detail: `/api/health answered ${response.status}` };
  } catch (error) {
    httpObservation = { status: null, detail: String(error?.cause?.code ?? error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

// --- Verdict ----------------------------------------------------------------

const verdict = classifyHostname({
  hostname: HOSTNAME,
  controlResolved: authoritative.length > 0 || publicResolvers.length > 0,
  authoritative,
  publicResolvers,
  tls: tlsObservation,
  http: httpObservation,
});

const describe = (entry) =>
  `${entry.error ? `error ${entry.error}` : entry.records.length ? entry.records.join(", ") : "no record"}`;

console.log(`hostname   ${HOSTNAME}`);
console.log(`control    ${CONTROL}`);
console.log("");
console.log("authoritative nameservers");
if (authoritative.length === 0) console.log("  (none usable)");
for (const entry of authoritative) console.log(`  ${entry.server.padEnd(24)} ${describe(entry)}`);
console.log("public resolvers");
if (publicResolvers.length === 0) console.log("  (not reached)");
for (const entry of publicResolvers) console.log(`  ${entry.server.padEnd(24)} ${describe(entry)}`);
console.log(`TLS        ${tlsObservation ? `${tlsObservation.ok ? "ok" : "failed"} - ${tlsObservation.detail}` : "not attempted"}`);
console.log(`HTTP       ${httpObservation ? httpObservation.detail : "not attempted"}`);
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
