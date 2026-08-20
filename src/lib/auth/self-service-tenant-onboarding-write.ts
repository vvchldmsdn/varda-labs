import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { sqlClient } from "@/db/client";
import { readCurrentSessionSubject } from "@/lib/auth/current-session-subject";
import {
  classifySelfServiceTenantOnboardingWrite,
  parseSelfServiceTenantOnboardingInput,
  SELF_SERVICE_TENANT_ONBOARDING_POLICY,
  type SelfServiceTenantOnboardingActionState,
  type SelfServiceTenantOnboardingWriteEvidence,
} from "@/lib/auth/self-service-tenant-onboarding";

type WriteRow = Readonly<{
  existing_identity_count?: string | number;
  inserted_app_user_count?: string | number;
  inserted_identity_count?: string | number;
  identity_status?: string | null;
  app_user_status?: string | null;
  app_user_role?: string | null;
  mapped_app_user_matches?: boolean | null;
}>;

export async function createCurrentSessionTenant(
  formData: FormData,
): Promise<SelfServiceTenantOnboardingActionState> {
  const parsed = parseSelfServiceTenantOnboardingInput(formData);
  if (!parsed.ok) return state("invalid", parsed.message);

  const session = await readCurrentSessionSubject();
  if (session.state !== "authenticated") {
    return state(
      "unauthorized",
      session.state === "unauthenticated"
        ? "Sign in before creating a portfolio."
        : "The authenticated session could not be verified.",
    );
  }

  const appUserId = randomUUID();
  const authIdentityId = randomUUID();
  const now = new Date().toISOString();

  try {
    const row = await runAtomicOnboarding({
      provider: session.provider,
      providerSubject: session.providerSubject,
      appUserId,
      authIdentityId,
      now,
    });
    const outcome = classifySelfServiceTenantOnboardingWrite(toEvidence(row));
    if (outcome === "created") {
      return state("success", "Your empty portfolio is ready.");
    }
    if (outcome === "already_ready") {
      return state("already_ready", "Your portfolio is already connected.");
    }
    return state(
      "conflict",
      "An existing identity state prevents empty portfolio creation.",
    );
  } catch (error) {
    const code = databaseErrorCode(error);
    if (["23503", "23505", "55P03", "57014"].includes(code ?? "")) {
      return state(
        "conflict",
        "Another identity change completed first. Refresh before continuing.",
      );
    }
    return state("error", "The empty portfolio could not be created.");
  }
}

async function runAtomicOnboarding(input: Readonly<{
  provider: string;
  providerSubject: string;
  appUserId: string;
  authIdentityId: string;
  now: string;
}>) {
  const results = await sqlClient.transaction((transaction) => [
    transaction.query("set local lock_timeout = '2s'"),
    transaction.query("set local statement_timeout = '8s'"),
    transaction.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [lockName(input.provider, input.providerSubject)],
    ),
    transaction.query(ATOMIC_ONBOARDING_QUERY, [
      input.provider,
      input.providerSubject,
      input.appUserId,
      input.authIdentityId,
      input.now,
      SELF_SERVICE_TENANT_ONBOARDING_POLICY.appUserStatus,
      SELF_SERVICE_TENANT_ONBOARDING_POLICY.appUserRole,
      SELF_SERVICE_TENANT_ONBOARDING_POLICY.identityStatus,
    ]),
  ]);
  return (results[3]?.[0] ?? {}) as WriteRow;
}

function lockName(provider: string, providerSubject: string) {
  const digest = createHash("sha256")
    .update(provider, "utf8")
    .update("\u0000", "utf8")
    .update(providerSubject, "utf8")
    .digest("hex");
  return `varda.self_service_tenant_onboarding.v1:${digest}`;
}

function toEvidence(row: WriteRow): SelfServiceTenantOnboardingWriteEvidence {
  return Object.freeze({
    existingIdentityCount: Number(row.existing_identity_count ?? 0),
    insertedAppUserCount: Number(row.inserted_app_user_count ?? 0),
    insertedIdentityCount: Number(row.inserted_identity_count ?? 0),
    identityStatus: row.identity_status ?? null,
    appUserStatus: row.app_user_status ?? null,
    appUserRole: row.app_user_role ?? null,
    mappedAppUserMatches: row.mapped_app_user_matches ?? null,
  });
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}

function state(
  status: SelfServiceTenantOnboardingActionState["status"],
  message: string,
): SelfServiceTenantOnboardingActionState {
  return Object.freeze({ status, message });
}

const ATOMIC_ONBOARDING_QUERY = `
with existing_identity as materialized (
  select
    identity_row.id,
    identity_row.app_user_id,
    identity_row.status as identity_status,
    user_row.id as loaded_app_user_id,
    user_row.status as app_user_status,
    user_row.role as app_user_role
  from auth_identities identity_row
  left join app_users user_row
    on user_row.id = identity_row.app_user_id
  where identity_row.provider = $1::varchar
    and identity_row.provider_subject = $2::varchar
  order by identity_row.id
  for update of identity_row
), facts as materialized (
  select count(*)::integer as existing_identity_count
  from existing_identity
), inserted_app_user as (
  insert into app_users (id, status, role, created_at, updated_at)
  select $3::uuid, $6::varchar, $7::varchar, $5::timestamptz, $5::timestamptz
  from facts
  where facts.existing_identity_count = 0
  returning id
), inserted_identity as (
  insert into auth_identities (
    id, app_user_id, provider, provider_subject, status, created_at, updated_at
  )
  select
    $4::uuid,
    inserted_app_user.id,
    $1::varchar,
    $2::varchar,
    $8::varchar,
    $5::timestamptz,
    $5::timestamptz
  from inserted_app_user
  returning id, app_user_id
)
select
  facts.existing_identity_count,
  (select count(*)::integer from inserted_app_user) as inserted_app_user_count,
  (select count(*)::integer from inserted_identity) as inserted_identity_count,
  (select identity_status from existing_identity limit 1) as identity_status,
  (select app_user_status from existing_identity limit 1) as app_user_status,
  (select app_user_role from existing_identity limit 1) as app_user_role,
  (
    select app_user_id = loaded_app_user_id
    from existing_identity
    limit 1
  ) as mapped_app_user_matches
from facts
`;
