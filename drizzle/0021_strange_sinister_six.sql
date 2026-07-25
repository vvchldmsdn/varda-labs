CREATE TABLE "identity_pairing_intent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_pairing_intent_id" uuid NOT NULL,
	"event_type" varchar(20) NOT NULL,
	"auth_identity_id" uuid,
	"subject_binding_version" varchar(64),
	"subject_binding" varchar(96),
	"identity_link_planner_policy_id" varchar(64),
	"identity_link_plan_binding_version" varchar(64),
	"identity_link_plan_binding" varchar(112),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "id_pair_intent_events_type_check" CHECK ("identity_pairing_intent_events"."event_type" in ('consumed', 'revoked')),
	CONSTRAINT "id_pair_intent_events_identity_state_check" CHECK (("identity_pairing_intent_events"."event_type" = 'consumed' and "identity_pairing_intent_events"."auth_identity_id" is not null and "identity_pairing_intent_events"."subject_binding_version" is not null and "identity_pairing_intent_events"."subject_binding_version" = 'provider_subject_hmac_sha256_v1' and "identity_pairing_intent_events"."subject_binding" is not null and "identity_pairing_intent_events"."subject_binding" ~ '^hmac-sha256-v1:[0-9a-f]{64}$' and "identity_pairing_intent_events"."identity_link_planner_policy_id" is not null and "identity_pairing_intent_events"."identity_link_planner_policy_id" = 'initial_identity_link_planner_v1' and "identity_pairing_intent_events"."identity_link_plan_binding_version" is not null and "identity_pairing_intent_events"."identity_link_plan_binding_version" = 'identity_link_plan_hmac_sha256_v1' and "identity_pairing_intent_events"."identity_link_plan_binding" is not null and "identity_pairing_intent_events"."identity_link_plan_binding" ~ '^identity-link-plan-hmac-sha256-v1:[0-9a-f]{64}$') or ("identity_pairing_intent_events"."event_type" = 'revoked' and "identity_pairing_intent_events"."auth_identity_id" is null and "identity_pairing_intent_events"."subject_binding_version" is null and "identity_pairing_intent_events"."subject_binding" is null and "identity_pairing_intent_events"."identity_link_planner_policy_id" is null and "identity_pairing_intent_events"."identity_link_plan_binding_version" is null and "identity_pairing_intent_events"."identity_link_plan_binding" is null))
);
--> statement-breakpoint
CREATE TABLE "identity_pairing_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authority_policy_id" varchar(64) NOT NULL,
	"target_app_user_id" uuid NOT NULL,
	"provider" varchar(50) NOT NULL,
	"claim_digest_version" varchar(64) NOT NULL,
	"claim_digest" varchar(96) NOT NULL,
	"target_review_policy_id" varchar(64) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "id_pair_intents_policy_check" CHECK ("identity_pairing_intents"."authority_policy_id" = 'preissued_bootstrap_claim_authority_v1'),
	CONSTRAINT "id_pair_intents_provider_check" CHECK ("identity_pairing_intents"."provider" = 'neon_auth'),
	CONSTRAINT "id_pair_intents_claim_digest_check" CHECK ("identity_pairing_intents"."claim_digest_version" = 'bootstrap_claim_sha256_v1' and "identity_pairing_intents"."claim_digest" ~ '^bootstrap-claim-sha256-v1:[0-9a-f]{64}$'),
	CONSTRAINT "id_pair_intents_target_review_policy_check" CHECK ("identity_pairing_intents"."target_review_policy_id" = 'single_provisioning_user_explicit_review_v1'),
	CONSTRAINT "id_pair_intents_lifetime_check" CHECK ("identity_pairing_intents"."expires_at" > "identity_pairing_intents"."issued_at" and "identity_pairing_intents"."expires_at" <= "identity_pairing_intents"."issued_at" + interval '10 minutes')
);
--> statement-breakpoint
ALTER TABLE "identity_pairing_intent_events" ADD CONSTRAINT "id_pair_intent_events_intent_fk" FOREIGN KEY ("identity_pairing_intent_id") REFERENCES "public"."identity_pairing_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_pairing_intent_events" ADD CONSTRAINT "id_pair_intent_events_identity_fk" FOREIGN KEY ("auth_identity_id") REFERENCES "public"."auth_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_pairing_intents" ADD CONSTRAINT "id_pair_intents_target_app_user_fk" FOREIGN KEY ("target_app_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "id_pair_intent_events_terminal_unique" ON "identity_pairing_intent_events" USING btree ("identity_pairing_intent_id");--> statement-breakpoint
CREATE INDEX "id_pair_intent_events_auth_identity_idx" ON "identity_pairing_intent_events" USING btree ("auth_identity_id");--> statement-breakpoint
CREATE INDEX "id_pair_intent_events_subject_binding_idx" ON "identity_pairing_intent_events" USING btree ("subject_binding");--> statement-breakpoint
CREATE UNIQUE INDEX "id_pair_intents_claim_digest_unique" ON "identity_pairing_intents" USING btree ("claim_digest");--> statement-breakpoint
CREATE INDEX "id_pair_intents_target_app_user_idx" ON "identity_pairing_intents" USING btree ("target_app_user_id");--> statement-breakpoint
CREATE FUNCTION "prevent_identity_pairing_evidence_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'identity pairing evidence is append-only';
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "identity_pairing_intents_append_only"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "identity_pairing_intents"
FOR EACH STATEMENT
EXECUTE FUNCTION "prevent_identity_pairing_evidence_mutation"();--> statement-breakpoint
CREATE TRIGGER "identity_pairing_intent_events_append_only"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "identity_pairing_intent_events"
FOR EACH STATEMENT
EXECUTE FUNCTION "prevent_identity_pairing_evidence_mutation"();--> statement-breakpoint
CREATE FUNCTION "enforce_identity_pairing_consumed_identity_match"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	intent_target_app_user_id uuid;
	intent_provider varchar(50);
	identity_app_user_id uuid;
	identity_provider varchar(50);
BEGIN
	IF TG_TABLE_NAME = 'identity_pairing_intent_events' THEN
		IF NEW.event_type <> 'consumed' THEN
			RETURN NEW;
		END IF;

		SELECT
			intent.target_app_user_id,
			intent.provider,
			identity_row.app_user_id,
			identity_row.provider
		INTO STRICT
			intent_target_app_user_id,
			intent_provider,
			identity_app_user_id,
			identity_provider
		FROM public.identity_pairing_intents AS intent
		JOIN public.auth_identities AS identity_row
			ON identity_row.id = NEW.auth_identity_id
		WHERE intent.id = NEW.identity_pairing_intent_id
		FOR UPDATE OF identity_row;

		IF identity_app_user_id IS DISTINCT FROM intent_target_app_user_id
			OR identity_provider IS DISTINCT FROM intent_provider THEN
			RAISE EXCEPTION 'consumed identity does not match pairing intent target and provider'
				USING ERRCODE = '23514';
		END IF;

		RETURN NEW;
	END IF;

	IF TG_TABLE_NAME = 'auth_identities' THEN
		IF NEW.app_user_id IS NOT DISTINCT FROM OLD.app_user_id
			AND NEW.provider IS NOT DISTINCT FROM OLD.provider THEN
			RETURN NEW;
		END IF;

		IF EXISTS (
			SELECT 1
			FROM public.identity_pairing_intent_events AS event
			JOIN public.identity_pairing_intents AS intent
				ON intent.id = event.identity_pairing_intent_id
			WHERE event.auth_identity_id = NEW.id
				AND event.event_type = 'consumed'
				AND (
					intent.target_app_user_id IS DISTINCT FROM NEW.app_user_id
					OR intent.provider IS DISTINCT FROM NEW.provider
				)
		) THEN
			RAISE EXCEPTION 'consumed identity cannot be rebound away from pairing intent target or provider'
				USING ERRCODE = '23514';
		END IF;

		RETURN NEW;
	END IF;

	RAISE EXCEPTION 'unsupported identity pairing constraint trigger table';
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "id_pair_intent_events_identity_match"
AFTER INSERT ON "identity_pairing_intent_events"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION "enforce_identity_pairing_consumed_identity_match"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "auth_identities_consumed_pairing_binding_guard"
AFTER UPDATE ON "auth_identities"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION "enforce_identity_pairing_consumed_identity_match"();
