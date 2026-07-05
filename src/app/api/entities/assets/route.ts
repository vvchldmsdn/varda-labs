import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { assets } from "@/db/schema";

export async function GET() {
  const rows = await db
    .select()
    .from(assets)
    .orderBy(desc(assets.createdAt));

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const body = await request.json();

  const [created] = await db
    .insert(assets)
    .values({
      name: body.name,
      ticker: body.ticker ?? null,
      assetType: body.assetType ?? body.asset_type ?? "etf",
      category: body.category ?? null,
      market: body.market,
      currency: body.currency,
      account: body.account,
      quantity: String(body.quantity),
      currentPrice: String(body.currentPrice ?? body.current_price),
      averageCost:
        body.averageCost ?? body.average_cost == null
          ? null
          : String(body.averageCost ?? body.average_cost),
      targetWeight:
        body.targetWeight ?? body.target_weight == null
          ? null
          : String(body.targetWeight ?? body.target_weight),
      groupId: body.groupId ?? body.group_id ?? null,
      memo: body.memo ?? null,
      description: body.description ?? null,
      createdById: body.createdById ?? body.created_by_id ?? null,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}