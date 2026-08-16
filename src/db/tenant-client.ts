import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { guardTenantDatabaseRoleBoundary } from "@/lib/deployment/tenant-database-role-boundary";

import * as schema from "./schema";

export const tenantDatabaseRoleBoundary = guardTenantDatabaseRoleBoundary(
  process.env,
);

const tenantDatabaseUrl = process.env.TENANT_DATABASE_URL;
if (!tenantDatabaseUrl) {
  throw new Error("TENANT_DATABASE_URL is not set");
}

export const tenantSqlClient = neon(tenantDatabaseUrl);
export const tenantDb = drizzle(tenantSqlClient, { schema });
