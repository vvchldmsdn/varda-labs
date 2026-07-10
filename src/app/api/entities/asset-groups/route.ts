import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { assetGroupEntityApiSelection } from "@/db/entity-api-selections";
import { assetGroups } from "@/db/schema";
import { requireAdminJob } from "@/lib/api-guards";

const optionalText = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return value;
}, z.string().nullable().optional());

const optionalDecimalString = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return null;
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
  if (value === undefined || value === null || value === "") return undefined;
  return Number(value);
}, z.number().int().optional());

const optionalBase44Id = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string") return value.trim();
  return value;
}, z.string().regex(/^[0-9a-f]{24}$/i).nullable().optional());

const createAssetGroupSchema = z.object({
  legacyBase44Id: optionalBase44Id,
  legacy_base44_id: optionalBase44Id,
  name: z.string().trim().min(1),
  targetWeight: optionalDecimalString,
  target_weight: optionalDecimalString,
  description: optionalText,
  color: optionalText,
  isActive: optionalBoolean,
  is_active: optionalBoolean,
  sortOrder: optionalInteger,
  sort_order: optionalInteger,
  fxExempt: optionalBoolean,
  fx_exempt: optionalBoolean,
  maExempt: optionalBoolean,
  ma_exempt: optionalBoolean,
  executionMode: optionalText,
  execution_mode: optionalText,
  ownerUserId: optionalText,
  owner_user_id: optionalText,
});

export async function GET(request: Request) {
  const unauthorized = requireAdminJob(request);
  if (unauthorized) return unauthorized;

  const rows = await db
    .select(assetGroupEntityApiSelection)
    .from(assetGroups)
    .orderBy(asc(assetGroups.sortOrder), asc(assetGroups.name));

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const unauthorized = requireAdminJob(request);
  if (unauthorized) return unauthorized;

  const json = await request.json();
  const parsed = createAssetGroupSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid asset group payload",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const legacyBase44Id =
    body.legacyBase44Id !== undefined
      ? body.legacyBase44Id
      : body.legacy_base44_id ?? null;

  const [created] = await db
    .insert(assetGroups)
    .values({
      legacyBase44Id,
      name: body.name,
      targetWeight: body.targetWeight ?? body.target_weight ?? null,
      description: body.description,
      color: body.color,
      isActive: body.isActive ?? body.is_active ?? true,
      sortOrder: body.sortOrder ?? body.sort_order ?? 0,
      fxExempt: body.fxExempt ?? body.fx_exempt ?? false,
      maExempt: body.maExempt ?? body.ma_exempt ?? false,
      executionMode: body.executionMode ?? body.execution_mode ?? "gap_first",
      ownerUserId: body.ownerUserId ?? body.owner_user_id ?? null,
    })
    .returning(assetGroupEntityApiSelection);

  return NextResponse.json(created, { status: 201 });
}
