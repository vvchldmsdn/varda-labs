CREATE TABLE "identity_pairing_intent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_pairing_intent_id" uuid NOT NULL,
	"event_type" varchar(20) NOT NULL,
	"auth_identity_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "id_pair_intent_events_type_check" CHECK ("identity_pairing_intent_events"."event_type" in ('consumed', 'revoked')),
	CONSTRAINT "id_pair_intent_events_identity_state_check" CHECK (("identity_pairing_intent_events"."event_type" = 'consumed' and "identity_pairing_intent_events"."auth_identity_id" is not null) or ("identity_pairing_intent_events"."event_type" = 'revoked' and "identity_pairing_intent_events"."auth_identity_id" is null))
);
--> statement-breakpoint
CREATE TABLE "identity_pairing_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authority_policy_id" varchar(64) NOT NULL,
	"target_app_user_id" uuid NOT NULL,
	"provider" varchar(50) NOT NULL,
	"subject_binding_version" varchar(64) NOT NULL,
	"subject_binding" varchar(96) NOT NULL,
	"operator_principal_binding_version" varchar(64) NOT NULL,
	"operator_principal_binding" varchar(96) NOT NULL,
	"subject_principal_binding_version" varchar(64) NOT NULL,
	"subject_principal_binding" varchar(96) NOT NULL,
	"operator_binding_version" varchar(64) NOT NULL,
	"operator_binding" varchar(96) NOT NULL,
	"identity_link_planner_policy_id" varchar(64) NOT NULL,
	"identity_link_plan_binding_version" varchar(64) NOT NULL,
	"identity_link_plan_binding" varchar(112) NOT NULL,
	"challenge_digest" varchar(96) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "id_pair_intents_policy_check" CHECK ("identity_pairing_intents"."authority_policy_id" = 'identity_pairing_authority_v1'),
	CONSTRAINT "id_pair_intents_provider_check" CHECK ("identity_pairing_intents"."provider" = 'neon_auth'),
	CONSTRAINT "id_pair_intents_subject_binding_check" CHECK ("identity_pairing_intents"."subject_binding_version" = 'provider_subject_hmac_sha256_v1' and "identity_pairing_intents"."subject_binding" ~ '^hmac-sha256-v1:[0-9a-f]{64}$'),
	CONSTRAINT "id_pair_intents_operator_principal_check" CHECK ("identity_pairing_intents"."operator_principal_binding_version" = 'auth_principal_hmac_sha256_v1' and "identity_pairing_intents"."operator_principal_binding" ~ '^principal-hmac-sha256-v1:[0-9a-f]{64}$'),
	CONSTRAINT "id_pair_intents_subject_principal_check" CHECK ("identity_pairing_intents"."subject_principal_binding_version" = 'auth_principal_hmac_sha256_v1' and "identity_pairing_intents"."subject_principal_binding" ~ '^principal-hmac-sha256-v1:[0-9a-f]{64}$'),
	CONSTRAINT "id_pair_intents_operator_binding_check" CHECK ("identity_pairing_intents"."operator_binding_version" = 'operator_session_hmac_sha256_v1' and "identity_pairing_intents"."operator_binding" ~ '^operator-hmac-sha256-v1:[0-9a-f]{64}$'),
	CONSTRAINT "id_pair_intents_planner_policy_check" CHECK ("identity_pairing_intents"."identity_link_planner_policy_id" = 'initial_identity_link_planner_v1'),
	CONSTRAINT "id_pair_intents_plan_binding_check" CHECK ("identity_pairing_intents"."identity_link_plan_binding_version" = 'identity_link_plan_hmac_sha256_v1' and "identity_pairing_intents"."identity_link_plan_binding" ~ '^identity-link-plan-hmac-sha256-v1:[0-9a-f]{64}$'),
	CONSTRAINT "id_pair_intents_challenge_digest_check" CHECK ("identity_pairing_intents"."challenge_digest" ~ '^challenge-sha256-v1:[0-9a-f]{64}$'),
	CONSTRAINT "id_pair_intents_lifetime_check" CHECK ("identity_pairing_intents"."expires_at" > "identity_pairing_intents"."issued_at" and "identity_pairing_intents"."expires_at" <= "identity_pairing_intents"."issued_at" + interval '10 minutes')
);
--> statement-breakpoint
ALTER TABLE "identity_pairing_intent_events" ADD CONSTRAINT "id_pair_intent_events_intent_fk" FOREIGN KEY ("identity_pairing_intent_id") REFERENCES "public"."identity_pairing_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_pairing_intent_events" ADD CONSTRAINT "id_pair_intent_events_identity_fk" FOREIGN KEY ("auth_identity_id") REFERENCES "public"."auth_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_pairing_intents" ADD CONSTRAINT "id_pair_intents_target_app_user_fk" FOREIGN KEY ("target_app_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "id_pair_intent_events_terminal_unique" ON "identity_pairing_intent_events" USING btree ("identity_pairing_intent_id");--> statement-breakpoint
CREATE INDEX "id_pair_intent_events_auth_identity_idx" ON "identity_pairing_intent_events" USING btree ("auth_identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "id_pair_intents_challenge_digest_unique" ON "identity_pairing_intents" USING btree ("challenge_digest");--> statement-breakpoint
CREATE INDEX "id_pair_intents_target_app_user_idx" ON "identity_pairing_intents" USING btree ("target_app_user_id");--> statement-breakpoint
CREATE INDEX "id_pair_intents_subject_binding_idx" ON "identity_pairing_intents" USING btree ("provider","subject_binding");