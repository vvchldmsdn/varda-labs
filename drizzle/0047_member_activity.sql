CREATE TABLE "member_activity_daily" (
	"owner_user_id" uuid NOT NULL,
	"activity_date" date NOT NULL,
	"feature" varchar(20) NOT NULL,
	"views" integer NOT NULL,
	"visits" integer NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_activity_daily_owner_user_id_activity_date_feature_pk" PRIMARY KEY("owner_user_id","activity_date","feature"),
	CONSTRAINT "member_activity_daily_counts" CHECK ("member_activity_daily"."views" > 0 and "member_activity_daily"."visits" >= 0 and "member_activity_daily"."visits" <= "member_activity_daily"."views"),
	CONSTRAINT "member_activity_daily_feature" CHECK ("member_activity_daily"."feature" in ('home','today','structure','contribution','lab','simulation','history','manage','plans','input'))
);
--> statement-breakpoint
ALTER TABLE "member_activity_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_activity_profiles" (
	"owner_user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" varchar(80),
	"email" varchar(254),
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_activity_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_activity_daily" ADD CONSTRAINT "member_activity_daily_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_activity_profiles" ADD CONSTRAINT "member_activity_profiles_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_activity_daily_date_idx" ON "member_activity_daily" USING btree ("activity_date");
--> statement-breakpoint
ALTER TABLE member_activity_daily FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE member_activity_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON member_activity_daily, member_activity_profiles FROM PUBLIC, varda_tenant_app;
