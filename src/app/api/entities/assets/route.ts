import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { assets } from "@/db/schema";

const optionalText = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return value;
}, z.string().nullable().optional());

const requiredText = z.preprocess((value) => {
  if (typeof value === "string") return value.trim();
  return value;
}, z.string().min(1));

const decimalString = z.preprocess((value) => {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  return value;
}, z.string().regex(/^\d+(\.\d+)?$/));

const optionalDecimalString = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return null;
  return value;
}, decimalString.nullable().optional());

const optionalBoolean = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

const optionalInteger = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return null;
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

const createAssetSchema = z
  .object({
    legacyBase44Id: optionalBase44Id,
    legacy_base44_id: optionalBase44Id,
    name: z.string().trim().min(1),
    ticker: optionalText,
    assetType: optionalText,
    asset_type: optionalText,
    category: optionalText,
    market: requiredText,
    currency: requiredText,
    account: requiredText,
    accountId: optionalUuid,
    account_id: optionalUuid,
    quantity: decimalString,
    currentPrice: decimalString.optional(),
    current_price: decimalString.optional(),
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
  .passthrough()
  .superRefine((body, ctx) => {
    if (body.currentPrice === undefined && body.current_price === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["currentPrice"],
        message: "currentPrice is required",
      });
    }
  });

export async function GET() {
  const rows = await db
    .select()
    .from(assets)
    .orderBy(desc(assets.createdAt));

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const json = await request.json();
  const parsed = createAssetSchema.safeParse(json);

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
  const accountId = body.accountId ?? body.account_id ?? null;
  const legacyBase44Id =
    body.legacyBase44Id !== undefined
      ? body.legacyBase44Id
      : body.legacy_base44_id ?? null;

  if (currentPrice === undefined) {
    return NextResponse.json(
      { error: "currentPrice is required" },
      { status: 400 },
    );
  }

  const [created] = await db
    .insert(assets)
    .values({
      legacyBase44Id,
      name: body.name,
      ticker: body.ticker,
      assetType: body.assetType ?? body.asset_type ?? "etf",
      category: body.category,
      market: body.market,
      currency: body.currency,
      account: body.account,
      accountId,
      quantity: body.quantity,
      currentPrice,
      averageCost: body.averageCost ?? body.average_cost ?? null,
      targetWeight: body.targetWeight ?? body.target_weight ?? null,
      groupId: body.groupId ?? body.group_id ?? null,
      memo: body.memo,
      description: body.description,
      maRuleEnabled: body.maRuleEnabled ?? body.ma_rule_enabled ?? false,
      daysAboveMa: body.daysAboveMa ?? body.days_above_ma ?? null,
      createdById: body.createdById ?? body.created_by_id ?? null,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
