import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { assetGroupEntityApiSelection } from "@/db/entity-api-selections";
import { assetGroups } from "@/db/schema";
import { requireAdminJob } from "@/lib/api-guards";

type UpdateAssetGroup = Partial<typeof assetGroups.$inferInsert> & {
  updatedAt: Date;
};

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
  if (value === undefined || value === null || value === "") return undefined;
  return Number(value);
}, z.number().int().optional());

const optionalBase44Id = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string") return value.trim();
  return value;
}, z.string().regex(/^[0-9a-f]{24}$/i).nullable().optional());

const updateAssetGroupSchema = z.object({
  legacyBase44Id: optionalBase44Id,
  legacy_base44_id: optionalBase44Id,
  name: optionalRequiredText,
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
  executionMode: optionalRequiredText,
  execution_mode: optionalRequiredText,
  ownerUserId: optionalText,
  owner_user_id: optionalText,
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireAdminJob(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const json = await request.json();
  const parsed = updateAssetGroupSchema.safeParse(json);

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

  const targetWeight = body.targetWeight ?? body.target_weight;
  const isActive = body.isActive ?? body.is_active;
  const sortOrder = body.sortOrder ?? body.sort_order;
  const fxExempt = body.fxExempt ?? body.fx_exempt;
  const maExempt = body.maExempt ?? body.ma_exempt;
  const executionMode = body.executionMode ?? body.execution_mode;
  const ownerUserId = body.ownerUserId ?? body.owner_user_id;
  const legacyBase44Id =
    body.legacyBase44Id !== undefined
      ? body.legacyBase44Id
      : body.legacy_base44_id;

  const hasKnownUpdate = [
    legacyBase44Id,
    body.name,
    targetWeight,
    body.description,
    body.color,
    isActive,
    sortOrder,
    fxExempt,
    maExempt,
    executionMode,
    ownerUserId,
  ].some((value) => value !== undefined);

  if (!hasKnownUpdate) {
    return NextResponse.json(
      { error: "No valid asset group fields provided" },
      { status: 400 },
    );
  }

  const updateValues: UpdateAssetGroup = {
    updatedAt: new Date(),
  };

  if (legacyBase44Id !== undefined) updateValues.legacyBase44Id = legacyBase44Id;
  if (body.name !== undefined) updateValues.name = body.name;
  if (targetWeight !== undefined) updateValues.targetWeight = targetWeight;
  if (body.description !== undefined) updateValues.description = body.description;
  if (body.color !== undefined) updateValues.color = body.color;
  if (isActive !== undefined) updateValues.isActive = isActive;
  if (sortOrder !== undefined) updateValues.sortOrder = sortOrder;
  if (fxExempt !== undefined) updateValues.fxExempt = fxExempt;
  if (maExempt !== undefined) updateValues.maExempt = maExempt;
  if (executionMode !== undefined) updateValues.executionMode = executionMode;
  if (ownerUserId !== undefined) updateValues.ownerUserId = ownerUserId;

  const [updated] = await db
    .update(assetGroups)
    .set(updateValues)
    .where(eq(assetGroups.id, id))
    .returning(assetGroupEntityApiSelection);

  if (!updated) {
    return NextResponse.json({ error: "Asset group not found" }, { status: 404 });
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
    .delete(assetGroups)
    .where(eq(assetGroups.id, id))
    .returning(assetGroupEntityApiSelection);

  if (!deleted) {
    return NextResponse.json({ error: "Asset group not found" }, { status: 404 });
  }

  return NextResponse.json(deleted);
}
