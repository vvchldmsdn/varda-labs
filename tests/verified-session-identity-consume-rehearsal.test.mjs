import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  readVerifiedSessionIdentityConsumeRehearsalOptions,
} from "../scripts/rehearse-verified-session-identity-consume.mjs";

const CONFIRMATION =
  "--confirm-isolated-verified-session-identity-consume-rehearsal";

describe("verified-session identity consume rehearsal boundary", () => {
  it("accepts only the exact disposable rehearsal confirmation", () => {
    assert.deepEqual(
      readVerifiedSessionIdentityConsumeRehearsalOptions([
        CONFIRMATION,
      ]),
      { confirmed: true },
    );
    assert.throws(
      () =>
        readVerifiedSessionIdentityConsumeRehearsalOptions([]),
      { code: "rehearsal_confirmation_invalid" },
    );
    assert.throws(
      () =>
        readVerifiedSessionIdentityConsumeRehearsalOptions([
          CONFIRMATION,
          "--retry",
        ]),
      { code: "rehearsal_confirmation_invalid" },
    );
  });

  it("connects only the verified-session consume composition and atomic writer", () => {
    const source = readFileSync(
      "scripts/rehearse-verified-session-identity-consume.mjs",
      "utf8",
    );

    assert.match(source, /executeVerifiedSessionIdentityConsume/);
    assert.match(source, /createVerifiedSessionConsumeCapability/);
    assert.match(source, /consumeIdentityPairingClaim/);
    assert.doesNotMatch(
      source,
      /identity-bootstrap-claim-issuer|legacy-account-owner-assignment-writer/,
    );
    assert.doesNotMatch(
      source,
      /db:migrate|drizzle-kit migrate|src\/app\/api/,
    );
  });

  it("keeps the rehearsal to success, pre-writer mismatch, and rollback evidence", () => {
    const source = readFileSync(
      "scripts/rehearse-verified-session-identity-consume.mjs",
      "utf8",
    );

    assert.match(source, /matching_consume/);
    assert.match(
      source,
      /session_binding_mismatch_before_writer_dml/,
    );
    assert.match(
      source,
      /writer_rollback_and_one_shot_consumption/,
    );
    assert.match(source, /writerInvoked, false/);
    assert.match(source, /sessionCapabilityAvailable\(\), false/);
    assert.match(source, /productionDatabaseWrites: 0/);
    assert.match(source, /issuerInvocations: 0/);
    assert.match(source, /accountOwnerAssignmentInvocations: 0/);
  });
});
