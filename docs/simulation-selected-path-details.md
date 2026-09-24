# Simulation selected-path details — 2026-09-20

Follow-up: private persistence is now implemented with the existing Neon tenant client; see [shared execution store evidence and release blockers](simulation-shared-execution-store.md). The process-cache/10-minute TTL description below records the original C-stage implementation and now applies only to explicit development previews. It is not the current production storage design. Shared-store rollout remains disabled pending native PostgreSQL, isolated Neon, auth and cleanup validation.

## Scope and authority

Implemented on `codex/krw-usd-foundation`, starting HEAD `59ea52a78873ec39348afedea9fe0e4afbd0d3a7`, preserving the existing KRW/USD and desktop UI changes. No economic assumptions, seeds, return inputs, allocations, price/FX queries, or simulation summary calculations were changed. No migration, provider request, commit, push or deployment was performed.

Supported: the existing owner KRW economic-state engine and stationary block-bootstrap engine rendered by `SimulationFanExplorer`, plus their development fixtures. The native currency research UI / USD basic model, comparison candidates and other chart consumers do not acquire invented states; chart consumers without an execution handle show a short unavailable message. This is not an implementation of USD economic-state calibration.

## Exact execution boundary

- `simulation-path-snapshot.ts` copies the existing render's prepared asset growth, economic states, compact chart and actual bootstrap draws. The bootstrap preparation now retains its already-generated draw plan; it does not generate another plan.
- `simulation-path-detail-store.ts` binds an opaque execution UUID to the authenticated owner and SHA-256 over model/version, currency, seed, horizon, weights, input/draw provenance, source metadata and the exact state/chart buffers. Path indices are zero-based internally and one-based in the UI.
- `/api/simulation/path-detail` accepts a bounded same-origin JSON POST. It resolves the current active owner before reading private results and rejects altered handles, other owners, invalid paths and expired entries. Query-string selectors are rejected. Development fixtures have a distinct principal and cannot be read through the preview branch in Production.
- The existing page/query paths remain authenticated. There is no new DB, provider, session or RLS bypass. Actual external authentication has not been exercised for this feature; the HTTP integration test replaces only the session resolver and store instance.
- Only a roughly 210-byte handle is added to the existing chart DTO. Prepared matrices, asset buffers, factor buffers and historical draw cubes are not serialized into the initial client payload.

## Projection and financial meaning

The response contains one path's complete steps, holdings, start/selected/end indices, final return and actual path maximum drawdown. Each holding value is `100 × initialWeight × cumulativeGrowth`. Sum reconciliation uses the existing model's summation convention and the chart's seven-significant-digit display rounding; a mismatch fails closed. There is no rescaling to conceal omitted components.

These are modeled index contributions, not current account balances. The included portion starts at 100. The existing coverage is shown, cash and excluded holdings remain outside the path, and FX already present in the KRW return input is not multiplied again. Endpoint contribution is ending holding index minus starting holding index, in percentage points of the modeled portfolio's initial 100.

Economic state inverses are explicitly allowlisted for `simulation_economic_state_conditional_mean_v1`:

| State | Stored transform | Shown unit |
|---|---|---|
| USD/KRW | natural-log level | exp(state), KRW per USD |
| US 10Y yield | level | percent |
| US 10Y–2Y spread | level | percentage points |

Unknown versions/transforms are excluded. Starting observations keep their evidence date/source; later states are labeled simulated. There are no inferred causal claims. Bootstrap shows the exact historical from/to dates, restart flag and asset return for the selected draw, with no economic factor panel.

## UI and performance

The path selector and expanded chart share state. Detail JS and the single-path request load on explicit open, not on hover. Step changes use the response already in the browser. Closing aborts an unfinished request. Responses for a different execution/path/currency/model are rejected. Escape closes the detail before the expanded chart; focus returns to the detail trigger. Korean/English labels and wrapped holding names are supported.

Hard limits: 1,000 paths, 126 steps, 64 holdings, 3 factors; response cap 512 KiB. Cache: 96 MiB retained buffers/estimated metadata, eight entries globally, two per owner, ten-minute read TTL. Snapshots are copied to prevent later mutation. Expired data is pruned on the next store operation; this is volatile process memory, not durable storage. Peak transient engine/adapter memory is additional to the retained-cache bound.

Measured deterministic test responses (UTF-8 JSON):

- Handle: bootstrap 210 bytes, economic 209 bytes.
- Three holdings, 21 steps: bootstrap 3,999 bytes; economic 5,082 bytes.
- 64 holdings, 126 steps, flat-growth stress fixture with long names: 193,916 bytes. This is a measured fixture, not a promise that every response has that size; larger responses are capped.

## Deployment limitation — do not call this Vercel-ready

The current implementation retains exact executions in a bounded Node-process cache. A restart, eviction or request sent to another process returns HTTP 410 and asks the user to refresh. **Vercel can execute the page and API on different workers, so this cache is not a reliable multi-instance production transport.** No silent replay or similar-path substitute is used.

Before production rollout, select and authorize an owner-scoped shared execution store with TTL, encryption/access policy, size limits and atomic expiry. Store the immutable completed execution there and keep the same handle/projection contract. Do not remove auth checks or send all states to the browser to work around this limitation. No shared service, table or production setting was provisioned in this task.

## Verification

- Production build (`next build --webpack`) and full ESLint completed successfully. Commands used a scrubbed environment with only a deliberately unreachable localhost database URL; no production settings were loaded. The existing owner/auth-boundary and presentation regression checks (47 tests) passed after integration.
- Final complete test run: **2,829 tests passed, 0 failed, 0 skipped** (357 suites). Full runner log and build/lint logs are retained under `output/simulation-path-detail/`. The earlier failing run is retained separately; its integration failures were fixed before this final run.
- `tests/simulation-path-detail.test.mjs`: independent numeric cases; exact real-engine chart/path equality; all holding sums; actual draw/date/restart identity; factor indexing/inverses; unknown transforms; owner/currency/model/path/TTL isolation; immutability; cache/response bounds; actual HTTP handler with session-boundary replacement, same-origin/body constraints and Production preview denial. Included in the full test runner.
- Actual local browser: 1440×900, 1366×768 and 390×844; economic and bootstrap, graph click, numeric path selection, step slider, close/focus, expand/selection persistence, Korean/English and long existing holding names. Verified no horizontal overflow in the narrow detail panel. Build/test/lint outcomes are recorded in the task completion report.

Local development URLs (deterministic samples; no login/provider/DB needed):

- `http://127.0.0.1:3198/simulation?preview=design&model=economic&horizon=63`: choose path 142, open details. End index 104.22, return +4.22%, maximum drawdown 4.88%; US yields and FX states accompany the same path.
- `http://127.0.0.1:3198/simulation?preview=design&model=bootstrap&horizon=63`: choose path 1000. End index 102.23; selected step 1 shows 2026-08-13 → 2026-08-14 as a new block and index 99.68. No economic-state panel.

Dates/values above describe the current preview fixture, not a financial forecast or production user data. The development server must be running and the current page's handle must be unexpired.

## Changed implementation boundaries

- Exact buffers and one-path projection: `src/lib/simulation-path-snapshot.ts`, `src/lib/simulation-path-detail-store.ts`, `src/lib/simulation-path-detail.ts`.
- Authenticated registration/read: `src/lib/server/simulation-path-details.ts`, `src/app/api/simulation/path-detail/route.ts`, `src/app/simulation/page.tsx`.
- Lazy panel and chart interaction: `src/components/simulation/simulation-path-detail-panel.tsx`, `simulation-path-detail.module.css`, `simulation-fan-explorer.tsx`, and the existing chart wrappers.
- Bootstrap draw retention: `src/lib/simulation-research-execution-core.ts`, `src/db/queries/simulation-owner-research.ts`; preparation returns the existing draw plan alongside the existing prepared state, without changing the draw algorithm.
