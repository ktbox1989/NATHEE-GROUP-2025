import assert from "node:assert/strict";
import test from "node:test";
import { classifyHostname, type DnsObservation, type HostnameEvidence } from "../lib/hostname-diagnosis.ts";

const hit = (server: string): DnsObservation => ({ server, records: ["203.0.113.10"], error: null });
const miss = (server: string): DnsObservation => ({ server, records: [], error: null });
const broken = (server: string): DnsObservation => ({ server, records: [], error: "SERVFAIL" });

const AUTHORITATIVE = ["ns-a1.example", "ns-a3.example", "ns-a4.example"];
const PUBLIC = ["8.8.8.8", "1.1.1.1", "9.9.9.9"];

function evidence(overrides: Partial<HostnameEvidence> = {}): HostnameEvidence {
  return {
    hostname: "app.example.test",
    controlResolved: true,
    authoritative: AUTHORITATIVE.map(hit),
    publicResolvers: PUBLIC.map(hit),
    tls: { ok: true, detail: "handshake complete" },
    http: { status: 200, detail: "ok" },
    ...overrides,
  };
}

test("a probe that cannot resolve its own control concludes nothing", () => {
  const verdict = classifyHostname(evidence({ controlResolved: false, authoritative: AUTHORITATIVE.map(miss) }));
  assert.equal(verdict.code, "PROBE_UNUSABLE");
  assert.equal(verdict.runtimeDiagnosable, false);
});

test("a run that never asked an authoritative nameserver concludes nothing", () => {
  const verdict = classifyHostname(evidence({ authoritative: [] }));
  assert.equal(verdict.code, "PROBE_UNUSABLE");
  assert.equal(verdict.runtimeDiagnosable, false);
});

// The misdiagnosis this module exists to prevent. An external fetcher reported
// 502 for a name with no DNS record; 502 described the fetcher failing to reach
// an upstream, not an application answering badly.
test("a 502 observed while the name has no record is a DNS verdict, never a runtime one", () => {
  const verdict = classifyHostname(
    evidence({
      authoritative: AUTHORITATIVE.map(miss),
      publicResolvers: PUBLIC.map(miss),
      tls: { ok: false, detail: "could not resolve host" },
      http: { status: 502, detail: "Bad Gateway from an external fetcher" },
    }),
  );
  assert.equal(verdict.code, "DNS_MISSING");
  assert.equal(verdict.runtimeDiagnosable, false);
  assert.match(verdict.nextAction, /Create the DNS record/);
});

test("even a 200 does not rehabilitate a name that has no record", () => {
  const verdict = classifyHostname(
    evidence({ authoritative: AUTHORITATIVE.map(miss), publicResolvers: PUBLIC.map(miss), http: { status: 200, detail: "ok" } }),
  );
  assert.equal(verdict.code, "DNS_MISSING");
  assert.equal(verdict.runtimeDiagnosable, false);
});

test("a nameserver that errors is not counted as an answer", () => {
  const verdict = classifyHostname(evidence({ authoritative: AUTHORITATIVE.map(broken) }));
  assert.equal(verdict.code, "DNS_MISSING");
});

test("authoritative nameservers that disagree are reported as inconsistent, not as serving", () => {
  const verdict = classifyHostname(
    evidence({ authoritative: [hit("ns-a1.example"), miss("ns-a3.example"), hit("ns-a4.example")] }),
  );
  assert.equal(verdict.code, "DNS_PARTIAL");
  assert.equal(verdict.runtimeDiagnosable, false);
  assert.match(verdict.summary, /authoritative nameservers disagree/);
});

test("a record that has not reached every public resolver is not yet reachable", () => {
  const verdict = classifyHostname(
    evidence({ publicResolvers: [hit("8.8.8.8"), miss("1.1.1.1"), hit("9.9.9.9")] }),
  );
  assert.equal(verdict.code, "DNS_PARTIAL");
  assert.equal(verdict.runtimeDiagnosable, false);
});

test("checking no public resolver at all is not the same as agreement", () => {
  assert.equal(classifyHostname(evidence({ publicResolvers: [] })).code, "DNS_PARTIAL");
});

test("TLS is a rung of its own, and a 5xx behind a failed handshake is not the application", () => {
  const verdict = classifyHostname(
    evidence({ tls: { ok: false, detail: "certificate does not cover the hostname" }, http: { status: 503, detail: "" } }),
  );
  assert.equal(verdict.code, "TLS_FAILED");
  assert.equal(verdict.runtimeDiagnosable, false);
});

test("a name that resolves and completes TLS but returns no status is unreachable, not failing", () => {
  const verdict = classifyHostname(evidence({ http: { status: null, detail: "connection reset" } }));
  assert.equal(verdict.code, "HOST_UNREACHABLE");
  assert.equal(verdict.runtimeDiagnosable, false);
});

test("only once DNS and TLS are proven may a 5xx be called an application failure", () => {
  const verdict = classifyHostname(evidence({ http: { status: 502, detail: "Bad Gateway" } }));
  assert.equal(verdict.code, "RUNTIME_FAILING");
  assert.equal(verdict.runtimeDiagnosable, true);
});

test("a hostname that resolves, completes TLS and answers is ready for acceptance", () => {
  const verdict = classifyHostname(evidence());
  assert.equal(verdict.code, "SERVING");
  assert.equal(verdict.runtimeDiagnosable, true);
  assert.match(verdict.nextAction, /verify:acceptance/);
});

// The invariant, swept rather than sampled: whatever the HTTP layer says, the
// application may not be blamed until the name resolves consistently and TLS
// completes. Every rung below that must refuse to attribute anything.
test("nothing below a consistently resolving, TLS-terminating hostname is ever diagnosable", () => {
  const incomplete: Partial<HostnameEvidence>[] = [
    { controlResolved: false },
    { authoritative: [] },
    { authoritative: AUTHORITATIVE.map(miss), publicResolvers: PUBLIC.map(miss) },
    { authoritative: AUTHORITATIVE.map(broken) },
    { authoritative: [hit("ns-a1.example"), miss("ns-a3.example"), hit("ns-a4.example")] },
    { publicResolvers: [] },
    { publicResolvers: [hit("8.8.8.8"), miss("1.1.1.1"), hit("9.9.9.9")] },
    { publicResolvers: PUBLIC.map(broken) },
    { tls: null },
    { tls: { ok: false, detail: "expired" } },
  ];
  for (const state of incomplete) {
    for (const status of [null, 200, 301, 403, 404, 500, 502, 503, 504]) {
      const verdict = classifyHostname(evidence({ ...state, http: { status, detail: "swept" } }));
      assert.equal(
        verdict.runtimeDiagnosable,
        false,
        `${JSON.stringify(state)} with status ${status} was treated as diagnosable via ${verdict.code}`,
      );
      assert.notEqual(verdict.code, "RUNTIME_FAILING");
      assert.notEqual(verdict.code, "SERVING");
    }
  }
});
