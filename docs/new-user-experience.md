# New-user experience

The first useful analysis should depend on the holdings a user has today, rather than on how long their private account history has existed.

## Registration and first analysis

- Search verified shared reference instruments by name or ticker. The current catalog covers available Korean and US ETF references and identifiable stock constituents, not every listed instrument. Manual identity entry remains available.
- Select an account, add names and quantities to a review list, and save up to 12 holdings. The first account has an editable suggested name; the first account is preselected when entering holdings.
- Purchase cost is optional. Unknown cost stays null in holdings, onboarding evidence, position snapshots and account aggregates. It cannot authorize sales or manufacture profit and loss. Current valuations remain available.
- Shared current-price evidence is reused when fresh. A cache miss may prepare one instrument through the existing provider lease and cooldown. Missing quotes are reported explicitly; no zero-valued holding is saved as a placeholder.
- Batch input is validated before writes. Each holding is committed through the owner-locked writer. Partial success is visible, and the browser retains successful rows when retrying the remaining rows. Account and group choices are locked after a successful row.
- Optional analysis groups are created or reused inside the owner transaction. Catalog selections are revalidated on the server.
- Pasted tables and CSV/TSV files are parsed locally, with size, row-count and numeric-precision limits. Each imported row must be matched to a verified instrument before entering the review list. Files are not uploaded. Cost and quantities are never inferred from valuation amounts.
- The first-look page shows current registered investment value, composition, concentration, USD-denominated weight and shared market-history readiness. It does not count account cash as invested assets or pretend that listing currency measures economic currency exposure.
- A user's current composition can enter the existing hypothetical market-stress comparison. Actual-account performance and hypothetical research remain separate. Missing current valuation must not silently shrink the research denominator.
- Market-history completion supports all eligible active owned accounts, including accounts with generated account codes. Existing rate limits and shared reference-data boundaries remain in force.

## Record authority

Registration records current holdings; it is not a historical purchase transaction. Actual private history begins with real observations. The existing 07:00 Asia/Seoul service-day snapshot contract is unchanged. Shared historical market prices can support risk and simulation without fabricating private holdings or pre-listing prices.

The nullable-cost migration only removes `NOT NULL` from `holding_onboarding_evidence.average_cost`. Existing positive-value constraints remain, and existing data is preserved.

## Production QA and follow-up

Use one dedicated test identity and normal public signup and email verification. Keep credentials and browser sessions outside tracked source. Do not create repeated test accounts or duplicate positions on each visit. Six-hour follow-ups inspect the same account, mobile and desktop registration, readiness, and the return experience. Record only meaningful changes, failures or required user action.

Public HTTP responses and design previews do not prove that authenticated Production registration works. Verify signup, email delivery, ownership, saving without cost, quote readiness and first analysis separately.

## Later increments

Screenshot OCR, native XLSX import, historical transaction reconciliation, broker connections and a persisted since-last-visit digest require separate implementation and validation. They are not represented as available by the registration UI. Reuse the review list as their confirmation boundary; ambiguous quantities, cost basis and instrument identity must remain unresolved until confirmed.
