CREATE TABLE "fixed_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_base44_id" varchar(24),
	"owner_user_id" varchar(255),
	"name" text NOT NULL,
	"type" varchar(50) NOT NULL,
	"category" varchar(100) NOT NULL,
	"day_of_month" integer NOT NULL,
	"holiday_shift" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"amount" numeric(28, 6) NOT NULL,
	"base44_created_at" timestamp with time zone,
	"base44_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_base44_id" varchar(24),
	"owner_user_id" varchar(255),
	"title" text,
	"category" varchar(100) NOT NULL,
	"target_date" date NOT NULL,
	"priority" integer,
	"memo" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"target_amount" numeric(28, 6) NOT NULL,
	"current_allocated_amount" numeric(28, 6),
	"monthly_contribution" numeric(28, 6),
	"expected_return" numeric(20, 8),
	"base44_created_at" timestamp with time zone,
	"base44_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_incomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_base44_id" varchar(24),
	"owner_user_id" varchar(255),
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"pay_day" integer NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"amount" numeric(28, 6) NOT NULL,
	"actual_amount" numeric(28, 6),
	"base44_created_at" timestamp with time zone,
	"base44_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_base44_id" varchar(24),
	"owner_user_id" varchar(255),
	"date" date NOT NULL,
	"type" varchar(50) NOT NULL,
	"category" varchar(100) NOT NULL,
	"description" text,
	"memo" text,
	"account" varchar(50),
	"account_id" uuid,
	"payment_method" varchar(50),
	"is_fixed" boolean DEFAULT false NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"amount" numeric(28, 6) NOT NULL,
	"base44_created_at" timestamp with time zone,
	"base44_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_transactions_legacy_base44_id_unique" ON "fixed_transactions" USING btree ("legacy_base44_id");--> statement-breakpoint
CREATE INDEX "fixed_transactions_owner_active_idx" ON "fixed_transactions" USING btree ("owner_user_id","is_active");--> statement-breakpoint
CREATE INDEX "fixed_transactions_day_of_month_idx" ON "fixed_transactions" USING btree ("day_of_month");--> statement-breakpoint
CREATE UNIQUE INDEX "goals_legacy_base44_id_unique" ON "goals" USING btree ("legacy_base44_id");--> statement-breakpoint
CREATE INDEX "goals_owner_target_date_idx" ON "goals" USING btree ("owner_user_id","target_date");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_incomes_legacy_base44_id_unique" ON "monthly_incomes" USING btree ("legacy_base44_id");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_incomes_owner_year_month_unique" ON "monthly_incomes" USING btree ("owner_user_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_legacy_base44_id_unique" ON "transactions" USING btree ("legacy_base44_id");--> statement-breakpoint
CREATE INDEX "transactions_owner_date_idx" ON "transactions" USING btree ("owner_user_id","date");--> statement-breakpoint
CREATE INDEX "transactions_type_date_idx" ON "transactions" USING btree ("type","date");--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "transactions" USING btree ("account","date");