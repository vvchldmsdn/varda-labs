import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { assets } from "@/db/schema";

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

const updateAssetSchema = z
  .object({
    name: optionalRequiredText,
    ticker: optionalText,
    assetType: optionalText,
    asset_type: optionalText,
    category: optionalText,
    market: optionalRequiredText,
    currency: optionalRequiredText,
    account: optionalRequiredText,
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
    maRuleEnabled: optionalBoolean,
    ma_rule_enabled: optionalBoolean,
    daysAboveMa: optionalInteger,
    days_above_ma: optionalInteger,
    createdById: optionalText,
    created_by_id: optionalText,
  })
  .passthrough();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const currentPrice = body.currentPrice ?? body.current_price;
  const averageCost = body.averageCost ?? body.average_cost;
  const targetWeight = body.targetWeight ?? body.target_weight;
  const assetType = body.assetType ?? body.asset_type;
  const groupId = body.groupId ?? body.group_id;
  const maRuleEnabled = body.maRuleEnabled ?? body.ma_rule_enabled;
  const daysAboveMa = body.daysAboveMa ?? body.days_above_ma;
  const createdById = body.createdById ?? body.created_by_id;

  const hasKnownUpdate = [
    body.name,
    body.ticker,
    assetType,
    body.category,
    body.market,
    body.currency,
    body.account,
    body.quantity,
    currentPrice,
    averageCost,
    targetWeight,
    groupId,
    body.memo,
    body.description,
    maRuleEnabled,
    daysAboveMa,
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
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.ticker !== undefined ? { ticker: body.ticker } : {}),
      ...(assetType !== undefined ? { assetType } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.market !== undefined ? { market: body.market } : {}),
      ...(body.currency !== undefined ? { currency: body.currency } : {}),
      ...(body.account !== undefined ? { account: body.account } : {}),
      ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
      ...(currentPrice !== undefined ? { currentPrice } : {}),
      ...(averageCost !== undefined ? { averageCost } : {}),
      ...(targetWeight !== undefined ? { targetWeight } : {}),
      ...(groupId !== undefined ? { groupId } : {}),
      ...(body.memo !== undefined ? { memo: body.memo } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(maRuleEnabled !== undefined ? { maRuleEnabled } : {}),
      ...(daysAboveMa !== undefined ? { daysAboveMa } : {}),
      ...(createdById !== undefined ? { createdById } : {}),
      updatedAt: new Date(),
    })
    .where(eq(assets.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [deleted] = await db
    .delete(assets)
    .where(eq(assets.id, id))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  return NextResponse.json(deleted);
}