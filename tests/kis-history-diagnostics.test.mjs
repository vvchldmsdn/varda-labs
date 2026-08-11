import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatKisHistoryIncompleteError,
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

  it("identifies incomplete instruments without copying provider errors", () => {
    const message = formatKisHistoryIncompleteError({
      coveredCount: 14,
      targetCount: 15,
      failures: [
        failure({
          instrumentKey: "us|USD|VOO",
          code: "transport_error",
          error: "authorization=must-not-be-copied",
        }),
      ],
    });

    assert.equal(
      message,
      "KIS history preview incomplete: covered=14/15, failures=1 [us|USD|VOO:transport_error]",
    );
    assert.doesNotMatch(message, /must-not-be-copied/);
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
