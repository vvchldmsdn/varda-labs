import { boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Public security identity reference, not holdings, quotes or ETF composition. */
export const instrumentCatalog = pgTable("instrument_catalog", {
  id: uuid("id").defaultRandom().primaryKey(),
  isin: varchar("isin", { length: 12 }).notNull(),
  ticker: varchar("ticker", { length: 50 }).notNull(),
  name: text("name").notNull(),
  market: varchar("market", { length: 20 }).notNull(),
  exchange: varchar("exchange", { length: 20 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  assetType: varchar("asset_type", { length: 10 }).notNull(),
  securityGroup: varchar("security_group", { length: 2 }).notNull(),
  source: text("source").notNull(),
  sourceSha256: varchar("source_sha256", { length: 64 }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  uniqueIndex("instrument_catalog_isin_unique").on(table.isin),
  uniqueIndex("instrument_catalog_active_identity_unique").on(table.market, table.currency, table.ticker).where(sql`${table.isActive} = true`),
  index("instrument_catalog_name_idx").on(table.name),
  check("instrument_catalog_supported", sql`${table.market} = 'korea' and ${table.currency} = 'KRW' and ${table.exchange} in ('KOSPI','KOSDAQ') and ((${table.assetType} = 'stock' and ${table.securityGroup} = 'ST') or (${table.assetType} = 'etf' and ${table.securityGroup} = 'EF'))`),
]);
