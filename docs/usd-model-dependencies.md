# USD integration: route and model dependencies

Read-only source audit at the start of phase 2, 2026-09-14, in `codex/krw-usd-foundation`. This describes the code inspected before the new owner ledger integration. It is not evidence that production data, providers or authenticated user journeys were tested. Existing work was preserved; only this document was added by the audit.

## Phase 2 local implementation, 2026-09-20

The table below is the current connection audit. The original phase 1 map that follows is historical context, not the present completion report. No external database, provider credentials, authenticated browser session, cron or deployment was used for the research changes described here.

| Existing route | Current native connection | Remaining boundary |
| --- | --- | --- |
| Home / Today | Authenticated scope → native holdings/cash evidence → currency valuation and movement engine | End-to-end behavior depends on the native ledger/snapshot work and admitted current observations. |
| History | Owner native snapshots with dated valuation and external-flow performance | Quiet-day capture and snapshot completeness are owned by the native recording pipeline. |
| Structure | Native complete composition and the existing currency risk engine using the same scoped valuation/asOf | Risk needs complete aligned market/corporate-action/FX evidence; missing risk evidence preserves composition. Matching benchmark and risk-free evidence remain unavailable. |
| Contribution | Native values, cash and dated costs into the common contribution policy | Native target-policy/MA/persistence integration is separate from this research loader. |
| Investment Lab | Actual recorded cash-inclusive Modified Dietz; actual-versus-selected-owned-instrument paths use the same external flows and the common execution core; a separate current-weight historical experiment remains labeled hypothetical | Each comparison requires its own complete actual valuations, dated FX and covered corporate-action evidence. Market history never becomes an actual personal path. |
| Simulation | Explicit historical/bootstrap research from owned input; native KRW can reuse the existing economic model after exact instrument/value/weight equivalence and zero included cash | USD economic calibration has no admitted policy. The existing security-only KRW economic model cannot represent a positive native cash balance. |

The owner research loader now uses the same validated current native valuation as the application. It selects stored KIS prices by exact market/currency/ticker after owner scope resolution, preserves KRW observations instead of returning an empty history for Korean instruments, resolves US provider listings through reviewed identity, and uses a completed New York date window. An unsupported listing or failed provider request retains KIS evidence and reports unavailable return evidence instead of dropping the holding or failing the entire view.

Historical research reads dated daily FX over its full price window. Only missing currency/date conversions request the admitted historical-FX provider path; present-day spot observations are not relabeled as historical FX. Cash is included in current weights and uses a unit currency value with an explicit no-interest assumption on the same observed historical axis. Mismatched instrument dates are still rejected rather than intersected or invented.

The existing native Structure route now passes its already scoped valuation to this loader, preserving its exact `asOf` and avoiding a second current-valuation/provider read. A `risk_only` option exits the common currency research engine after covariance/volatility calculation, before Lab or 1,000 simulation paths. The appended risk section reuses the same risk presentation without duplicating the allocation ring. Missing risk evidence cannot remove the observed base composition. This is historical risk of the current allocation including cash, not actual personal performance; Sharpe and beta remain null until matching evidence is admitted.

Native Simulation preserves the requested supported horizon (63 or 126 observations) and a validated historical end service date. The historical endpoint is separate from the actual current weights' `asOf`; it does not claim those weights existed in the past. Actual evidence stops at the last complete capture within the selected service day (07:00 Korea through the instant before the next 07:00), capped at the real `asOf`. This includes a normal delayed capture such as 07:00:01; it never synthesizes a 07:00 valuation. A value, capture or deposit from a later service day cannot extend the actual side beyond the selected window. Invalid model, horizon, future or repeated end-date selections are explicit unavailable states. Economic rejection states distinguish a missing cash component, mismatched owner values/weights, incomplete native valuation and unsupported USD calibration.

KIS raw-price admission proves identity and provenance, **not** absence of corporate actions. The stored `provider_adjusted_close_v1` metadata does not carry a verified action interval or distinguish split-only and distribution adjustment. This loader therefore preserves KIS raw bars with `corporateActions.status = unknown`; it does not manufacture `verified_no_actions`. Normalized Twelve Data prices require fresh complete action coverage, one instrument identity and valid split factors. Genuine Korean corporate-action evidence is a data contract still to supply; it is not an excuse to omit the Korean price adapter.

The counterfactual path, input validation and execution schedule now share currency-neutral arithmetic behind the unchanged legacy KRW entrypoints. The legacy default remains KODEX 200, `position_value_only`, date-only execution and original KRW fields. The native adapter has the distinct `native_portfolio_same_external_flow_v1` policy: it starts from the owner's actual holdings **and cash**, invests that initial wealth in a user-selected currently owned security, and applies the same external deposits/withdrawals at their own dated reporting-currency amounts. It uses fractional units and the first eligible admitted close; it never nets flows, assumes leverage or fabricates an execution price. Pending amounts remain reporting-currency cash or withdrawal obligations, including a latest-day deposit without a later admitted close. Hypothetical fees, taxes and reinvested dividends are excluded and disclosed; the actual path retains actual recorded cash effects.

When an admitted native close is carried to a later capture (maximum seven calendar days), the scenario converts it again with FX at that actual capture time. It does not carry an already converted price and accidentally freeze FX. The shared `selectValuationFxAt` helper gives recorded FX pairs the same historical preference for both actual and hypothetical valuation, including inverse pair identities; later backfills cannot revise a captured pair. A fully withdrawn zero ending value is valid under the native path contract, while the legacy positive-position contract remains unchanged.

Both actual performance and the same-flow comparison use the existing Modified Dietz period engine through a currency-neutral API with the explicit `observed_timestamp_modified_dietz_v1` policy. Period weight is `(ending_timestamp - flow_timestamp) / (ending_timestamp - beginning_timestamp)` and periods link geometrically. A deposit after a 07:00 capture belongs to a later observed interval; its real timestamp and service-date label are never moved. Multiple captures in one service day are valid. All included observations must be complete; an incomplete middle frame blocks the metric. This is a cash-flow-weighted estimate, not exact TWR, MWR, or a compliance claim. The legacy `modified_dietz_daily_weighted_eod_v1` default and its KRW result fields remain unchanged. Cash dividends and fees stay in actual valuation, not external capital.

Native events must occur strictly after every already recorded snapshot of each account they change, including both transfer accounts. The application checks loaded records, and the SQL writer repeats this check under the same owner mutation lock used by snapshot capture. A capture committed after the application read therefore blocks a backdated event before either transfer leg changes state. Opening validation and identical committed-operation retries retain their existing behavior. Isolated PGlite regressions exercise a peer-only snapshot and both single-account and peer-capture interleaves; rejected events leave zero phantom return, while a valid later transfer is still excluded from investment performance.

Local research verification: `tests/native-currency-research.test.mjs` executes the actual Drizzle market queries against in-memory PGlite and uses the real normalizer/research engine. Only owner-source and external-provider ports are replaced. Its cases cover exact owned KRW selection, synthetic/sample exclusion, cash inclusion, completed-market dates, canonical US target forwarding, stored and historical FX, unsupported/failed providers, mixed-owner rejection, and split normalization. `tests/native-currency-counterfactual.test.mjs` uses the real shared path/flow/return engines and checks exact intraday weighting, actual-versus-alternative cash flows, terminal pending cash, dated currency conversion, complete-frame requirements, corporate-action gaps and insolvency. Both suites are registered in the default runner; legacy path, schedule and daily Modified Dietz regressions also pass locally. This is isolated local integration evidence, not proof of external provider, authentication, cron or deployment success. Previous phase 1 logs do not cover this work.

## Original phase 1 route map (before native ledger integration)

Every real-user route below resolves the authenticated tenant before its private reads. Development previews remain separate branches; none is a substitute for owned evidence.

| Route | Real owner path and existing view | Current calculation boundary | Phase 1 USD coverage / remaining dependency |
| --- | --- | --- | --- |
| `/` | `getPortfolioDashboard` → `PortfolioDashboard`; confirmed no asset history → `listPortfolioDrafts` → `QuickHome` | `portfolio-dashboard.ts` uses `convertToKrw`, `portfolio-movement`, return summaries and `*Krw` DTOs | Saved amount-only `QuickHome` supports USD and exact saved draft links. Actual holdings dashboard remains KRW. Requires native current value, dated movement, cash and cost evidence in a currency-specific view model. |
| `/today` | `getPortfolioDashboard({demand:{surface:"today",holdingDetail}})` → `TodayMovement` | Same dashboard KRW DTO, including holding contribution, price/FX decomposition and selected holding history | No currency selection or USD DTO. Need previous valid valuation, native quantities/prices, dated FX and verified trade coverage. Do not zero premarket/weekend data by a clock condition. |
| `/history` | `getReadOnlyTenantHistoryBalance` + tenant events + `getReadOnlyTenantHistoryLiveValuation` → `HistoryView` | `buildPortfolioHistoryDisplayRows`, position comparison/detail, structure-based live overlay | Actual stored KRW records and live KRW overlay. USD requires every endpoint's native quantity/price/FX and its coverage; a saved KRW total divided by today's FX is insufficient. Cash-flow returns need a complete cash ledger. |
| `/portfolio/structure` | target-policy model + `getReadOnlyTenantPortfolioRiskForScope` → `PortfolioStructureView` | `portfolio-structure.ts` values; `buildPortfolioRiskInput` → `calculatePortfolioRisk` with `returnCurrencyMode:"krw_investor"` | No USD reporting context. Composition must use all included current values in one currency. Covariance, beta, stress and Sharpe require returns recomputed in that currency. |
| `/additional-contribution` | `getReadOnlyTenantAdditionalContributionPreviewForScope` + market context → `AdditionalContributionPageView` | `amountKrw` integer query → existing explainable contribution policy | Existing account route is KRW. The new `calculateCurrencyContribution` adapter supports currency minor units, original dated costs and FX, but is currently exposed through the separate reporting view only. |
| `/investment-lab` | scope evidence + `getReadOnlyTenantInvestmentLabCounterfactualForScope` → `InvestmentLabView`; deferred performance/detail panels | Existing actual-vs-hypothetical KRW paths, account funding/events, KODEX/VOO comparison selections | No USD route contract. Every compared path and flow must be expressed in the same reporting currency at each date; preserve the actual-vs-hypothetical distinction and its omissions. |
| `/simulation` | `getReadOnlyTenantSimulationOwnerResearch`; optional `getReadOnlyTenantSimulationOwnerEconomicResearch` → `SimulationInputReadinessView` + owner/economic execution sections | Owner-valued weights and admitted KRW investor return matrix; default model `economic`, alternative `bootstrap` | No USD reporting input. Existing model identities and prepared paths are KRW-specific; USD must be gated until a compatible return matrix/model context is available. |
| `/portfolio/reporting` | `getTrackedCurrencyEvidence(tenant,scope,currency)` → `CurrencyTrackedView` → `buildTrackedCurrencyPortfolio` | Exact native quantity/price valuation and shared currency/trade/policy engines | Owner current stock/ETF reads are real. At this audit point the DAL sets `scopeComplete:false`, `cost:null`, `history:[]`, `trades:null`; full composition/movement/plan examples are development fixture results. Do not present these missing integrations as working owner features. |
| `/portfolio/research` | owner-scoped `listPortfolioDrafts` selection → bounded shared KIS history + daily FX → `CurrencyResearchView` | `buildCurrencyResearch`, dated `reportingReturnSeries`, covariance and an explicit amount-only bootstrap policy | Owner input and composition are real. The loader does not yet attach corporate-action evidence; the engine correctly blocks ready risk/Lab/simulation without it. Successful charts currently require the admitted development fixture or a future real evidence adapter. This route is not the actual holdings ledger. |

`QuickHome` passes an exact owned draft UUID through `researchHref` to structure/Lab/simulation anchors. Development `quick-usd` uses the explicit development research preview. Other native holdings navigation retains the original routes. Neither route family should become an anonymous auth exception.

## Existing economic model semantics

### Release-candidate closure, 2026-09-20

This section records the current code contract. It does not approve or assert an admitted USD economic model, production factor vintage, live reference series, or external provider validation.

| Model | Supported input | Result identity and provenance | Remaining evidence |
| --- | --- | --- | --- |
| Existing KRW economic state | Exact owner KRW investor return matrix; native reuse additionally proves identical security values/weights and zero cash | `simulation_owner_economic_state_research_v1` / `simulation_economic_state_conditional_mean_v1`; KRW return-to-log basis; dated USD/KRW already inside training returns; calibration endpoints/count; unchanged seed `0x45434f4e`; all existing state/parameter policies | Provider vintage/version and exact publication/availability timestamps are not preserved. These fields are explicitly null/unestablished; this is conditional research, not a validated forecast. |
| USD economic state | Not admitted | A direct USD request is `unsupported_reporting_currency`; relabeling the matrix return kind, FX policy or policy ID is `unsupported_return_basis`; no prepared paths are produced | A separate USD calibration/return/factor/rate contract and validation remain required. Existing US rate factors do not by themselves admit a USD model. |
| Generic portfolio bootstrap | KRW or USD with complete same-axis native prices and dated FX | `amount_currency_research_v2`; reporting currency, price/total/mixed return basis, dated conversion-before-return policy, calibration endpoints/count, datasets, seed `20260914`, horizon, optional reference sources | No macro factor model or new interest-rate/FX forecast. Missing optional reference evidence leaves this model available. |

The connected factor DAL now preserves each stored `source`, `sourceSeriesId` and `observedAt`. The existing collector policy names Frankfurter `FRANKFURTER_USD_KRW`, FRED `DGS10` and FRED `T10Y2Y`; the result reports the rows actually read rather than replacing them with those expected names. `observedAt` is an import timestamp. The collector's release date is an observation-date admission convention, not an exact publication timestamp, and latest provider values do not establish historical vintages. Current factor outputs keep factor/period-end/release dates, source identity, and import time separately. The existing fit, factor transforms, sequential state transition and random seed are unchanged.

### Currency reference admission

`currency-reference-evidence.ts` is connected to the shared currency research engine. Its `currency_reference_exact_intervals_v1` contract validates each metric independently. Native production loaders currently supply neither reference: both KRW and USD default to unavailable optional metrics, with no rate-zero or Korean benchmark substitution.

| Reference | Required contract |
| --- | --- |
| Benchmark | Reviewed provider/dataset/version; instrument ID/name/market/symbol and native currency equal to reporting currency; explicit price or total return matching portfolio basis; exact ordered `from`/`to` intervals; observation, publication and fetch timestamps; `native_reporting_currency_only_no_conversion` FX policy |
| Risk-free | Reviewed provider/dataset/version; identity, matching currency, maturity, `realized_cash_holding_period_return` definition and `provider_interval_return_no_yield_conversion`; one cash return and all three timestamps for every exact portfolio interval |

No date intersection, missing-period fill, annual-yield-to-daily inference, total-return/price-return mixing, future publication/import, synthetic-to-owner promotion, or conversion of a KRW benchmark into a USD reference is accepted. A supplied valid reference can produce its Sharpe, beta or comparison and carries its full interval/timestamp provenance. An invalid or absent reference leaves only that metric unavailable and never changes portfolio coverage, weights or bootstrap draws. Zero benchmark variance leaves beta unavailable while retaining the observed comparison path. A mathematical zero offset inside Sharpe follows subtraction of every supplied cash holding-period return; it is not an assumed portfolio cash return.

The production legacy KRW risk read model now explicitly supplies `annualRiskFreeRate:null` and loads no fallback benchmark series. Portfolio/standalone Sharpe, annual and daily risk-free fields are null; covariance, volatility, ENB, stress and drawdown remain available under their existing contracts. The pure legacy math helper's omitted-rate convention remains compatible for existing explicitly controlled formula callers. User-facing risk copy no longer claims that the production view assumes 0%.

The connected legacy Lab pre-period optimizer had another zero-rate Sharpe path. Its owner wrapper now withholds `maximum_sharpe` candidates and returns null training Sharpe; return, volatility and drawdown objectives remain available. The pure historical optimization formulas are unchanged, and the public selection controls reflect the actually admitted candidates.

Local closure verification: the new `currency-reference-evidence.test.mjs` and `currency-model-provenance.test.mjs`, plus existing currency research, native economic admission, economic owner research, risk math, risk read-model, pre-period optimizer, native Structure UI and native currency query suites passed 80 tests across direct-import runs. TypeScript, targeted ESLint and diff checks also passed. The child-process `node --test` form was blocked by Windows `spawn EPERM` before executing cases; direct imports ran the same suites successfully. The native query suite uses in-memory PGlite and substituted external ports. This is isolated fixture/integration verification, not a live benchmark/rate dataset validation.

Authoritative files:

- [Owner economic adapter](../src/lib/simulation-owner-economic-research.ts)
- [Economic state engine](../src/lib/simulation-economic-state-model.ts)
- [KRW return matrix](../src/lib/simulation-return-matrix.ts) and [alignment](../src/lib/simulation-return-matrix-normalization.ts)
- [Owner input weights](../src/lib/simulation-owner-input-candidate.ts)
- [Economic candidate comparison](../src/lib/simulation-owner-economic-candidates.ts)
- [Economic retrospective validation](../src/lib/simulation-owner-economic-validation.ts)

The default route model is `economic`; `bootstrap` is a distinct alternative, not an extra return added to the economic path. The economic model already combines historical asset returns and economic factor changes at each simulated step.

Current model IDs:

| Layer | Existing identifier / interpretation |
| --- | --- |
| Matrix | `simulation_return_matrix_v1` or `simulation_private_owner_raw_close_return_matrix_v1`; both `krw_investor_simple_return` |
| Owner historical execution | `simulation_owner_current_composition_research_v1`; stationary bootstrap, 1,000 paths, expected block length 5, normalized buy-and-hold |
| Economic wrapper | `simulation_owner_economic_state_research_v1`; KRW simple returns transformed to log returns |
| Economic engine | `simulation_economic_state_conditional_mean_v1`; conditional factor mean, fitted global covariance, 1,000 maximum paths |
| Candidate experiment | `simulation_owner_economic_candidates_v1`; common prepared asset paths, even-path search / odd-path confirmation, no actual orders |
| Retrospective comparison | `simulation_owner_economic_validation_v1`; 90 training observations, 21 outcome observations, at most 3 endpoints; baseline is an unconditional factor model on the same training window/current weights |

Factor state is exactly:

`x = [log(KRW per USD), US 10-year yield in percent, US 10Y−2Y spread in percentage points]`.

It is not every country's policy rate, all currencies, news or a separately simulated market index. Holding price behavior is learned through each asset's returns and estimated sensitivities to these three factors. Factor rows come from stored non-sample, non-preliminary `globalMarketFactors`; the read path makes no provider calls. Each observation uses release dates strictly before the modeled state date, with a maximum 7-day age across release/factor/period-end dates. Exact availability timestamps and vintage authority are not established.

The implementation fits 45–90 aligned observations with EWMA decay 0.97. In simplified notation:

```text
y_i,t = log(1 + r_i,t^KRW)
y_i,t = alpha_i + beta_i · Δx_t + residual_i,t
Δx_(t+1) = conditional_mean(x_t) + correlated_Student_t_shock
y_i,(t+1) = alpha_i + beta_i · Δx_(t+1) + correlated_residual_shock
growth_i,(t+1) = growth_i,t × exp(y_i,(t+1))
NAV_t = Σ initial_weight_i × growth_i,t
```

The local factor mean is recomputed at every step; covariance and betas are fitted once. Factor shocks use covariance-scaled Student-t with 7 degrees of freedom; residual shocks are correlated Gaussian, independent of factor innovation. Portfolio evaluation is buy-and-hold, not daily rebalancing. Candidate comparisons reuse the identical asset growth cube, seed and horizon. Simulated-path confirmation is not temporal or production validation.

### Why USD cannot be a renamed output

The current alignment computes `unitValueKrw = nativePrice × dated USD/KRW` for USD instruments, and native KRW price for KRW instruments. Thus the training returns and fitted asset growth already contain the reporting-currency effect. Multiplying another FX path into those KRW returns counts FX twice.

USD support can be mathematically defined, but needs an explicit model contract. The minimal approach is to construct dated USD investor returns first, refit the asset response/residual model against that return matrix, and label/cache the resulting paths as USD. Keeping USD/KRW as a macro explanatory factor is possible; it must not become an additional mechanical FX multiplication for a USD-native position. A joint-path numeraire conversion is another possible model, but must use the same simulated FX state and be separately tested; dividing completed paths by a single current FX rate is not that operation.

Until that contract exists, USD economic selection must report `unsupported_reporting_currency` with a concise explanation and allow an explicitly separate supported historical model. It must not silently run KRW economic paths, silently switch to bootstrap, rename a model ID, or place KRW and USD baseline distributions side by side as if comparable.

Model/result/cache identity needs at least reporting currency, return basis, asset identities, selected scope, weights-as-of, factor units/as-of, admitted dataset versions, horizon, seed and model version. Current IDs based only on account are insufficient as persisted/cache identities for a newly generalized model. Prepared paths remain server-only.

### Risk-free and benchmark limits

The economic generator uses US 10-year yield as a factor, not as an automatically valid cash return or risk-free discount curve. Its normalized NAV and loss probabilities do not require a Sharpe ratio.

At the phase 1 audit, the legacy Structure pipeline passed `annualRiskFreeRate:0` and constructed KODEX 200/VOO benchmarks through KRW conversion. The release-candidate change above removes those unverified production defaults. Optional currency reference admission now requires dated matching evidence; the connected native production loader still supplies none, so `risk_free_evidence_not_supplied` and `matched_benchmark_not_supplied` remain the honest current default for both currencies.

## Minimum integration order

1. Resolve one authenticated analysis context: reporting currency, display time zone, locale, service date and validated scope. Keep locale independent of currency, and preserve that context through existing route navigation.
2. Finish one owner-native ledger/DAL contract before changing views. Current valuation, previous valid baseline, dated history, costs, asset trade flow and cash flow each need explicit completeness. The 07:00 Korea service boundary stays unchanged; missing evidence stays missing.
3. Add currency-aware projections at the existing Server Component route boundaries. Preserve current KRW behavior. Do not put USD numbers into `*Krw` fields. Use currency-neutral money fields or an explicit alternate view contract; retain existing chart primitives and navigation rather than route every USD user to a disconnected report page.
4. Integrate Home/Today/History/Structure composition first. Full rings/weights require complete included valuation. Dated totals may be shown without claiming investment performance; return, beta, Sharpe and risk views remain gated independently.
5. Reuse `calculateCurrencyContribution` inside the account contribution route. Keep native funds and original dated costs; absent cost prohibits sales, not a fabricated loss/profit. Pin profit currency, policy and as-of with the result; edits invalidate stale results.
6. Admit verified historical instruments and corporate actions, then wire actual-owner and saved-input historical research explicitly. Reuse the same dated currency return engine, not converted final KRW risk statistics. Keep amount-only comparisons distinct from actual holdings/flows.
7. Gate the legacy economic mode in USD until the model contract above is implemented and validated. A supported historical path is an explicit user choice, with its own model label and assumptions.

Required regression cases: KRW legacy unchanged; USD rise/KRW loss from the same evidence; missing FX/price/cash coverage; post-trade and fully sold positions; missing cost followed by cost enrichment; exact owner separation; repeated requests/refresh; same saved draft across navigation; no synthetic fixture entering owner data; no currency change of stale saved results; USD economic rejection until admitted.
