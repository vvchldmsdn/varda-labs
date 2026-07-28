import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { projectTenantAccountRows } from "../src/lib/tenant-account-read-model.ts";

const ROWS = Object.freeze([
  Object.freeze({
    code: "irp",
    name: "IRP",
    accountType: "irp",
    currency: "KRW",
    sortOrder: 30,
  }),
  Object.freeze({
    code: "brokerage",
    name: "Brokerage",
    accountType: "brokerage",
    currency: "KRW",
    sortOrder: 10,
  }),
  Object.freeze({
    code: "isa",
    name: "ISA",
    accountType: "isa",
    currency: "KRW",
    sortOrder: 20,
  }),
]);

describe("tenant account read model", () => {
  it("projects the canonical all scope in sort order without owner fields", () => {
    const result = projectTenantAccountRows(ROWS, "all");

    assert.deepEqual(result, {
      state: "ready",
      scope: "all",
      accounts: [
        {
          code: "brokerage",
          name: "Brokerage",
          accountType: "brokerage",
          currency: "KRW",
        },
        {
          code: "isa",
          name: "ISA",
          accountType: "isa",
          currency: "KRW",
        },
        {
          code: "irp",
          name: "IRP",
          accountType: "irp",
          currency: "KRW",
        },
      ],
    });
    assert.doesNotMatch(
      JSON.stringify(result),
      /owner|provider|subject|email/i,
    );
  });

  it("applies a named account only after accepting canonical rows", () => {
    assert.deepEqual(projectTenantAccountRows(ROWS, "isa"), {
      state: "ready",
      scope: "isa",
      accounts: [
        {
          code: "isa",
          name: "ISA",
          accountType: "isa",
          currency: "KRW",
        },
      ],
    });
  });

  it("fails closed for duplicate or noncanonical account identities", () => {
    assert.deepEqual(
      projectTenantAccountRows([...ROWS, ROWS[0]], "all"),
      {
        state: "integrity_error",
        reason: "duplicate_account_code",
      },
    );
    assert.deepEqual(
      projectTenantAccountRows(
        [{ ...ROWS[0], code: "IRP" }],
        "all",
      ),
      {
        state: "integrity_error",
        reason: "noncanonical_account_code",
      },
    );
  });

  it("fails closed instead of exposing malformed account metadata", () => {
    assert.deepEqual(
      projectTenantAccountRows(
        [{ ...ROWS[0], name: " IRP" }],
        "all",
      ),
      {
        state: "integrity_error",
        reason: "invalid_account_metadata",
      },
    );
  });
});
