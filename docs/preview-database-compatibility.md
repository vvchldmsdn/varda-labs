# Preview database migration compatibility

The normal Vercel Preview build checks its integration-created Neon branch before
running Drizzle. `vercel env pull --environment=preview` can still return the
parent connection; the endpoint guard must reject that Production target. Do not
use a downloaded URL as proof of branch isolation.

Migration 0047 was applied as a CRLF artifact. Its exact timestamp and SHA-256 pair
are recorded in `preview-migration-compatibility.ts` and in the September 24 release
record. Tests reproduce both hashes from the unchanged SQL. The build accepts only
this known pair for comparison; it does not update SQL, timestamps or stored hashes.
Any other mismatch still stops the build.

The reviewed baseline is 0000–0064 (65 entries). New pending migrations are not
automatically approved. A future schema release must review its SQL and update the
baseline, catalog evidence and tests together.

The gate retains the original catalog checks and verifies the 0047 and 0064 table
columns, constraints, indexes, RLS flags, policies, grants, trigger and function
against a fixture generated from those SQL files in an isolated database.
PostgreSQL 18's separate NOT NULL constraint entries are excluded because column
nullability already covers PostgreSQL 17 and 18 identically.

Before and after the migration step, the build compares protected row counts,
content fingerprints for 12 financial/activity tables and the complete raw
migration ledger. The fingerprints are calculated inside the database; member
identities, financial rows and connection secrets are never logged. A mismatch
stops the build rather than repairing or deleting data.
