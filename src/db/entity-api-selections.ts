import "server-only";

import type { AnyPgColumn } from "drizzle-orm/pg-core";

import {
  accounts,
  assetGroupMembers,
  assetGroups,
  assets,
} from "@/db/schema";
import {
  ACCOUNT_ENTITY_API_RESPONSE_KEYS,
  ASSET_ENTITY_API_RESPONSE_KEYS,
  ASSET_GROUP_ENTITY_API_RESPONSE_KEYS,
  ASSET_GROUP_MEMBER_ENTITY_API_RESPONSE_KEYS,
} from "@/lib/entity-api-contract";

type SelectionFor<Keys extends readonly string[]> = {
  [Key in Keys[number]]: AnyPgColumn;
};

export const accountEntityApiSelection = {
  id: accounts.id,
  code: accounts.code,
  name: accounts.name,
  accountType: accounts.accountType,
  currency: accounts.currency,
  isActive: accounts.isActive,
  sortOrder: accounts.sortOrder,
  createdAt: accounts.createdAt,
  updatedAt: accounts.updatedAt,
} satisfies SelectionFor<typeof ACCOUNT_ENTITY_API_RESPONSE_KEYS>;

export const assetEntityApiSelection = {
  id: assets.id,
  legacyBase44Id: assets.legacyBase44Id,
  name: assets.name,
  ticker: assets.ticker,
  assetType: assets.assetType,
  category: assets.category,
  market: assets.market,
  currency: assets.currency,
  account: assets.account,
  accountId: assets.accountId,
  quantity: assets.quantity,
  currentPrice: assets.currentPrice,
  priceSource: assets.priceSource,
  priceFetchedAt: assets.priceFetchedAt,
  priceAsOf: assets.priceAsOf,
  priceQuoteType: assets.priceQuoteType,
  priceStatus: assets.priceStatus,
  priceError: assets.priceError,
  averageCost: assets.averageCost,
  targetWeight: assets.targetWeight,
  groupId: assets.groupId,
  memo: assets.memo,
  description: assets.description,
  maAssetClass: assets.maAssetClass,
  maRuleEnabled: assets.maRuleEnabled,
  ma120: assets.ma120,
  daysAboveMa: assets.daysAboveMa,
  fractionalKrwValue: assets.fractionalKrwValue,
  fractionalAvgCost: assets.fractionalAvgCost,
  monthlyContribution: assets.monthlyContribution,
  contributionDay: assets.contributionDay,
  createdAt: assets.createdAt,
  updatedAt: assets.updatedAt,
} satisfies SelectionFor<typeof ASSET_ENTITY_API_RESPONSE_KEYS>;

export const assetGroupEntityApiSelection = {
  id: assetGroups.id,
  legacyBase44Id: assetGroups.legacyBase44Id,
  name: assetGroups.name,
  targetWeight: assetGroups.targetWeight,
  description: assetGroups.description,
  color: assetGroups.color,
  isActive: assetGroups.isActive,
  sortOrder: assetGroups.sortOrder,
  fxExempt: assetGroups.fxExempt,
  maExempt: assetGroups.maExempt,
  executionMode: assetGroups.executionMode,
  createdAt: assetGroups.createdAt,
  updatedAt: assetGroups.updatedAt,
} satisfies SelectionFor<typeof ASSET_GROUP_ENTITY_API_RESPONSE_KEYS>;

export const assetGroupMemberEntityApiSelection = {
  id: assetGroupMembers.id,
  groupId: assetGroupMembers.groupId,
  assetId: assetGroupMembers.assetId,
  priority: assetGroupMembers.priority,
  allocationRatio: assetGroupMembers.allocationRatio,
  sortOrder: assetGroupMembers.sortOrder,
  isActive: assetGroupMembers.isActive,
  createdAt: assetGroupMembers.createdAt,
  updatedAt: assetGroupMembers.updatedAt,
} satisfies SelectionFor<typeof ASSET_GROUP_MEMBER_ENTITY_API_RESPONSE_KEYS>;
