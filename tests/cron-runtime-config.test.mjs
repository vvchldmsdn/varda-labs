import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCronRuntimeConfigStatus } from "../src/lib/cron-runtime-config.ts";

describe("Cron runtime configuration status", () => {
  it("requires both the write gate and Vercel Cron secret", () => {
    assert.deepEqual(
      buildCronRuntimeConfigStatus({
        MARKET_CYCLE_CRON_WRITE_ENABLED: "true",
        CRON_SECRET: "cron-secret",
        ADMIN_JOB_SECRET: "admin-secret",
      }),
      {
        writeGateEnabled: true,
        cronSecretConfigured: true,
        adminJobSecretConfigured: true,
        scheduledExecutionReady: true,
      },
    );
  });

  it("does not treat the manual admin secret as scheduled auth", () => {
    assert.deepEqual(
      buildCronRuntimeConfigStatus({
        MARKET_CYCLE_CRON_WRITE_ENABLED: "true",
        ADMIN_JOB_SECRET: "admin-secret",
      }),
      {
        writeGateEnabled: true,
        cronSecretConfigured: false,
        adminJobSecretConfigured: true,
        scheduledExecutionReady: false,
      },
    );
  });

  it("exposes booleans only and keeps an exact write-gate match", () => {
    const status = buildCronRuntimeConfigStatus({
      MARKET_CYCLE_CRON_WRITE_ENABLED: "TRUE",
      CRON_SECRET: "   ",
      ADMIN_JOB_SECRET: "admin-secret",
    });

    assert.equal(status.writeGateEnabled, false);
    assert.equal(status.cronSecretConfigured, false);
    assert.doesNotMatch(JSON.stringify(status), /admin-secret|CRON_SECRET/);
  });
});
