# Cairn historical research domain

This is the canonical pure implementation for the original **historical/bootstrap** model and beta. Both deployments consume generated `src/lib/shared-domain` artifacts. The original economic-indicator model remains a distinct, explicitly selected model.

The domain covers candidate admission, exchange calendars, paired adjusted-close matrices, deterministic bootstrap paths, summaries and verified-window suggestions. It contains no database client, provider calls or persistence.

To change the calculation:

1. Edit this package's `src` files and add meaningful parity/edge-case tests.
2. Update `manifest.json` hashes for the reviewed change with `node packages/cairn-research-domain/update-manifest.mjs`.
3. Run `node packages/cairn-research-domain/sync.mjs`. Add `--target <other-checkout>/src/lib/shared-domain` when generating another deployment; multiple targets are supported. Independently edited consumers are rejected.
4. Run tests and `npm run prebuild`. The build verifies source and generated hashes. A deployment containing only generated artifacts verifies its pinned manifest.

`simulation-verified-window` only suggests a complete window within 30 calendar days using rows already loaded. It never changes a requested date. UI users explicitly choose the dated result when recent evidence is incomplete.
