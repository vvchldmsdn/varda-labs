import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const write = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);

const [summary] = await sql.query(`
  with candidates as (
    ${candidateSelect()}
  )
  select
    count(*)::int as candidate_rows,
    count(distinct ticker)::int as instrument_count,
    min(snapshot_date)::text as first_date,
    max(snapshot_date)::text as last_date,
    count(*) filter (where valuation_mode = 'current_cycle_fixed_krw')::int as current_cycle_rows,
    count(*) filter (where valuation_mode = 'historical_backfill_carried_quantity')::int as historical_backfill_rows,
    count(*) filter (
      where abs(stored_change - corrected_change) > 0.000001
         or abs(coalesce(stored_change_pct, 0) - corrected_change_pct) > 0.000001
         or abs(coalesce(stored_price_change, 0) - corrected_price_change) > 0.000001
         or abs(coalesce(stored_fx_change, 0) - corrected_fx_change) > 0.000001
    )::int as repair_rows,
    max(abs(stored_change - corrected_change))::numeric(24, 6)::text as max_headline_correction_krw,
    max(abs(corrected_change - corrected_price_change - corrected_fx_change))::numeric(24, 6)::text as max_decomposition_residual_krw
  from candidates
`);

const samples = await sql.query(`
  with candidates as (
    ${candidateSelect()}
  )
  select
    snapshot_date::text,
    ticker,
    valuation_mode,
    stored_change::numeric(24, 2)::text as stored_change_krw,
    corrected_change::numeric(24, 2)::text as corrected_change_krw,
    corrected_price_change::numeric(24, 2)::text as corrected_price_change_krw,
    corrected_fx_change::numeric(24, 2)::text as corrected_fx_change_krw
  from candidates
  where abs(stored_change - corrected_change) > 0.000001
  order by snapshot_date desc, ticker
  limit 6
`);

const report = {
  mode: write ? "write" : "dry-run",
  ...summary,
  samples,
  status:
    Number(summary?.candidate_rows ?? 0) === 0
      ? "no_candidates"
      : Number(summary?.max_decomposition_residual_krw ?? 0) <= 0.000001
        ? "ready"
        : "blocked",
};

console.log(JSON.stringify(report, null, 2));

if (report.status === "no_candidates") process.exit(0);
if (report.status !== "ready") {
  throw new Error("Snapshot movement repair is blocked by a decomposition residual");
}
if (!write) {
  console.log("Dry run only. Re-run with --write to apply the guarded repair.");
  process.exit(0);
}

const [result] = await sql.query(`
  with candidates as (
    ${candidateSelect()}
  ), updated as (
    update daily_position_snapshots as target
    set
      market_value_change_krw = candidate.corrected_change,
      market_value_change_pct = candidate.corrected_change_pct,
      price_change_krw = candidate.corrected_price_change,
      fx_change_krw = candidate.corrected_fx_change,
      updated_at = now()
    from candidates as candidate
    where target.id = candidate.id
      and (
        abs(candidate.stored_change - candidate.corrected_change) > 0.000001
        or abs(coalesce(candidate.stored_change_pct, 0) - candidate.corrected_change_pct) > 0.000001
        or abs(coalesce(candidate.stored_price_change, 0) - candidate.corrected_price_change) > 0.000001
        or abs(coalesce(candidate.stored_fx_change, 0) - candidate.corrected_fx_change) > 0.000001
      )
    returning target.id
  )
  select count(*)::int as updated_rows from updated
`);

const [postflight] = await sql.query(`
  with candidates as (
    ${candidateSelect()}
  )
  select count(*) filter (
    where abs(stored_change - corrected_change) > 0.000001
       or abs(coalesce(stored_change_pct, 0) - corrected_change_pct) > 0.000001
       or abs(coalesce(stored_price_change, 0) - corrected_price_change) > 0.000001
       or abs(coalesce(stored_fx_change, 0) - corrected_fx_change) > 0.000001
  )::int as remaining_rows
  from candidates
`);

console.log(
  JSON.stringify(
    {
      updatedRows: result.updated_rows,
      remainingRows: postflight.remaining_rows,
      status: Number(postflight.remaining_rows) === 0 ? "complete" : "failed",
    },
    null,
    2,
  ),
);

if (Number(postflight.remaining_rows) !== 0) {
  throw new Error("Snapshot movement repair postflight failed");
}

function candidateSelect() {
  return `
    select
      calculated.*,
      case
        when upper(currency) = 'USD'
          then corrected_change - corrected_price_change
        else 0::numeric
      end as corrected_fx_change
    from (
      select
        scoped.*,
        market_value_krw - previous_market_value_krw as corrected_change,
        ((market_value_krw - previous_market_value_krw) / previous_market_value_krw) * 100 as corrected_change_pct,
        case
          when upper(currency) = 'USD'
            then movement_quantity * (current_price - previous_unit_price) * previous_fx_rate
          else market_value_krw - previous_market_value_krw
        end as corrected_price_change
      from (
        select
          position.*,
          case
            when description like '%fractional_quantity_basis=latest_prior_generated_snapshot_carry%'
              then coalesce(total_quantity, quantity)
            else quantity
          end as movement_quantity,
          case
            when description like '%fractional_quantity_basis=latest_prior_generated_snapshot_carry%'
              then 'historical_backfill_carried_quantity'
            else 'current_cycle_fixed_krw'
          end as valuation_mode,
          market_value_change_krw as stored_change,
          market_value_change_pct as stored_change_pct,
          price_change_krw as stored_price_change,
          fx_change_krw as stored_fx_change
        from daily_position_snapshots as position
        where source = 'varda_manual_daily_snapshot'
          and fractional_krw_value > 0
          and previous_market_value_krw > 0
          and current_price is not null
          and previous_unit_price is not null
          and fx_rate is not null
          and previous_fx_rate is not null
          and quantity is not null
          and upper(currency) in ('KRW', 'USD')
      ) as scoped
    ) as calculated
  `;
}

function parseArgs(argv) {
  if (argv.length === 0) return false;
  if (argv.length === 1 && argv[0] === "--write") return true;
  throw new Error(`Unknown arguments: ${argv.join(" ")}`);
}
