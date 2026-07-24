import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatKisHistoryNoRowsError,
  summarizeKisHistoryProviderResult,
} from "../src/lib/market-data/kis-history-diagnostics.ts";

describe("KIS history provider diagnostics", () => {
  it("keeps aggregate failure categories without copying raw errors", () => {
    const diagnostics = summarizeKisHistoryProviderResult({
      requestCount: 0,
      rows: [],
      failures: [
        failure({
          code: "provider_auth_error",
          error: "access_token=must-not-be-copied",
        }),
        failure({
          code: "provider_auth_error",
          error: "authorization=must-not-be-copied",
        }),
      ],
    });

    assert.deepEqual(diagnostics, {
      requestCount: 0,
      fetchedRowCount: 0,
      providerFailureCount: 2,
      failureCodes: {
        provider_auth_error: 2,
      },
    });
    assert.doesNotMatch(JSON.stringify(diagnostics), /must-not-be-copied/);
    assert.equal(
      formatKisHistoryNoRowsError(diagnostics),
      "KIS history returned no cacheable rows (provider_auth_error:2)",
    );
  });

  it("keeps the generic message when the provider reports no failure row", () => {
    const diagnostics = summarizeKisHistoryProviderResult({
      requestCount: 1,
      rows: [],
      failures: [],
    });

    assert.equal(
      formatKisHistoryNoRowsError(diagnostics),
      "KIS history returned no cacheable rows",
    );
  });
});

function failure(overrides) {
  return {
    instrumentKey: "korea|KRW|069500",
    ticker: "069500",
    market: "korea",
    currency: "KRW",
    startDate: "2026-07-09",
    endDate: "2026-07-10",
    code: "transport_error",
    error: "synthetic failure",
    ...overrides,
  };
}
