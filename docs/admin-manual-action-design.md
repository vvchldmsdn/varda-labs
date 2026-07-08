# Admin Manual Action Design

Status: design contract only. Do not add buttons, Cron wiring, provider calls on
page render, or new write paths from this document alone.

This document defines the operating boundary for admin market-data actions after
`/admin/market-sync` status console v1. The current console is status-only: it
reads stored DB state and must not execute any dry-run, provider, or write route
while rendering.

## Principles

- Page load stays status-only.
- A dry-run is an explicit operator action, not automatic page behavior.
- An actual write is a separate operator action after reviewing a dry-run result.
- Actual writes require server-side admin authorization, explicit confirmation,
  and a narrow target preview.
- Do not render executable actual-write URLs in the browser.
- Do not send `ADMIN_JOB_SECRET`, KIS credentials, provider headers, raw provider
  responses, or database URLs to the browser.
- Keep price freshness and FX freshness separate. A fresh KIS price with stale
  stored FX is a partial-freshness state, not a fully fresh today-movement state.
- Show partial failures by ticker/account/date. Do not collapse them into a
  single success/failure label.

## Action Matrix

| Action | Surface | Provider call | DB write | `market_data_sync_runs` | Cooldown impact | Actual-write guard |
| --- | --- | --- | --- | --- | --- | --- |
| Status console render | `GET /admin/market-sync` | No | No | No | No | Not applicable |
| KIS live price dry-run | `POST /api/admin/market/prices/sync?provider=kis&mode=live&dryRun=true` | No provider fetch; dry-run rows only | Run metadata only | Yes | Yes | Not applicable |
| KIS live price write | `POST /api/admin/market/prices/sync?provider=kis&mode=live&dryRun=false` | Yes | `assets.current_price`, `assets.price_*` | Yes | Yes | `confirmWrite=true`, `limit<=5`, reviewed targets |
| FX dry-run | `POST /api/admin/market/fx/sync?dryRun=true` | Yes | No | No | No | Not applicable |
| FX write | `POST /api/admin/market/fx/sync?dryRun=false` | Yes | `fx_rates` only | No | No | `confirmWrite=true`, planned insert/update only |
| KIS close dry-run | `POST /api/admin/market/prices/sync?provider=kis&mode=close&dryRun=true` | Yes | Run metadata only | Yes | Yes | Not applicable |
| KIS close write | `POST /api/admin/market/prices/sync?provider=kis&mode=close&dryRun=false` | Yes | `asset_price_snapshots` | Yes | Yes | `confirmWrite=true`, `limit<=5`, reviewed targets |
| Daily snapshot dry-run | `POST /api/admin/snapshots/daily?dryRun=true` | No | No | No | No | Not applicable |
| Daily snapshot write | `POST /api/admin/snapshots/daily?dryRun=false` | No | `daily_position_snapshots`, `daily_portfolio_snapshots` | No | No | `confirmWrite=true`, full close coverage |
| Cron preflight | `GET /api/cron/market-cycle/preflight` | No | No | No | No | Preflight only |

Notes:

- The KIS live dry-run can show `skipped` rows because it intentionally avoids
  provider fetches and market-data writes. Those skips are expected when the
  reason is `dry_run` and failures are zero.
- KIS close dry-run can call the KIS provider and can create run metadata, so it
  must not run on page load.
- FX dry-run calls an external FX provider even though it does not write DB rows,
  so it must not run on page load.
- Daily snapshot dry-run is DB-read-only, but it can still be expensive and
  should remain explicit when exposed through an admin UI.

## Future UI States

The status console can later gain explicit action panels, but each panel must be
separate:

- `Check live prices`: dry-run only, explicit click, shows target preview,
  provider/cooldown state, and per-ticker result rows.
- `Write live prices`: disabled until a fresh dry-run result is selected and
  confirmation text is supplied.
- `Check FX`: explicit click, shows provider, pair, candidate date/value, and
  planned action.
- `Write FX`: disabled when the planned action is skip or blocked.
- `Check close coverage`: explicit click or manual preflight result, grouped by
  expected close date and ticker.
- `Write close rows`: reviewed batches only, capped at five targets.
- `Check daily snapshot`: explicit dry-run, shows `writeReady`, blockers,
  duplicate audit, and planned inserts/updates.
- `Write daily snapshot`: enabled only when the dry-run says `writeReady=true`
  for the current service date.

## Browser Output Rules

Allowed in admin-only browser output:

- sanitized status counts;
- ticker/account/date target previews;
- planned write action names;
- cooldown seconds and run status;
- source labels such as `kis`, `kis_overseas_dailyprice`, or
  `er-api_open_access`;
- non-executable parameter summaries such as `dryRun=true`.

Not allowed in browser output:

- `ADMIN_JOB_SECRET`;
- KIS app key, app secret, access token, authorization header, or raw request
  headers;
- database URLs;
- provider raw response bodies;
- executable actual-write URLs;
- prefilled `dryRun=false&confirmWrite=true` query strings.

## Promotion Gate

Before adding any action button:

1. Keep `/admin/market-sync` status-only and re-run the no-side-effect smoke.
2. Add tests for the action contract or route helper being exposed.
3. Prove the dry-run action cannot run on page render.
4. Prove actual-write controls require a selected dry-run result plus a separate
   confirmation step.
5. Re-run metadata secret audit after any route that writes
   `market_data_sync_runs`.

Until this gate is complete, continue using manual operator calls for provider
and write actions.
