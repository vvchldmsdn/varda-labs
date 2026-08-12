CREATE TABLE "portfolio_group_account_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_owner_user_id" uuid NOT NULL,
	"portfolio_group_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_group_account_memberships_valid_period_check" CHECK ("portfolio_group_account_memberships"."valid_to" is null or "portfolio_group_account_memberships"."valid_to" > "portfolio_group_account_memberships"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "portfolio_group_asset_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_owner_user_id" uuid NOT NULL,
	"portfolio_group_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_group_asset_memberships_valid_period_check" CHECK ("portfolio_group_asset_memberships"."valid_to" is null or "portfolio_group_asset_memberships"."valid_to" > "portfolio_group_asset_memberships"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "portfolio_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_owner_user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_groups_name_check" CHECK ("portfolio_groups"."name" = btrim("portfolio_groups"."name") and char_length("portfolio_groups"."name") > 0),
	CONSTRAINT "portfolio_groups_sort_order_check" CHECK ("portfolio_groups"."sort_order" >= 0),
	CONSTRAINT "portfolio_groups_archived_at_check" CHECK ("portfolio_groups"."archived_at" is null or "portfolio_groups"."archived_at" >= "portfolio_groups"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "assets_id_canonical_owner_unique" ON "assets" USING btree ("id","canonical_owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_groups_id_canonical_owner_unique" ON "portfolio_groups" USING btree ("id","canonical_owner_user_id");--> statement-breakpoint
ALTER TABLE "portfolio_group_account_memberships" ADD CONSTRAINT "portfolio_group_account_memberships_owner_user_fk" FOREIGN KEY ("canonical_owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_group_account_memberships" ADD CONSTRAINT "portfolio_group_account_memberships_group_owner_fk" FOREIGN KEY ("portfolio_group_id","canonical_owner_user_id") REFERENCES "public"."portfolio_groups"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_group_account_memberships" ADD CONSTRAINT "portfolio_group_account_memberships_account_owner_fk" FOREIGN KEY ("account_id","canonical_owner_user_id") REFERENCES "public"."accounts"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_group_asset_memberships" ADD CONSTRAINT "portfolio_group_asset_memberships_owner_user_fk" FOREIGN KEY ("canonical_owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_group_asset_memberships" ADD CONSTRAINT "portfolio_group_asset_memberships_group_owner_fk" FOREIGN KEY ("portfolio_group_id","canonical_owner_user_id") REFERENCES "public"."portfolio_groups"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_group_asset_memberships" ADD CONSTRAINT "portfolio_group_asset_memberships_asset_owner_fk" FOREIGN KEY ("asset_id","canonical_owner_user_id") REFERENCES "public"."assets"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_groups" ADD CONSTRAINT "portfolio_groups_owner_user_fk" FOREIGN KEY ("canonical_owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_group_account_memberships_start_unique" ON "portfolio_group_account_memberships" USING btree ("portfolio_group_id","account_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_group_account_memberships_active_unique" ON "portfolio_group_account_memberships" USING btree ("portfolio_group_id","account_id") WHERE "portfolio_group_account_memberships"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "portfolio_group_account_memberships_owner_user_id_idx" ON "portfolio_group_account_memberships" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "portfolio_group_account_memberships_account_id_idx" ON "portfolio_group_account_memberships" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_group_asset_memberships_start_unique" ON "portfolio_group_asset_memberships" USING btree ("portfolio_group_id","asset_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_group_asset_memberships_active_unique" ON "portfolio_group_asset_memberships" USING btree ("portfolio_group_id","asset_id") WHERE "portfolio_group_asset_memberships"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "portfolio_group_asset_memberships_owner_user_id_idx" ON "portfolio_group_asset_memberships" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "portfolio_group_asset_memberships_asset_id_idx" ON "portfolio_group_asset_memberships" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_groups_active_owner_name_unique" ON "portfolio_groups" USING btree ("canonical_owner_user_id",lower("name")) WHERE "portfolio_groups"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "portfolio_groups_canonical_owner_user_id_idx" ON "portfolio_groups" USING btree ("canonical_owner_user_id");
