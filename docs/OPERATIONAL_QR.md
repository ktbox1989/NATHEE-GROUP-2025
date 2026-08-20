# NATHEE Operational QR Contract

## Scope

The application supports five authenticated QR identities:

| Entity | Token prefix | Public identifier shape |
| --- | --- | --- |
| Motorcycle | `NATHEE:MC:` | `mc_` plus 32 lowercase hex characters |
| Transport Job | `NATHEE:JOB:` | `job_` plus 32 lowercase hex characters |
| Yard Zone | `NATHEE:YARD:` | `yard_` plus 32 lowercase hex characters |
| Truck | `NATHEE:TRUCK:` | `truck_` plus 32 lowercase hex characters |
| Trip | `NATHEE:TRIP:` | `trip_` plus 32 lowercase hex characters |

No QR payload contains VIN, engine number, registration, customer name, route,
phone number or another business field. A QR is only an opaque lookup key.

## Authorization boundary

- Every QR image endpoint requires a real authenticated application actor.
- Vehicle and Job reads are checked against the owning company for customer
  roles. An unauthorized or unknown identity returns the same `404` response.
- Yard, Truck and Trip QR records are internal-only and require the relevant
  explicit `yard:read` or `jobs:read` permission. OWNER remains business-scoped,
  not a database superuser.
- Label pages require write permission. A readable record does not by itself
  grant permission to print an operational label.
- Scanner results are read-only. Scanning never changes a status or creates a
  fake workflow success.

## Workflow evidence

QR lookup opens the existing authoritative record. Operational mutations stay
in the existing transaction-safe paths:

- Motorcycle lifecycle changes append `status_events`, actor, timestamp,
  previous/new status and Audit.
- Yard movements preserve placement history and Audit rather than rewriting a
  location.
- Trip assignment/load/unload and Trip status paths preserve assignment/status
  history and Audit.
- Job, Truck, Yard and Trip creation records the actor and Audit entry.

Location is recorded only when the real workflow supplies one (for example a
Yard Zone or Trip route); the scanner never invents device GPS/location.

## Migration 0018

`0018_unknown_blonde_phantom.sql`:

1. Adds nullable physical columns to legacy Job/Yard tables so an existing D1
   can be upgraded without a SQLite table rebuild.
2. Backfills every existing row with a random opaque identity.
3. Adds unique lookup indexes.
4. Canonicalizes pre-Production Truck/Trip public identities created by `0007`.
5. Adds insert-validation and identity-immutability triggers. These triggers
   make the application-level non-null schema fail closed even though SQLite
   cannot add a `NOT NULL` column to a populated table without rebuilding it.

Do not apply this migration to Production until a D1 backup, dry-run, row-count
comparison and rollback plan have passed. The dynamic application is not live
on the current Z.com static-only deployment.

## Acceptance

- Existing Job/Yard/Truck/Trip row counts are unchanged after upgrade.
- Every public identity matches its entity namespace, is unique and immutable.
- Public-ID lookups use their unique indexes.
- Cross-company and customer-to-internal access fail closed.
- A printed QR round-trips through the authenticated scanner without exposing
  business data in the payload.
