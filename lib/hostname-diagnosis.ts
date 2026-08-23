/**
 * What an observation of the application hostname is allowed to conclude.
 *
 * This exists because of a real misdiagnosis. An external fetcher reported
 * `502 Bad Gateway` for `app.natheegroup2025.com`, and 502 reads like an origin
 * that answered badly, which points at the application. It was not: the name has
 * no DNS record at all. A proxy that cannot resolve or connect to an upstream
 * reports 502 about *its own* upstream, and that status says nothing about
 * whether a Worker exists behind the name.
 *
 * So the order matters, and skipping a rung invents evidence:
 *
 *   authoritative DNS -> public resolvers -> TLS -> HTTP -> runtime
 *
 * A 5xx may only be called an application failure once the name resolves
 * consistently and TLS completes. Before that, a 5xx is a statement about the
 * observer, not about the runtime.
 */

export type DnsObservation = {
  /** The nameserver or resolver that was asked. */
  server: string;
  /** Records returned, empty when the name does not exist. */
  records: readonly string[];
  /** Set when the query itself failed, as opposed to returning no records. */
  error: string | null;
};

export type TlsObservation = { ok: boolean; detail: string };
export type HttpObservation = { status: number | null; detail: string };

export type HostnameEvidence = {
  hostname: string;
  /**
   * A name known to exist, resolved through the same path in the same run. A
   * probe that cannot resolve the control is a broken probe, and a broken probe
   * must not be reported as a missing record.
   */
  controlResolved: boolean;
  authoritative: readonly DnsObservation[];
  publicResolvers: readonly DnsObservation[];
  /** Null when the rung was not reached. */
  tls: TlsObservation | null;
  http: HttpObservation | null;
};

export type HostnameVerdictCode =
  | "PROBE_UNUSABLE"
  | "DNS_MISSING"
  | "DNS_PARTIAL"
  | "TLS_FAILED"
  | "HOST_UNREACHABLE"
  | "RUNTIME_FAILING"
  | "SERVING";

export type HostnameVerdict = {
  code: HostnameVerdictCode;
  summary: string;
  /**
   * Whether anything observed above may be attributed to the application. False
   * for every verdict where the name does not yet resolve everywhere, however
   * the HTTP layer answered.
   */
  runtimeDiagnosable: boolean;
  /** The single next action, so the report does not need interpreting. */
  nextAction: string;
};

const resolved = (observation: DnsObservation) => observation.error === null && observation.records.length > 0;

export function classifyHostname(evidence: HostnameEvidence): HostnameVerdict {
  const { hostname } = evidence;

  if (!evidence.controlResolved) {
    return {
      code: "PROBE_UNUSABLE",
      summary: "the control name did not resolve through this path, so no DNS result from this run means anything",
      runtimeDiagnosable: false,
      nextAction: "Re-run from a network that can resolve the control name before drawing any conclusion.",
    };
  }

  if (evidence.authoritative.length === 0) {
    return {
      code: "PROBE_UNUSABLE",
      summary: "no authoritative nameserver was queried, so the source of truth was never consulted",
      runtimeDiagnosable: false,
      nextAction: "Find the zone nameservers and query them directly.",
    };
  }

  const authoritativeHits = evidence.authoritative.filter(resolved);
  const publicHits = evidence.publicResolvers.filter(resolved);

  // The source of truth. If the record is not here it does not exist, and every
  // later rung is unreachable by definition.
  if (authoritativeHits.length === 0) {
    return {
      code: "DNS_MISSING",
      summary: `${hostname} has no record on any authoritative nameserver for the zone`,
      runtimeDiagnosable: false,
      nextAction: `Create the DNS record for ${hostname} on the zone nameservers and bind the custom hostname.`,
    };
  }

  // Present at the source but not everywhere, or not everywhere the same. Either
  // way the name is not reliably reachable yet, so nothing served or refused
  // over it describes the application.
  const authoritativeMisses = evidence.authoritative.length - authoritativeHits.length;
  const publicMisses = evidence.publicResolvers.length - publicHits.length;
  if (authoritativeMisses > 0 || evidence.publicResolvers.length === 0 || publicMisses > 0) {
    const where = authoritativeMisses > 0 ? "authoritative nameservers disagree" : "public resolvers have not caught up";
    return {
      code: "DNS_PARTIAL",
      summary: `${hostname} resolves inconsistently: ${where}`,
      runtimeDiagnosable: false,
      nextAction: "Wait for propagation, or fix the record so every nameserver agrees, then re-run.",
    };
  }

  if (!evidence.tls) {
    return {
      code: "TLS_FAILED",
      summary: `${hostname} resolves everywhere but TLS was never attempted`,
      runtimeDiagnosable: false,
      nextAction: "Attempt the TLS handshake before reading anything into an HTTP status.",
    };
  }
  if (!evidence.tls.ok) {
    return {
      code: "TLS_FAILED",
      summary: `${hostname} resolves everywhere but TLS did not complete: ${evidence.tls.detail}`,
      runtimeDiagnosable: false,
      nextAction: `Issue or bind a certificate covering ${hostname}, then re-run.`,
    };
  }

  if (!evidence.http || evidence.http.status === null) {
    return {
      code: "HOST_UNREACHABLE",
      summary: `${hostname} resolves and completes TLS but returned no HTTP status: ${evidence.http?.detail ?? "not attempted"}`,
      runtimeDiagnosable: false,
      nextAction: "Check that the runtime is bound to the hostname and listening.",
    };
  }

  // Only here has the name been proven to resolve consistently and terminate
  // TLS, which is what makes a 5xx attributable to the application at all.
  if (evidence.http.status >= 500) {
    return {
      code: "RUNTIME_FAILING",
      summary: `${hostname} resolves everywhere, completes TLS, and the application answered ${evidence.http.status}`,
      runtimeDiagnosable: true,
      nextAction: "Read the Worker logs; this is now an application failure and may be diagnosed as one.",
    };
  }

  return {
    code: "SERVING",
    summary: `${hostname} resolves everywhere, completes TLS, and answered ${evidence.http.status}`,
    runtimeDiagnosable: true,
    nextAction: "Run npm run verify:acceptance against it.",
  };
}
