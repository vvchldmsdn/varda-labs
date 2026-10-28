# Financial calculation source

Edit the three canonical TypeScript files in `src/`. They are emitted byte for
byte into the application's `src/lib/`, where existing instrument identity,
price admission and trade event contracts resolve their relative imports.
The generated files are typechecked and used by the actual Next application.
This source package is excluded from direct application typechecking.

From the project root:

```sh
node scripts/verify-financial-domain.mjs
node scripts/verify-financial-domain.mjs --sync
node scripts/test-financial-domain-verifier.mjs
node --import tsx scripts/test-financial-movement.ts
```

Verification is read-only and fails if canonical source, generated consumer, or
manifest hashes differ. The build runs verification before Next. Sync checks all
files before writing and refuses to overwrite consumer files edited since the
last emission. Reconcile those edits into canonical source first. Do not alter
manifest hashes to bypass this protection.

Both frontend releases carry this same source package, generated calculations
and verifier. Carry the reviewed package revision to both releases, then verify
each release. No workspace path, owner identifier, database credential or live
account fixture is needed for verification or synthetic tests.

The beta frontend also tests its holding-cost DTO and partial coverage with
`node --import tsx scripts/test-current-holding-financial-read.ts`.

The current-basket comparison holds quantities constant and excludes unknown
price/FX attribution. It is separate from actual trade-adjusted portfolio change.
Missing original acquisition cost remains unknown; a verified subset must not be
presented as the complete portfolio's holding return.
