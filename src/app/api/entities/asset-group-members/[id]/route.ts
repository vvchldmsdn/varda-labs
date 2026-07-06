import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { assetGroupMembers } from "@/db/schema";
import { requireAdminJob } from "@/lib/api-guards";

type UpdateAssetGroupMember = Partial<typeof assetGroupMembers.$inferInsert> & {
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

const optionalUuid = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string") return value.trim();
  return value;
}, z.string().uuid().nullable().optional());

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

const updateAssetGroupMemberSchema = z.object({
  ownerUserId: optionalText,
  owner_user_id: optionalText,
  groupId: optionalUuid,
  group_id: optionalUuid,
  assetId: optionalUuid,
  asset_id: optionalUuid,
  priority: optionalInteger,
  allocationRatio: optionalDecimalString,
  allocation_ratio: optionalDecimalString,
  sortOrder: optionalInteger,
  sort_order: optionalInteger,
  isActive: optionalBoolean,
  is_active: optionalBoolean,
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireAdminJob(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const json = await request.json();
  const parsed = updateAssetGroupMemberSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid asset group member payload",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const body = parsed.data;

  const groupId = body.groupId ?? body.group_id;
  const assetId = body.assetId ?? body.asset_id;
  const allocationRatio = body.allocationRatio ?? body.allocation_ratio;
  const sortOrder = body.sortOrder ?? body.sort_order;
  const isActive = body.isActive ?? body.is_active;
  const ownerUserId = body.ownerUserId ?? body.owner_user_id;

  const hasKnownUpdate = [
    groupId,
    assetId,
    body.priority,
    allocationRatio,
    sortOrder,
    isActive,
    ownerUserId,
  ].some((value) => value !== undefined);

  if (!hasKnownUpdate) {
    return NextResponse.json(
      { error: "No valid asset group member fields provided" },
      { status: 400 },
    );
  }

  const updateValues: UpdateAssetGroupMember = {
    updatedAt: new Date(),
  };

  if (groupId !== undefined && groupId !== null) updateValues.groupId = groupId;
  if (assetId !== undefined && assetId !== null) updateValues.assetId = assetId;
  if (body.priority !== undefined) updateValues.priority = body.priority;
  if (allocationRatio !== undefined) updateValues.allocationRatio = allocationRatio;
  if (sortOrder !== undefined) updateValues.sortOrder = sortOrder;
  if (isActive !== undefined) updateValues.isActive = isActive;
  if (ownerUserId !== undefined) updateValues.ownerUserId = ownerUserId;

  const [updated] = await db
    .update(assetGroupMembers)
    .set(updateValues)
    .where(eq(assetGroupMembers.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json(
      { error: "Asset group member not found" },
      { status: 404 },
    );
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
    .delete(assetGroupMembers)
    .where(eq(assetGroupMembers.id, id))
    .returning();

  if (!deleted) {
    return NextResponse.json(
      { error: "Asset group member not found" },
      { status: 404 },
    );
  }

  return NextResponse.json(deleted);
}
