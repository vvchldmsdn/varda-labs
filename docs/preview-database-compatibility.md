# Preview database migration compatibility

The normal Vercel Preview build checks its integration-created Neon branch before
running Drizzle. `vercel env pull --environment=preview` can still return the
parent connection; the endpoint guard must reject that Production target. Do not
use a downloaded URL as proof of branch isolation.

Migrations 0047, 0057 and 0061 were applied as CRLF artifacts. Migration 0058 was
applied with mixed newlines: newline numbers 22–25 (one-based) are LF and the other
50 are CRLF. Their exact timestamps and SHA-256 pairs are recorded in
`preview-migration-compatibility.ts`. Tests reproduce every applied hash from the
unchanged SQL. The 0047 pair was already recorded in the September 24 release;
the other three were read from an actual integration-created Preview on October 29.
The build accepts only these four known artifacts for comparison; it does not
update SQL, timestamps or stored hashes. Any other mismatch still stops the build.

The reviewed baseline is 0000–0064 (65 entries). New pending migrations are not
automatically approved. A future schema release must review its SQL and update the
baseline, catalog evidence and tests together.

The gate retains the original catalog checks and verifies the 0047 and 0064 table
columns, constraints, indexes, RLS flags, policies, grants, trigger and function
against a fixture generated from those SQL files in an isolated database.
Every database query uses a read-only transaction with an explicit search path and
UTC timezone, including the Neon HTTP transport where separate calls do not share
a session. PostgreSQL 18's separate NOT NULL constraint entries are excluded because column
nullability already covers PostgreSQL 17 and 18 identically.

Before and after the migration step, the build compares protected row counts,
content fingerprints for 14 financial/activity tables and the complete raw
migration ledger. The fingerprints are calculated inside the database; member
identities, financial rows and connection secrets are never logged. A mismatch
stops the build rather than repairing or deleting data.
