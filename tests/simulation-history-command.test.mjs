import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseSimulationHistoryCommandArgs,
  SimulationHistoryCommandInputError,
} from "../src/lib/market-data/simulation-history-command.ts";

describe("simulation history completion command", () => {
  const dates = ["--from", "2026-02-05", "--to", "2026-08-03"];

  it("defaults to a provider-free plan", () => {
    assert.deepEqual(parseSimulationHistoryCommandArgs(dates), {
      startDate: "2026-02-05",
      endDate: "2026-08-03",
      mode: "plan_only",
    });
  });

  it("requires an explicit flag before consuming a provider token", () => {
    assert.equal(
      parseSimulationHistoryCommandArgs([...dates, "--provider-dry-run"]).mode,
      "provider_dry_run",
    );
  });

  it("requires both write guards", () => {
    assert.equal(
      parseSimulationHistoryCommandArgs([
        ...dates,
        "--write",
        "--confirm-shared-history-write",
      ]).mode,
      "write",
    );
    assert.throws(
      () => parseSimulationHistoryCommandArgs([...dates, "--write"]),
      SimulationHistoryCommandInputError,
    );
  });

  it("rejects provider dry-run combined with write flags", () => {
    assert.throws(
      () =>
        parseSimulationHistoryCommandArgs([
          ...dates,
          "--provider-dry-run",
          "--write",
          "--confirm-shared-history-write",
        ]),
      SimulationHistoryCommandInputError,
    );
  });
});
