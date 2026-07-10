import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { assetEntityApiSelection } from "@/db/entity-api-selections";
import { assets } from "@/db/schema";
import { requireAdminJob } from "@/lib/api-guards";

const optionalText = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return value;
}, z.string().nullable().optional());

const optionalRequiredText = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value.trim();
  return value;
}, z.string().min(1).optional());

const updateDecimalString = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  return value;
}, z.string().regex(/^\d+(\.\d+)?$/).optional());

const optionalDecimalString = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  return value;
}, z.string().regex(/^\d+(\.\d+)?$/).nullable().optional());

const optionalBoolean = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

const optionalInteger = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return Number(value);
}, z.number().int().nonnegative().nullable().optional());

const optionalUuid = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string") return value.trim();
  return value;
}, z.string().uuid().nullable().optional());

const optionalBase44Id = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string") return value.trim();
  return value;
}, z.string().regex(/^[0-9a-f]{24}$/i).nullable().optional());

const updateAssetSchema = z
  .object({
    legacyBase44Id: optionalBase44Id,
    legacy_base44_id: optionalBase44Id,
    name: optionalRequiredText,
    ticker: optionalText,
    assetType: optionalText,
    asset_type: optionalText,
    category: optionalText,
    market: optionalRequiredText,
    currency: optionalRequiredText,
    account: optionalRequiredText,
    accountId: optionalUuid,
    account_id: optionalUuid,
    quantity: updateDecimalString,
    currentPrice: updateDecimalString,
    current_price: updateDecimalString,
    averageCost: optionalDecimalString,
    average_cost: optionalDecimalString,
    targetWeight: optionalDecimalString,
    target_weight: optionalDecimalString,
    groupId: optionalText,
    group_id: optionalText,
    memo: optionalText,
    description: optionalText,
    maAssetClass: optionalText,
    ma_asset_class: optionalText,
    maRuleEnabled: optionalBoolean,
    ma_rule_enabled: optionalBoolean,
    ma120: optionalDecimalString,
    ma_120: optionalDecimalString,
    daysAboveMa: optionalInteger,
    days_above_ma: optionalInteger,
    fractionalKrwValue: optionalDecimalString,
    fractional_krw_value: optionalDecimalString,
    fractionalAvgCost: optionalDecimalString,
    fractional_avg_cost: optionalDecimalString,
    monthlyContribution: optionalDecimalString,
    monthly_contribution: optionalDecimalString,
    contributionDay: optionalInteger,
    contribution_day: optionalInteger,
    createdById: optionalText,
    created_by_id: optionalText,
  })
  .passthrough();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireAdminJob(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const json = await request.json();
  const parsed = updateAssetSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid asset payload",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const body = parsed.data;

  const currentPrice =
    body.currentPrice !== undefined ? body.currentPrice : body.current_price;
  const averageCost =
    body.averageCost !== undefined ? body.averageCost : body.average_cost;
  const targetWeight =
    body.targetWeight !== undefined ? body.targetWeight : body.target_weight;
  const assetType = body.assetType !== undefined ? body.assetType : body.asset_type;
  const groupId = body.groupId !== undefined ? body.groupId : body.group_id;
  const maAssetClass =
    body.maAssetClass !== undefined ? body.maAssetClass : body.ma_asset_class;
  const maRuleEnabled = body.maRuleEnabled ?? body.ma_rule_enabled;
  const ma120 = body.ma120 !== undefined ? body.ma120 : body.ma_120;
  const daysAboveMa =
    body.daysAboveMa !== undefined ? body.daysAboveMa : body.days_above_ma;
  const fractionalKrwValue =
    body.fractionalKrwValue !== undefined
      ? body.fractionalKrwValue
      : body.fractional_krw_value;
  const fractionalAvgCost =
    body.fractionalAvgCost !== undefined
      ? body.fractionalAvgCost
      : body.fractional_avg_cost;
  const monthlyContribution =
    body.monthlyContribution !== undefined
      ? body.monthlyContribution
      : body.monthly_contribution;
  const contributionDay =
    body.contributionDay !== undefined
      ? body.contributionDay
      : body.contribution_day;
  const createdById =
    body.createdById !== undefined ? body.createdById : body.created_by_id;
  const accountId = body.accountId !== undefined ? body.accountId : body.account_id;
  const legacyBase44Id =
    body.legacyBase44Id !== undefined
      ? body.legacyBase44Id
      : body.legacy_base44_id;

  const hasKnownUpdate = [
    legacyBase44Id,
    body.name,
    body.ticker,
    assetType,
    body.category,
    body.market,
    body.currency,
    body.account,
    accountId,
    body.quantity,
    currentPrice,
    averageCost,
    targetWeight,
    groupId,
    body.memo,
    body.description,
    maAssetClass,
    maRuleEnabled,
    ma120,
    daysAboveMa,
    fractionalKrwValue,
    fractionalAvgCost,
    monthlyContribution,
    contributionDay,
    createdById,
  ].some((value) => value !== undefined);

  if (!hasKnownUpdate) {
    return NextResponse.json(
      { error: "No valid asset fields provided" },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(assets)
    .set({
      ...(legacyBase44Id !== undefined ? { legacyBase44Id } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.ticker !== undefined ? { ticker: body.ticker } : {}),
      ...(assetType !== undefined ? { assetType } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.market !== undefined ? { market: body.market } : {}),
      ...(body.currency !== undefined ? { currency: body.currency } : {}),
      ...(body.account !== undefined ? { account: body.account } : {}),
      ...(accountId !== undefined ? { accountId } : {}),
      ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
      ...(currentPrice !== undefined ? { currentPrice } : {}),
      ...(averageCost !== undefined ? { averageCost } : {}),
      ...(targetWeight !== undefined ? { targetWeight } : {}),
      ...(groupId !== undefined ? { groupId } : {}),
      ...(body.memo !== undefined ? { memo: body.memo } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(maAssetClass !== undefined ? { maAssetClass } : {}),
      ...(maRuleEnabled !== undefined ? { maRuleEnabled } : {}),
      ...(ma120 !== undefined ? { ma120 } : {}),
      ...(daysAboveMa !== undefined ? { daysAboveMa } : {}),
      ...(fractionalKrwValue !== undefined ? { fractionalKrwValue } : {}),
      ...(fractionalAvgCost !== undefined ? { fractionalAvgCost } : {}),
      ...(monthlyContribution !== undefined ? { monthlyContribution } : {}),
      ...(contributionDay !== undefined ? { contributionDay } : {}),
      ...(createdById !== undefined ? { createdById } : {}),
      updatedAt: new Date(),
    })
    .where(eq(assets.id, id))
    .returning(assetEntityApiSelection);

  if (!updated) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireAdminJob(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;

  const [deleted] = await db
    .delete(assets)
    .where(eq(assets.id, id))
    .returning(assetEntityApiSelection);

  if (!deleted) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  return NextResponse.json(deleted);
}
