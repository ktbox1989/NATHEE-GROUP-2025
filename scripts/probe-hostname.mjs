// Gathers the evidence that `lib/hostname-diagnosis.ts` classifies, in the only
// order that can be reasoned about:
//
//   authoritative DNS -> public resolvers -> TLS -> HTTP
//
// The ladder is enforced here as well as in the verdict: a later rung is not
// attempted until the earlier one holds, so a run cannot produce an HTTP status
// that invites a conclusion the DNS evidence does not support.
//
// Every resolver proves itself on a name known to exist before its answer about
// the target is believed. A resolver that cannot answer the control is excluded
// from the evidence rather than counted as a missing record, because a blocked
// resolver and an absent record look identical otherwise.

import { Resolver } from "node:dns/promises";
import { connect } from "node:tls";

const PUBLIC_RESOLVERS = ["8.8.8.8", "1.1.1.1", "9.9.9.9", "208.67.222.222"];
const DNS_TIMEOUT_MS = 5000;
const TLS_TIMEOUT_MS = 10000;
const HTTP_TIMEOUT_MS = 15000;

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

export async function probeHostname(hostname, { healthPath = "/api/health" } = {}) {
  const control = hostname.split(".").slice(1).join(".");
  const notes = [];

  async function observe(label, servers) {
    // The control first: an answer about the target is only worth recording
    // from a resolver that has just proven it can answer at all.
    try {
      if ((await lookupRecords(resolverFor(servers), control)).length === 0) {
        notes.push(`excluded ${label}: it returned nothing for the control name ${control}`);
        return null;
      }
    } catch (error) {
      notes.push(`excluded ${label}: the control query failed (${error?.code ?? error})`);
      return null;
    }
    try {
      return { server: label, records: await lookupRecords(resolverFor(servers), hostname), error: null };
    } catch (error) {
      return { server: label, records: [], error: String(error?.code ?? error) };
    }
  }

  // Rung 1: the zone nameservers, which are the source of truth.
  const zoneResolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
  let nameservers = [];
  try {
    nameservers = await zoneResolver.resolveNs(control);
  } catch (error) {
    notes.push(`could not list the nameservers for ${control}: ${error?.code ?? error}`);
  }

  const authoritative = [];
  for (const nameserver of [...nameservers].sort()) {
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

  // Rung 2: what the rest of the world sees.
  const publicResolvers = [];
  if (authoritative.length > 0) {
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

  // Rung 3: TLS, attempted only once the name resolves everywhere.
  let tls = null;
  if (dnsConsistent) {
    tls = await new Promise((resolve) => {
      const socket = connect({ host: hostname, port: 443, servername: hostname, timeout: TLS_TIMEOUT_MS }, () => {
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

  // Rung 4: HTTP, attempted only once TLS completes.
  let http = null;
  if (tls?.ok) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const response = await fetch(`https://${hostname}${healthPath}`, { redirect: "manual", signal: controller.signal });
      http = { status: response.status, detail: `${healthPath} answered ${response.status}` };
    } catch (error) {
      http = { status: null, detail: String(error?.cause?.code ?? error?.message ?? error) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    evidence: {
      hostname,
      controlResolved: authoritative.length > 0 || publicResolvers.length > 0,
      authoritative,
      publicResolvers,
      tls,
      http,
    },
    notes,
    control,
  };
}
