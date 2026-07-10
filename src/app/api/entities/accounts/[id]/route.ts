import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { accountEntityApiSelection } from "@/db/entity-api-selections";
import { accounts } from "@/db/schema";
import { requireAdminJob } from "@/lib/api-guards";

type UpdateAccount = Partial<typeof accounts.$inferInsert> & {
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

const updateAccountSchema = z.object({
  ownerUserId: optionalText,
  owner_user_id: optionalText,
  code: optionalRequiredText,
  name: optionalRequiredText,
  accountType: optionalRequiredText,
  account_type: optionalRequiredText,
  currency: optionalRequiredText,
  isActive: optionalBoolean,
  is_active: optionalBoolean,
  sortOrder: optionalInteger,
  sort_order: optionalInteger,
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireAdminJob(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const json = await request.json();
  const parsed = updateAccountSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid account payload",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const body = parsed.data;

  const accountType = body.accountType ?? body.account_type;
  const isActive = body.isActive ?? body.is_active;
  const sortOrder = body.sortOrder ?? body.sort_order;
  const ownerUserId = body.ownerUserId ?? body.owner_user_id;

  const hasKnownUpdate = [
    ownerUserId,
    body.code,
    body.name,
    accountType,
    body.currency,
    isActive,
    sortOrder,
  ].some((value) => value !== undefined);

  if (!hasKnownUpdate) {
    return NextResponse.json(
      { error: "No valid account fields provided" },
      { status: 400 },
    );
  }

  const updateValues: UpdateAccount = {
    updatedAt: new Date(),
  };

  if (ownerUserId !== undefined) updateValues.ownerUserId = ownerUserId;
  if (body.code !== undefined) updateValues.code = body.code;
  if (body.name !== undefined) updateValues.name = body.name;
  if (accountType !== undefined) updateValues.accountType = accountType;
  if (body.currency !== undefined) updateValues.currency = body.currency;
  if (isActive !== undefined) updateValues.isActive = isActive;
  if (sortOrder !== undefined) updateValues.sortOrder = sortOrder;

  const [updated] = await db
    .update(accounts)
    .set(updateValues)
    .where(eq(accounts.id, id))
    .returning(accountEntityApiSelection);

  if (!updated) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
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
    .delete(accounts)
    .where(eq(accounts.id, id))
    .returning(accountEntityApiSelection);

  if (!deleted) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  return NextResponse.json(deleted);
}
