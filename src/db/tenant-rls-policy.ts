import { sql, type SQL } from "drizzle-orm";
import { pgRole, type PgColumn } from "drizzle-orm/pg-core";

import {
  TENANT_CONTEXT_SETTING_NAME,
  TENANT_DATABASE_ROLE_NAME,
} from "../lib/deployment/tenant-security-constants.ts";

export const tenantDatabaseRole = pgRole(
  TENANT_DATABASE_ROLE_NAME,
).existing();

export function currentTenantOwns(column: PgColumn): SQL {
  const settingName = sql.raw(`'${TENANT_CONTEXT_SETTING_NAME}'`);
  return sql`${column} = nullif(current_setting(${settingName}, true), '')::uuid`;
}
