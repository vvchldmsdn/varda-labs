CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" varchar(255),
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"account_type" varchar(50) NOT NULL,
	"currency" varchar(10) DEFAULT 'KRW' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" varchar(255),
	"group_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"priority" integer,
	"allocation_ratio" numeric(8, 4),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" varchar(255),
	"name" varchar(100) NOT NULL,
	"target_weight" numeric(8, 4),
	"description" text,
	"color" varchar(20),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"fx_exempt" boolean DEFAULT false NOT NULL,
	"ma_exempt" boolean DEFAULT false NOT NULL,
	"execution_mode" varchar(50) DEFAULT 'gap_first' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_owner_code_unique" ON "accounts" USING btree ("owner_user_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_group_members_group_asset_unique" ON "asset_group_members" USING btree ("group_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_groups_owner_name_unique" ON "asset_groups" USING btree ("owner_user_id","name");