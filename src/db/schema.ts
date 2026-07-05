import {
  boolean,
  decimal,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const assets = pgTable("assets", {
  id: uuid("id").defaultRandom().primaryKey(),

  name: varchar("name", { length: 255 }).notNull(),
  ticker: varchar("ticker", { length: 50 }),
  assetType: varchar("asset_type", { length: 50 }).default("etf"),
  category: varchar("category", { length: 100 }),

  market: varchar("market", { length: 20 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  account: varchar("account", { length: 50 }).notNull(),

  quantity: decimal("quantity", { precision: 20, scale: 6 }).notNull(),
  currentPrice: decimal("current_price", { precision: 20, scale: 4 }).notNull(),
  averageCost: decimal("average_cost", { precision: 20, scale: 4 }),
  targetWeight: decimal("target_weight", { precision: 8, scale: 4 }),

  groupId: uuid("group_id"),
  memo: text("memo"),
  description: text("description"),

  maRuleEnabled: boolean("ma_rule_enabled").default(true),
  daysAboveMa: integer("days_above_ma").default(0),

  createdById: varchar("created_by_id", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;