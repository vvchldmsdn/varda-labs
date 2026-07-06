import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { assetGroupMembers } from "@/db/schema";
import { requireAdminJob } from "@/lib/api-guards";

type NewAssetGroupMember = typeof assetGroupMembers.$inferInsert;

const requiredUuid = z.preprocess((value) => {
  if (typeof value === "string") return value.trim();
  return value;
}, z.string().uuid());

const optionalText = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return value;
}, z.string().nullable().optional());

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

const createAssetGroupMemberSchema = z
  .object({
    ownerUserId: optionalText,
    owner_user_id: optionalText,
    groupId: requiredUuid.optional(),
    group_id: requiredUuid.optional(),
    assetId: requiredUuid.optional(),
    asset_id: requiredUuid.optional(),
    priority: optionalInteger,
    allocationRatio: optionalDecimalString,
    allocation_ratio: optionalDecimalString,
    sortOrder: optionalInteger,
    sort_order: optionalInteger,
    isActive: optionalBoolean,
    is_active: optionalBoolean,
  })
  .superRefine((data, context) => {
    if (!data.groupId && !data.group_id) {
      context.addIssue({
        code: "custom",
        path: ["groupId"],
        message: "groupId is required",
      });
    }

    if (!data.assetId && !data.asset_id) {
      context.addIssue({
        code: "custom",
        path: ["assetId"],
        message: "assetId is required",
      });
    }
  });

export async function GET(request: Request) {
  const unauthorized = requireAdminJob(request);
  if (unauthorized) return unauthorized;

  const rows = await db
    .select()
    .from(assetGroupMembers)
    .orderBy(
      asc(assetGroupMembers.sortOrder),
      asc(assetGroupMembers.createdAt),
    );

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const unauthorized = requireAdminJob(request);
  if (unauthorized) return unauthorized;

  const json = await request.json();
  const parsed = createAssetGroupMemberSchema.safeParse(json);

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

  if (!groupId || !assetId) {
    return NextResponse.json(
      { error: "groupId and assetId are required" },
      { status: 400 },
    );
  }

  const allocationRatio = body.allocationRatio ?? body.allocation_ratio;
  const sortOrder = body.sortOrder ?? body.sort_order;
  const isActive = body.isActive ?? body.is_active;
  const ownerUserId = body.ownerUserId ?? body.owner_user_id;

  const insertValues: NewAssetGroupMember = {
    groupId,
    assetId,
  };

  if (ownerUserId !== undefined) insertValues.ownerUserId = ownerUserId;
  if (body.priority !== undefined) insertValues.priority = body.priority;
  if (allocationRatio !== undefined) insertValues.allocationRatio = allocationRatio;
  if (sortOrder !== undefined) insertValues.sortOrder = sortOrder;
  if (isActive !== undefined) insertValues.isActive = isActive;

  const [created] = await db
    .insert(assetGroupMembers)
    .values(insertValues)
    .returning();

  return NextResponse.json(created, { status: 201 });
}
