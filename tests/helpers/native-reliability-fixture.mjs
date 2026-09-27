import { getTableConfig } from 'drizzle-orm/pg-core';
import { importWithPorts } from './import-with-ports.mjs';

const quote = value => `"${value.replaceAll('"', '""')}"`;

/** Compact native fixtures still apply the unchanged production 0059 trigger
 * migration. Materialize its previously omitted snapshot tables from the actual
 * Drizzle column metadata; never remove a migration target or disable its guard.
 * These empty prerequisite tables are not a replacement for full-migration PG QA.
 */
export async function addNativeReliabilityFixtureTables(pg) {
  const [schema] = await importWithPorts(['src/db/schema.ts'], {});
  for (const table of [schema.accountBalanceSnapshots, schema.dailyPositionSnapshots]) {
    const { name, columns } = getTableConfig(table);
    const present = (await pg.query('select to_regclass($1) as relation', [`public.${name}`])).rows[0].relation;
    if (present) continue;
    await pg.exec(`create table ${quote(name)} (${columns.map(column => `${quote(column.name)} ${column.getSQLType()}`).join(',')})`);
  }
}
