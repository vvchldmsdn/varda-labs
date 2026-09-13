# Product-led entry

## Route and data ownership

- `/start`: real captured product tour, own-data and sample entry. Public search/share metadata only here; private routes retain noindex.
- `/demo` redirects to `/demo/home`; `/demo/[view]` allows home, today, structure, contribution, lab, simulation, history only. This is a separate public projection, not a preview/auth exception.
- `demo-portfolio.ts` adapts deterministic synthetic fixtures into existing view models. Home/today/structure/contribution share the selected sample holding universe. Risk uses the existing engine with synthetic history. Lab and simulation explicitly identify their separate research example; they are not the visitor's own analysis.
- Existing heatmap, contributions, holding drawer/history, allocation explorer, risk summary, contribution engine, lab chart and simulation fan chart render the demo. All permanent-write links are absent; conversion goes to `/try/analyze`. No demo tenant or owner rows, no provider credentials, no private API reads.
- `/api/public-demo` remains a bounded, cached, synthetic-only research endpoint. Simulation uses the unchanged sampler with 1,000 paths and 63/126 steps. Lab periods slice observed fixture records; strategy selection persists.
- `/try/analyze`: 1–12 names and approximate KRW values. Only an explicitly selected entry in a finite code catalogue determines identity/class/trading currency. Unknown names remain unknown. Shares of entered value are facts; FX exposure, forecasts, volatility and price contribution cannot be derived from amounts alone.
- The existing allocation ring renders these shares with a composition-only hint. `/try?mode=personal&from=quick` copies names/values but leaves targets and new money blank. Existing allocation drafts are preserved until the visitor explicitly calculates a new plan.

## Save and account boundary

- Quick input uses `varda.quick-portfolio.v1` localStorage, a fixed 24-hour expiry, validation on restoration and explicit clear. No names/values in URLs or telemetry. Sample data is never copied into this draft.
- `/plans` restores both draft types and keeps separate libraries; the empty allocation prompt is hidden when the quick portfolio section is active. Guest, unlinked identity, temporary auth failure and storage failure remain distinct states. User-facing copy describes the next action without internal provider/development terminology.
- Existing `/auth` verification is preserved. Allocation-plan intent still returns to `/plans`. Explicit personal-portfolio save intent returns to `/portfolio/activate`, resumes the same input, and then opens Home without account/holding/target setup. No actual holding, quantity, cost basis or trade is synthesized.
- `portfolio_drafts` stores immutable approximate input snapshots, separate from `investment_plans`, holdings and transactions. IDs make retries idempotent; a changed payload requires a new ID. Max 50 per owner, owner lock, active-user check, existing verified tenant transaction, FORCE RLS and SELECT/INSERT/DELETE only.
- Local migration `0046_portfolio_drafts.sql` adds this table and reuses `investment_plan_tenant_active()` from 0045. Migration 0046 was applied during the explicitly approved release on 2026-09-13 after verifying the production target and all 46 prior migration hashes. Catalog checks confirmed FORCE RLS, SELECT/INSERT/DELETE policies, no UPDATE permission and no direct identity-table access.
- Saved input can be reused or deleted in `/plans`; holding registration carries names/value as reference and requests actual account/instrument/quantity. Price and cost are never inferred. Registration may be deferred.

## Actual product film

`public/product-demo/` contains actual browser screenshots and two 20-second silent WebM recordings, not rendered mockups. Desktop is 1280×800 (~1.9 MB); mobile is 390×760 (~0.7 MB). Today → structure → lab → simulation, with natural scroll and no altered product UI.

`ProductFilm` keeps chart code out of the landing bundle. Desktop loads on intersection and pauses offscreen, with an explicit pause button. Mobile, reduced-motion and save-data start with a screenshot; playback requires a click. The video is muted, inline, looping and has no audio. Loading failure preserves the real screenshot. Screenshot text alternatives describe the static view.

To refresh, start an isolated local server with external DB/auth disabled, open its `/demo/today` in Playwright CLI, set viewport 1280×800 or 390×760, and warm all four routes. Run `video-start <output-file> --size <viewport>`, then `run-code --filename scripts/record-product-demo.js`, then `video-stop`. The script rejects non-local origins and uses only `/demo/` paths. Inspect recordings, trim setup/teardown and compress to WebM with FFmpeg; keep a readable 20-second sequence. Run both viewports. Never record a logged-in or real-user page.

## Measurement and validation

Existing query stripping and `/auth`, `/api`, `/oauth` analytics exclusions remain. New fixed-name steps are `demo_started`, `portfolio_input_started`, `portfolio_result_viewed`, `portfolio_saved`. No event properties; local-only dedupe IDs never leave the browser. Save is tracked after success, not on click. Custom events remain disabled unless `NEXT_PUBLIC_VARDA_FUNNEL_EVENTS=1` is explicitly enabled on a supported Vercel plan. Event counts are not deduplicated user conversion rates. This onboarding hypothesis still requires actual user observation.

Unit/integration coverage: deterministic projection, real contribution boundary cases, input/identity/expiry checks, owner-separated PGlite persistence, cross-owner and inactive-user denial, retry/conflict/limit, schema registry, no invented holding data. Browser coverage: `/start`, six demo screens, old `/try` + `/explore`, quick input and confirmation/retry flows; widths 1440/390/320 and Pixel 7, reduced-motion, media failure, overflow, and no private requests from demo. Authenticated browser save scenarios use isolated API doubles; they do not establish that a real provider signup or remote migration succeeded.

References used for implementation: [Linear demo workspace entry](https://linear.app/docs/start-guide), [video loading performance](https://web.dev/learn/performance/video-performance), [reduced motion](https://web.dev/articles/prefers-reduced-motion), [pause controls for automatic movement](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html).

### Local verification record

2026-09-13: full suite 2,557 passed (344 suites); expanded event privacy/dedupe test 9 passed; full lint clean; production build passed. Desktop browser checks: 32 across new and retained flows; Pixel 7 checks: 6 passed. Production-mode local HTTP checks: nine public/auth-entry routes 200, private APIs closed with no-store while auth is unavailable, development preview did not expose sample holdings, and unknown demo views rendered Next's streamed not-found/noindex. Existing auth-failure pages can return 200 with a closed-access notice; HTTP status alone is not proof of access. Detailed outputs remain under untracked `output/product-led-*`.

The implementation-only phase did not deploy or access a remote database. The subsequently approved release applied migration 0046 as described above. Final release verification: 2,558 tests passed in 344 suites, full lint and production build passed, and two additional browser checks verified cancellation from the actual signup screen for quick and allocation inputs. Real provider signup was not repeated; production saving is checked separately using the authorized existing QA account.

## State-based activation (2026-09-13)

- Entry: `/start` → `/demo/home` or `/try/analyze` → personal composition → save intent → `/auth/sign-up` or sign-in → `/portfolio/activate` → `/`.
- Direct signup: `/auth/session` → `/portfolio/onboarding`. Existing owned holdings or saved amount inputs return to Home; only an empty verified account receives the one-row quick input. Accounts and target weights are not prerequisites.
- Home reads the latest owned approximate input only when there are no actual investment or non-investment assets in the all-assets view. Existing real dashboards are preserved; newly saved input is linked from a small success notice. Amounts are explicitly dated input values, never live valuations. Existing inputs are reused when editing or adding missing holding details; an unchanged saved input retains its ID.
- `varda.portfolio-activation.v1` is an explicit save intent referencing the current 24-hour personal draft. It is bound to a non-secret hash of the verified session identity before writing. Changing accounts stops automatic saving and requires review. Cancellation removes intent but keeps inputs. A different draft or expired draft cannot be resumed. These browser values never establish ownership.
- `/api/portfolio-activation`: no-store, noindex, bounded same-origin JSON POST; verified session and resolved tenant ownership on every request. New unmapped identities use the existing atomic empty-tenant writer, then a separate request re-resolves ownership before the unchanged RLS-protected draft writer runs. Retry IDs are stable; inactive/conflicting identities are blocked. No schema/migration changes.
- Only successful creation emits the existing fixed signup-completion event; portfolio save emits after confirmed commit. Account keys, asset names and values are not sent to analytics. Event delivery can be incomplete and is not an exact conversion-rate denominator.
- Progressive enrichment: Home links to target-weight allocation and existing holding entry. If a real custody account is later needed, the creation link goes to `/portfolio/accounts`, not the activation route. Browser storage failure keeps the server copy accessible in My records.
- Reduced copy: one heading/one optional line; input retention, classification and calculation limitations are collapsed. Begin with one input row and explicit Add asset (auto-inserting on blur moved the submit button and lost clicks in browser testing).
- Development-only `/?preview=quick` renders the real amount-Home component with fixed dummy input; its reuse links do not copy that fixture. Onboarding preview cannot save. Production continues to resolve ownership and ignores these preview values.

Validation evidence for this revision lives in `output/playwright/activation/`. Browser checks combine live public UI, local real components, external-auth/API doubles for continuity, and separate real route/writer tests with isolated PGlite. A new provider email signup and remote PostgreSQL concurrent requests are not claimed as verified by those doubles. No deployment or production data mutation is part of this revision.

Revision verification: 2,568 tests passed in 347 suites; after the final cash-only Home guard correction, all 10 activation/routing tests passed again. Lint passed with only untracked browser-output directories excluded. Production build and TypeScript passed with external credentials disabled. Local production HTTP checks passed for five public entry routes; both private activation/draft APIs remained closed with no-store when authentication was unavailable, and the development-only Home fixture was not exposed.

Playwright exercised desktop 1440/1366 and mobile 390/320 layouts, plus a touch-enabled mobile context. Verified personal two-asset input, commas, invalid input, catalog selection, result interaction, refresh, signup cancellation, Demo-to-empty-personal-input, reduced motion, no horizontal overflow, save failure/retry, and account-switch blocking before any POST. Auth completion/save continuity used explicit doubles; production signup was inspected but no fresh provider account was created. Screenshots were visually reviewed. Existing QA-account Home access was read-only. No production writes, commit, push or deployment were performed.
