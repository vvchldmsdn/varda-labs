# Cairn UI/UX convergence — 2026-10-01

## Source and scope

- Worktree: `.worktrees/first-trade-surface-fix`; branch: `codex/backend-reliability-repair`.
- Base: `a563e809cc9c89233eaf66a838e5194425a2196f` plus the uncommitted changes described here.
- No production DB writes, provider requests, migrations, push, or deployment.
- Unrelated local log files are preserved. The primary checkout is preserved.

## Challenge of the proposed simplification

The main risk was hiding necessary controls while removing visual noise. Form selects therefore retain native selection semantics; small reporting selectors use the existing accessible CairnSelect. Account navigation, chart units, and destructive/primary actions retain different roles. Selected tabs have a visible state and keyboard focus. Touch controls retain a 44px minimum. Mobile selection retains its full detail dialog. Simulation settings, path inspection, model explanations, and expand controls remain available. Target valuation evidence is collapsed rather than removed. The short timestamp editor retains seconds and milliseconds in the original writer value and offers exact editing.

## Phases and implementation

| Phase | Changes | Main implementation |
| --- | --- | --- |
| 1: functional UX | Owned Brokerage scope reaches holding creation; explicit account choice persists through reload; invalid scope does not select another account. Signed-in Plans has app navigation and Home, with no guest login prompt. Public Start/Try also use verified-session Home navigation. Public plan/tour/chart/film text, Start/Try and document titles support KO/EN. Simulation returns distinguish gain/loss/neutral. | `portfolio/holdings/new/page.tsx`, `holding-onboarding-form.tsx`, `app-navigation.tsx`, `plans/page.tsx`, `start/page.tsx`, `try/page.tsx`, `first-visit/plan-library.tsx`, `simulation-presentation.ts` |
| 2: common roles | Shared native-form select, tabs, primary/secondary/inline actions, status and disclosure patterns. Existing warm paper/ink/orange/blue tokens retained. Reporting currency uses the existing accessible dropdown. | `app/controls.css`, `reporting-currency-switch.tsx`, shared scope controls, trade/onboarding/target forms |
| 3: density | Mobile Home/Today spacing reduced while keeping values/status/details. Today selected holding is a thin row. Simulation settings collapse while paths/details remain; chart area enlarged. Unknown Sharpe is compact with its reason. Target starts with editing and current/target columns. Trade has one record-type selector and short date/time inputs. | Home/Today CSS, `simulation-fan-explorer.tsx`, simulation CSS, risk CSS, target form/view/CSS, `native-ledger-timestamp.tsx`, `native-ledger-clock.ts` |
| 4: browser QA | KO/EN at 1440×900, 1366×768, 390×844, 320×844; context, real disposable saves, chart interaction and detail dialogs. | `ui-convergence-preview.mjs`, `ui-convergence-fullapp-cases.mjs`, existing isolated full-app runner |

## Validation boundaries

Visual QA uses explicit development design fixtures and actual application components/path-detail API. Transaction/context QA uses a production Next build and actual application queries, ledger writers, ownership checks and PostgreSQL roles in a new disposable local cluster. External identity and Neon transport boundaries are replaced inside the disposable copied source; the existing rehearsal also inserts its refresh control into the copied layout to exercise RSC refresh behavior. These are not live OAuth, provider or production-data checks.

The full suite ran 3,155 tests: 3,153 passed; two failed due to a window-less component fixture and the new isolated QA writer's classification. Both were corrected, then the affected suites and related timestamp/Today/Target/Simulation tests passed: 75/75. After finding remaining public Start/Try copy, the additional public-navigation test was added and the UI-context suite passed 3/3. The full suite was not rerun solely to repeat unaffected tests. Earlier lint/type checks passed; final changed files receive focused lint and the final app build includes type checking.

Browser verification and evidence paths are recorded below after completion. Initial failed runs are retained as diagnostic evidence, not reported as passes. Dev compilation and rendering waits were corrected separately from application behavior.

## Final results

The final Next production build and its type check passed at `output/reliability-fullapp/local-wXARWz/build.log`. All 42 changed/new app source files match the built copy after removing the isolated runner's two additive refresh-control lines from layout. Hashes are recorded in `output/ui-convergence-source.json`. The source is the stated base commit plus this worktree's current uncommitted UI changes, including the final public Start/Try/film translation additions.

The final real full-app rehearsal passed 104/104 checks at `output/reliability-fullapp/local-wXARWz/report.json`. This includes 8 context and 8 buy/sell cases (KO/EN × all four viewport sizes), 8 signed-in public Start/Try cases and guest navigation, plus existing ledger/history/target, RLS and other-owner regressions. The new holding was saved through the actual UI and its owned Brokerage account/quantity were checked in the disposable DB. Buy/sell pairs were checked against ledger quantities and cash, not just success messages. Signed-in Plans screenshots were captured after actual navigation was visible.

The final visual matrix passed 64/64 screen conditions: Home, Today, Target, Structure, Risk, History, Contribution and Simulation × KO/EN × 1440/1366/390/320. Evidence is consolidated in `output/playwright/ui-convergence/final-report.json`. The initial 56 successful cases are in `preview-sH8hjI`; final simulation evidence is in `preview-q5NZqs` (KO desktop), `preview-ZrAG7f` (KO mobile), and `preview-hLINkY` (EN at all sizes). The last public-screen changes did not change these visual-matrix components and were verified separately by the final full-app build/flows.

Simulation checks include both model choices, 126→63 steps, refresh/query retention, return/index units, path selection, an actual path-detail API response, expand/close and language change on the same screen. Mobile Today checks select a holding, verify a summary no taller than 64px, open its full dialog, then close with Escape. Unknown Sharpe remains visible as a short status with its reason. No whole-page horizontal overflow was found; the risk matrix retains its intentional internal scroll.

Focused lint on final changed files and QA scripts passed. `git diff --check` passed. Representative KO desktop/mobile and EN 320px screenshots were visually inspected, including Home, Target, Risk, Simulation, Plans, Trade and Start.

| Completion boundary | Result |
| --- | --- |
| Requested UI implementation | PASS |
| KO/EN × four viewport sizes and requested local browser journeys | PASS |
| Disposable DB saves / ownership and writer regressions | PASS |
| Final production-mode compile and type checking | PASS |
| Live email/OAuth or market-provider responses | NOT RUN — unchanged external boundaries |
| Production DB changes, commit/push/deployment | NOT RUN — outside this implementation request |
