UPDATE "assets" AS asset
SET "account_id" = account.id,
    "account" = account.code
FROM "accounts" AS account
WHERE asset."account_id" IS NULL
  AND asset."canonical_owner_user_id" = account."canonical_owner_user_id"
  AND lower(btrim(asset."account")) = lower(btrim(account.code));--> statement-breakpoint
UPDATE "assets" AS asset
SET "account" = account.code
FROM "accounts" AS account
WHERE asset."account_id" = account.id
  AND asset."account" IS DISTINCT FROM account.code;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "assets" AS asset
    LEFT JOIN "accounts" AS account ON account.id = asset."account_id"
    WHERE asset."account_id" IS NULL
       OR account.id IS NULL
       OR asset."canonical_owner_user_id" IS DISTINCT FROM account."canonical_owner_user_id"
  ) THEN
    RAISE EXCEPTION 'assets.account_id cannot be normalized safely';
  END IF;
END;
$$;--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_account_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
