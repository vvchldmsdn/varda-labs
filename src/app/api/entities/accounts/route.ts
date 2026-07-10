import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { accountEntityApiSelection } from "@/db/entity-api-selections";
import { accounts } from "@/db/schema";
import { requireAdminJob } from "@/lib/api-guards";

type NewAccount = typeof accounts.$inferInsert;

const requiredText = z.preprocess((value) => {
  if (typeof value === "string") return value.trim();
  return value;
}, z.string().min(1));

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

const createAccountSchema = z
  .object({
    ownerUserId: optionalText,
    owner_user_id: optionalText,
    code: requiredText,
    name: requiredText,
    accountType: optionalRequiredText,
    account_type: optionalRequiredText,
    currency: optionalRequiredText,
    isActive: optionalBoolean,
    is_active: optionalBoolean,
    sortOrder: optionalInteger,
    sort_order: optionalInteger,
  })
  .superRefine((data, context) => {
    if (!data.accountType && !data.account_type) {
      context.addIssue({
        code: "custom",
        path: ["accountType"],
        message: "accountType is required",
      });
    }
  });

export async function GET(request: Request) {
  const unauthorized = requireAdminJob(request);
  if (unauthorized) return unauthorized;

  const rows = await db
    .select(accountEntityApiSelection)
    .from(accounts)
    .orderBy(asc(accounts.sortOrder), asc(accounts.name));

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const unauthorized = requireAdminJob(request);
  if (unauthorized) return unauthorized;

  const json = await request.json();
  const parsed = createAccountSchema.safeParse(json);

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

  if (!accountType) {
    return NextResponse.json(
      { error: "accountType is required" },
      { status: 400 },
    );
  }

  const ownerUserId = body.ownerUserId ?? body.owner_user_id;
  const isActive = body.isActive ?? body.is_active;
  const sortOrder = body.sortOrder ?? body.sort_order;

  const insertValues: NewAccount = {
    code: body.code,
    name: body.name,
    accountType,
  };

  if (ownerUserId !== undefined) insertValues.ownerUserId = ownerUserId;
  if (body.currency !== undefined) insertValues.currency = body.currency;
  if (isActive !== undefined) insertValues.isActive = isActive;
  if (sortOrder !== undefined) insertValues.sortOrder = sortOrder;

  const [created] = await db
    .insert(accounts)
    .values(insertValues)
    .returning(accountEntityApiSelection);

  return NextResponse.json(created, { status: 201 });
}
