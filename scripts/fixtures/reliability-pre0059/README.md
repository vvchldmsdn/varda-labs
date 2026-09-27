# Frozen pre-0059 application sources

These four text fixtures are byte-for-byte sources from commit
`e9dee3648db5e36616105c3659b4819e5b867365`. They are loaded only by the isolated
PostgreSQL compatibility rehearsal, never by the application or a deployment.

`manifest.json` records each original source hash. The nine shared calculation
dependencies are checked against the transpiled runtime of the same commit;
type-only additions do not change that comparison. If shared runtime behavior
changes, freeze that dependency from the old commit instead of accepting the
new hash as the old deployment. CI needs no Git history or network access.

The loader replaces only the PostgreSQL transport and the `server-only` module
marker. Real queries, mutation functions, calculations, snapshot writes and
projection code execute against a new database inside the already verified
disposable local PostgreSQL cluster. Authentication is not part of this
compatibility rehearsal and is not claimed as verified here.
