# NATHEE Print Center

## Scope

`/app/print-center` is an authenticated internal directory for opening printable
records that already exist in the operational database. It never creates a
document, invoice, amount, vehicle, job or successful status in the browser.

The current real-data surfaces are:

- Job opaque QR and all vehicle labels, in bounded batches of 48;
- individual Motorcycle opaque QR;
- the Motorcycle operational record containing Inspection, damage evidence and
  version-preserving POD history;
- Yard, Truck and Trip opaque QR;
- Trip Load Board and Container Load Manifest from their existing records.

Invoice and finance-report printouts are deliberately unavailable until their
authoritative numbering, money, approval and Audit contracts exist.

## Authorization

- The route is internal-only and requires `documents:read`.
- Every destination route repeats authorization. A directory result is not an
  access token.
- QR label actions additionally require the existing Job, Motorcycle or Yard
  write permission.
- Customer accounts cannot open the operational Print Center. Their authorized
  documents remain accessible only through customer-scoped record routes.

## Scale and search

Search is a minimum two-character, maximum 80-character prefix. Wildcards and
control characters are rejected. Each result is bounded to 50 plus one
sentinel; the UI asks for a narrower identifier instead of growing an unbounded
DOM.

Job number, registration, VIN, engine number, Yard code, Truck code, Trip number
and Container number each use their dedicated database index. The query-plan
test must fail if any of those paths becomes a table scan.

## Production gate

This route is source/build complete only. It requires the full application
runtime, confirmed Supabase identity mapping and D1 migrations through `0018`.
The current Z.com static public-site deployment does not serve `/app/print-center`.
