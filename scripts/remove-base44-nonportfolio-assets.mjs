import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const write = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);

const candidates = await sql.query(`
  select
    name,
    asset_type,
    account,
    quantity::text,
    current_price::text
  from assets
  where legacy_base44_id is not null
    and account = 'brokerage'
    and (
      (lower(asset_type) = 'savings' and btrim(name) = '적금')
      or
      (lower(asset_type) = 'housing_subscription' and btrim(name) = '청약')
    )
  order by asset_type
`);

const [references] = await sql.query(`
  with candidates as (
    select id, legacy_base44_id, ticker
    from assets
    where legacy_base44_id is not null
      and account = 'brokerage'
      and (
        (lower(asset_type) = 'savings' and btrim(name) = '적금')
        or
        (lower(asset_type) = 'housing_subscription' and btrim(name) = '청약')
      )
  )
  select
    (select count(*)::int from asset_group_members m
      join candidates c on c.id = m.asset_id) as group_members,
    (select count(*)::int from asset_price_snapshots p
      join candidates c on c.id = p.asset_id) as price_snapshots,
    (select count(*)::int from daily_position_snapshots p
      join candidates c
        on c.id = p.asset_id or c.legacy_base44_id = p.legacy_asset_id
    ) as position_snapshots,
    (select count(*)::int from event_ledger_entries e
      join candidates c
        on c.id = e.asset_id or c.legacy_base44_id = e.legacy_asset_id
    ) as event_rows,
    (select count(*)::int from live_price_quotes q
      join candidates c
        on c.ticker is not null and lower(c.ticker) = lower(q.ticker)
    ) as live_quotes
`);

const expected = new Set([
  "housing_subscription:청약",
  "savings:적금",
]);
const actual = new Set(
  candidates.map((candidate) => `${candidate.asset_type}:${candidate.name.trim()}`),
);
const referenceCount = Object.values(references).reduce(
  (sum, count) => sum + Number(count),
  0,
);

console.log(
  JSON.stringify(
    {
      mode: write ? "write" : "dry-run",
      candidates,
      references,
      status:
        candidates.length === 0
          ? "already_absent"
          : candidates.length === 2 && referenceCount === 0
            ? "ready"
            : "blocked",
    },
    null,
    2,
  ),
);

if (candidates.length === 0) {
  process.exit(0);
}

if (candidates.length !== 2 || !setsEqual(actual, expected)) {
  throw new Error("Cleanup target set does not match the two approved legacy assets");
}

if (referenceCount !== 0) {
  throw new Error("Cleanup is blocked because target assets have dependent rows");
}

if (!write) {
  console.log("Dry run only. Re-run with --write to delete the two approved rows.");
  process.exit(0);
}

const deleted = await sql.query(`
  with candidates as (
    select id, legacy_base44_id, ticker
    from assets
    where legacy_base44_id is not null
      and account = 'brokerage'
      and (
        (lower(asset_type) = 'savings' and btrim(name) = '적금')
        or
        (lower(asset_type) = 'housing_subscription' and btrim(name) = '청약')
      )
  ),
  blocked as (
    select 1 from asset_group_members m
      join candidates c on c.id = m.asset_id
    union all
    select 1 from asset_price_snapshots p
      join candidates c on c.id = p.asset_id
    union all
    select 1 from daily_position_snapshots p
      join candidates c
        on c.id = p.asset_id or c.legacy_base44_id = p.legacy_asset_id
    union all
    select 1 from event_ledger_entries e
      join candidates c
        on c.id = e.asset_id or c.legacy_base44_id = e.legacy_asset_id
    union all
    select 1 from live_price_quotes q
      join candidates c
        on c.ticker is not null and lower(c.ticker) = lower(q.ticker)
  ),
  deleted as (
    delete from assets a
    using candidates c
    where a.id = c.id
      and (select count(*) from candidates) = 2
      and not exists (select 1 from blocked)
    returning a.name, a.asset_type
  )
  select name, asset_type from deleted order by asset_type
`);

if (deleted.length !== 2) {
  throw new Error("Guarded cleanup did not delete the approved two-row target set");
}

console.log(
  JSON.stringify(
    {
      deleted: deleted.length,
      rows: deleted,
    },
    null,
    2,
  ),
);

function parseArgs(argv) {
  if (argv.length === 0) return false;
  if (argv.length === 1 && argv[0] === "--write") return true;
  throw new Error(`Unknown arguments: ${argv.join(" ")}`);
}

function setsEqual(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}
