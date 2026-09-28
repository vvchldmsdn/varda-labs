# Cutoff / contribution limited release — 2026-09-28

Base: 99da6fe725cec7d87a625a5b89ef52ea40774d14.
Reviewed ZIP SHA256: A2FACDCBAB651923792F40E2F40C82FDE56383E9709E836776974A36F948CA35.

The release contains the 90 manifest files from the reviewed bundle, two requested fixes, their regression tests, combined-suite synthetic-provider and upgrade-fixture classification corrections, and a branch-specific Preview guard.

- RC compares exact decimal products at 1.2 / 1.5. No rounding tolerance promotes values below a threshold.
- Hedge classification uses exact active non-sample ETF identity and explicit true metadata first. The existing boolean defaults to false, so false alone does not establish an unhedged product. Negative names are removed before positive matching; conflicting or uncertain names remain UNKNOWN.
- The reader's exposure flows into the portfolio FX overlay, row multiplier and saved-plan DTO. Missing news still blocks topup eligibility.
- The combined PostgreSQL fixture responds for every synthetic requested target, including fixtures created by earlier cases. No application admission guard is relaxed.
- The upgrade sentinel is classified as rehearsal-only with assertions excluding credentials, external connections and product imports. No production writer guard is weakened.
- Only codex/cutoff-release-20260928 automatic Preview is disabled. Production auto-deployment and both existing Cron schedules remain unchanged.

0060 is immutable SHA256 ca6bffb14ad55fdfb48b1313105a4ad37de34e82d728044ab2c0c07d69376a1c. Apply once after historical journal/content verification, verified private backup, upgrade/compatibility tests, and worker/tenant role checks. Apply the compatible schema before the app. Existing worker ownership/BYPASSRLS is sufficient; do not grant tenant access to shared receipts. Use one advisory-locked transaction with bounded lock/statement timeouts. Preserve ledger, revision, cancellation and completed daily records.

Recovery uses revision-aware compatible code, with paused mode if necessary. Never erase revisions, reverse the migration, or roll back to an incompatible pre-0059 reader.

Deferred: real-user topup activation, new news/performance/group/USD policy, pre-07 schedule, live-provider QA, plan purchases and new providers. Natural next-cycle success is NOT OBSERVED until actually observed. Production smoke blocks browser mutation/collection requests; local PostgreSQL and browser tests cover actual writes. External email/OAuth is not part of this release verification.

Original root/worktrees and tests/member-activity.test.mjs remain excluded. The named independent review Markdown/test were not found in available attachments; the supplied numerical and name regressions are reproduced in the existing modifier test suites.
