CREATE TABLE public.contribution_effects (
  owner_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document)='object' AND octet_length(document::text)<=524288 AND document->>'version'='contribution_effect_v1' AND document->>'accountId'=account_id::text),
  trade_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(trade_ids)='array' AND jsonb_array_length(trade_ids)<=100),
  PRIMARY KEY(owner_user_id,id)
);
--> statement-breakpoint
CREATE INDEX contribution_effects_owner_account_idx ON public.contribution_effects(owner_user_id,account_id,created_at);
--> statement-breakpoint
ALTER TABLE public.contribution_effects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.contribution_effects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY contribution_effects_tenant_v1 ON public.contribution_effects FOR ALL TO varda_tenant_app
USING (owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND public.investment_plan_tenant_active())
WITH CHECK (owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND public.investment_plan_tenant_active() AND EXISTS(SELECT 1 FROM public.accounts a WHERE a.id=contribution_effects.account_id AND a.canonical_owner_user_id=contribution_effects.owner_user_id AND a.is_active));
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE,DELETE ON public.contribution_effects TO varda_tenant_app;
--> statement-breakpoint
CREATE FUNCTION public.contribution_effects_preserve_basis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.document IS DISTINCT FROM OLD.document OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'contribution_effect_basis_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER contribution_effects_preserve_basis BEFORE UPDATE ON public.contribution_effects
FOR EACH ROW EXECUTE FUNCTION public.contribution_effects_preserve_basis();
