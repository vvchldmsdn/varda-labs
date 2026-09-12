# First visit: explicit-target investment plan

Status: implemented locally; hypothesis not validated. No deployment or production database migration is included in this work.

## Journey and boundaries

- `/start`: public, indexable explanation and sample/personal entry. Unauthenticated `/` goes here; authenticated dashboard and other access failures retain their existing boundaries.
- `/try`: fictional A/B/C ETF sample. Changing inputs computes a real result. Sample state is not persisted or copied into personal input.
- `/try?mode=personal`: 1–12 named rows, current value, target, extra cash. KRW integer won only; currency conversion is not performed. Initial all-zero values are supported; current weights are then unknown, not zero.
- `/plans`: public empty shell; only its authenticated no-store API returns saved data. Restore draft, explain signup, or confirm saving after authentication. Authentication cancellation preserves the draft. Existing users can use the same flow without registering again.
- After save, show the saved plan, list, delete, and reuse actions. Actual holding registration is optional. Plan-row names seed POST instrument search; actual catalog identity and quantity require user confirmation. Account creation is still required for real holdings if none exists.

Auth navigation uses only `varda_plan_return=1`, a 24-hour SameSite=Lax cookie containing no asset data. Only a verified session can follow it to the fixed `/plans` destination. Existing provider callback allowlists remain unchanged. Email verification, OAuth, or an error can return through existing auth paths; cookies and the draft survive those paths. A failed identity link never grants plan API access. A verified but unlinked user explicitly confirms creating the existing empty app-user identity; it creates no account or asset. A new request then resolves that identity.

## Calculation authority

The public flow reuses `allocateAdditionalContribution` (`deficit_proportional_capped_v1`), the existing cash-only allocator. It does not replace the authenticated explainable rebalance policy. No new algorithm is introduced.

For entered current values Vᵢ, target fractions wᵢ and additional cash C:

1. T = ΣVᵢ + C, with Σwᵢ = 1.
2. Dᵢ = max(0, wᵢT − Vᵢ).
3. Allocate C in proportion to positive Dᵢ, capped at each deficit.
4. Existing integer-won largest-remainder/cap logic handles rounding. Any unapplied won remains cash.

No sales, market quote/FX fetches, tax, fees, tradable-unit rounding, MA120, recommendations, or return forecasts. Current overweight rows may stay overweight. Output uses the entered universe only. Internal `plan:KRW:ROWnn` allocator keys are not instrument records, tickers, or orders.

## Storage and lifecycle

Calculated personal inputs use the single browser-local `varda.investment-plan.v1` draft: version, random operation ID, normalized input and expiration. Same-input recalculation preserves the original expiration; an explicitly changed calculation or saved-plan reuse creates a new draft for up to 24 hours. An open draft screen schedules cleanup; reopening a relevant screen rejects and removes expired state. A closed browser cannot run a timer: expired bytes are removed on the next visit, never restored. Local-storage denial leaves computation usable, but authentication handoff is blocked with an explanation until temporary preservation succeeds. The user can delete temporary input from `/try?mode=personal`.

Only the last calculated input is restored; edits not yet calculated are not promised across refresh. Sample input is never placed in this key. Save confirmation is explicit for the currently signed-in account; this is important on shared devices. After confirmed save the matching draft is removed, while the server plan remains. Clearing a local draft does not delete the server plan. Account plan deletion removes the live database row; no promise is made about infrastructure backups.

`investment_plans` is separate from accounts, assets, targets, holdings and transactions. It stores `(owner_user_id, id)`, validated input JSON, engine version and creation time. Input is an immutable plan snapshot; reuse creates a new operation ID. Same ID and identical normalized input return the existing record. Changed input with the same ID returns conflict. Save/delete are owner-locked with 3-second lock and 5-second statement timeouts. Limit: 50 plans per owner; delete old plans to free space.

Migration `0045_investment_plans.sql` is additive. It includes FORCE RLS, select/insert/delete grants for `varda_tenant_app`, owner predicates, and an argument-free SECURITY DEFINER active-user predicate with fixed search path and restricted execution grant. It does not grant tenant access to the identity table. The API also derives the owner from verified server context and never accepts owner IDs. POST/DELETE require same-origin JSON, bounded bodies and exact top-level keys; read responses are private/no-store/noindex. All sensitive input travels in request bodies, not URLs or logs.

## Measurement

Existing pageviews keep query/hash stripping and exclude auth, API and OAuth paths. The dedicated event function accepts a fixed enum and passes **no properties** to Vercel. IDs used for browser-local duplicate suppression are not sent. Sample result and personal result have different event names.

| Event | Success boundary |
| --- | --- |
| entry_view | public introduction mounted |
| sample_result | valid prefilled sample rendered |
| personal_started | personal input flow mounted |
| personal_result | successful explicit personal calculation |
| signup_completed | verified user explicitly creates a new Varda app-user identity successfully; not an auth button click or existing-user login |
| plan_saved | server confirms persisted or identical-existing plan; stable request ID suppresses retry duplication in the browser session |
| first_holding_created | existing atomic writer confirms first-ever owner asset insertion, counting archived assets as prior use |

`NEXT_PUBLIC_VARDA_FUNNEL_EVENTS=1` enables custom delivery **only after confirming plan support**. Default: off. The observed team was Hobby; no plan upgrade is requested or performed. [Vercel custom-event documentation](https://vercel.com/docs/analytics/custom-events) limits custom events to Pro/Enterprise. Existing pageviews remain supported; the full staged funnel cannot currently be claimed measured. No additional paid tool is introduced.

Even when enabled, these are event counts, not exact unique-user conversion or causal evidence. Session-local dedupe does not join devices, survive cleared browser storage, or guarantee delivery after connectivity/ad-blocking/crashes. Varda account activation is distinct from provider signup, and older already-verified provider accounts can create a new Varda identity. Completion loss after server commit but before browser response can undercount. No signup success is inferred just because `/plans` is visited.

## Before deployment

1. Review and apply 0045 to a verified disposable test database; run the live Neon role/transaction checks there. PGlite validates SQL and RLS semantics but does not prove multi-session Neon concurrency or deployment credentials.
2. Use a dedicated non-production Auth tenant and test email to complete real signup/verification and social-return failure/retry. Browser API mocks validate the UI state machine only; existing session/identity tests cover code boundaries.
3. After those checks, explicitly authorize the production migration and release. This task performs neither. Confirm the custom-event entitlement before opting in; otherwise use public pageviews and qualitative user interviews.

## Local verification completed on 2026-09-12

- Full existing test runner: 2,533 tests, 340 suites, zero failures or skips (`output/first-visit-tests-final.log`). Includes allocator boundaries, draft lifetime, API validation, authentication return guards, owner isolation/RLS and first-real-asset insertion in PGlite/injected test ports.
- Full ESLint passed, excluding generated `output/**` and `.playwright-cli/**` artifacts. Production build passed with local unreachable database URLs and provider credentials disabled; no Vercel deployment or database application occurred.
- Playwright covered twelve scenarios across 1440px, 390px and 320px, plus four mobile Chromium scenarios. Public calculation uses the real UI and allocator. Authenticated/unauthenticated plan API responses are explicitly mocked for restoration, confirmation, failure/retry, expired-session, duplicate-click and deletion flows. All scenarios passed across the recorded runs; one cold/hydration timeout required an isolated rerun, so this is not a claim of a single uninterrupted browser-suite pass.
- Screenshots were inspected for the landing, sample, personal result and saved-plan states; tests assert no horizontal overflow. Evidence is under `output/playwright/first-visit/` and `output/first-visit-e2e-*.log`.
- Not verified: real email/OAuth completion, live Neon migration/role credentials or multi-session concurrency, and delivery of custom analytics events under the team's actual entitlement. No production data was accessed or changed for these checks.

## Browser feedback refinement — 2026-09-13

The sample and personal calculator are alternative entry modes, not numbered compulsory steps. A short mode navigation replaces the floating skip link. Forms use compact, rule-separated asset rows on desktop and name-plus-two-fields rows on mobile. Additional cash is the first input. Money fields display thousands separators while keeping unformatted numeric strings for the existing validator and engine; cursor editing and separator-adjacent deletion are covered by browser tests. User-facing copy omits development implementation commentary. Save-service failure appears above the result with explicit retry and return actions; it is not a fake guest session and does not bypass authentication. The isolated local server still does not connect real Auth or Neon.

Refinement validation: 28 targeted calculation/storage/auth-return/analytics tests passed, scoped ESLint passed, and browser checks cover 1440/1366/1298/390/320px. Public calculation is real; authenticated save responses in UI tests remain explicitly mocked. Local Production compilation/type checking passed with disabled provider credentials and unreachable localhost database URLs. No push, deployment, production access or migration was performed.

## Product discovery and save guidance — 2026-09-13

- `/plans` places the account/save flow beside working investment-lab and simulation charts. Guest sessions see the reason to keep an account and the actual login → review → save → reuse sequence. A development runtime whose Auth transport is disabled, confirmed by an `auth_provider_unavailable` response, shows an explicit local-preview limitation instead of a misleading retry or signup promise. Other failures retain retry actions. No connection or credentials were enabled.
- `/explore` is a separate public, noindex feature experience with a return link to `/plans`. Existing `/simulation` and `/investment-lab` authentication boundaries remain unchanged. The menu exposes the public experience without requiring a plan or account.
- Existing `InvestmentLabChartCanvas` and `ResearchFanChart` components render and handle interactions. The laboratory's synthetic comparison curves are illustrative fixture data, not measured strategy performance. The simulation uses the existing sampler on synthetic prices/FX and renders 1,000 paths at bounded 63/126-step horizons. Sample labels are explicit, and no personal input is consumed. Registering real holdings and preparing data is a separate requirement for personal research.
- `/api/public-demo` accepts only a fixed view and one of two horizons, rejects private/arbitrary parameters, and projects only chart data from fixed in-memory fixtures. The cache is bounded to three public datasets. It performs no database/auth/provider lookup, holdings write or draft access. Charts load separately from account saving; aborted requests cannot overwrite a newly selected view. Chart failures leave plan results intact. Public examples skip unrelated candidate comparison/walk-forward work without changing the sampler.
- The sample experience does not emit personal-result, signup or plan-save funnel events. Existing Analytics API/auth exclusions apply. It remains an unvalidated product hypothesis, not evidence of improved conversion.

Product-discovery validation: four public-demo tests and 67 calculation, persistence, auth-return, analytics and chart regression tests passed. Scoped ESLint and the isolated Production build passed. The final uninterrupted browser run passed all 17 desktop-project scenarios (including 1440/1366/1298/390/320px layouts), followed by one mobile Chromium product-tour scenario. Public charts and calculations used the actual local endpoints; account persistence responses remained explicitly mocked. An earlier cold development-server request timed out while a concurrent build was running; the final run completed after the build. Screenshots were inspected for desktop and mobile. Real Auth signup, live Neon persistence and production analytics delivery remain unverified. No push, deployment, production access or migration occurred.

## User interview questions

Release validation on 2026-09-13: the complete runner passed 2,537 tests across 341 suites with no failures or skips. Full ESLint (excluding local output artifacts), Production build with unreachable localhost database URLs and disabled Auth, and independent read-only release review passed. The release adds migration 0045 only; production application and live-account verification are recorded separately in release evidence.

1. Before calculating, what did you expect this tool to do—and what did you think it would not do?
2. Can you explain why one asset receives no additional money, or why the resulting weights still differ from your target?
3. After seeing your result, would saving these inputs be useful next month? What would stop you from doing so?
