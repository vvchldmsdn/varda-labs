import "server-only";

import { neon } from "@neondatabase/serverless";

import { guardTenantDatabaseRoleBoundary } from "@/lib/deployment/tenant-database-role-boundary";

type TenantSqlClient = ReturnType<typeof neon>;

let cachedTenantClient:
  | Readonly<{
      databaseUrl: string;
      sql: TenantSqlClient;
    }>
  | undefined;

export function getTenantSqlClient(): TenantSqlClient {
  guardTenantDatabaseRoleBoundary(process.env);

  const tenantDatabaseUrl = process.env.TENANT_DATABASE_URL?.trim();
  if (!tenantDatabaseUrl) {
    throw new Error("TENANT_DATABASE_URL is not set");
  }

  if (cachedTenantClient?.databaseUrl === tenantDatabaseUrl) {
    return cachedTenantClient.sql;
  }

  const sql = neon(tenantDatabaseUrl);
  cachedTenantClient = Object.freeze({ databaseUrl: tenantDatabaseUrl, sql });
  return sql;
}
