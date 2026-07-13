import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIMULATION_SCENARIO_VECTOR_HASH_V2_GATE0_APPROVAL_COMMIT,
  SIMULATION_SCENARIO_VECTOR_HASH_V2_PORTFOLIO_PATH_POLICY_ID,
  SIMULATION_SCENARIO_VECTOR_HASH_V2_VERSION,
  compareSimulationScenarioVectorHashV2Rows,
} from "../src/lib/simulation-scenario-vector-hash-v2-policy.ts";
import { createSimulationScenarioVectorHashV2 } from "../src/lib/simulation-scenario-vector-hash-v2.ts";
import {
  SIMULATION_SCENARIO_VECTOR_HASH_V2_PINNED_CANONICAL_JSON,
  SIMULATION_SCENARIO_VECTOR_HASH_V2_PINNED_DIGEST,
  createSimulationScenarioVectorHashV2PunctuationInput,
} from "./fixtures/simulation-scenario-vector-hash-v2.mjs";

describe("Simulation Scenario Vector Hash v2", () => {
  it("pins the exact synthetic canonical JSON and SHA-256 digest", () => {
    const result = createSimulationScenarioVectorHashV2(
      createSimulationScenarioVectorHashV2PunctuationInput(),
    );

    assert.equal(result.status, "hashable");
    assert.equal(result.hashVersion, SIMULATION_SCENARIO_VECTOR_HASH_V2_VERSION);
    assert.equal(
      result.portfolioPathPolicyId,
      SIMULATION_SCENARIO_VECTOR_HASH_V2_PORTFOLIO_PATH_POLICY_ID,
    );
    assert.equal(
      result.gate0ApprovalCommit,
      SIMULATION_SCENARIO_VECTOR_HASH_V2_GATE0_APPROVAL_COMMIT,
    );
    assert.equal(
      result.canonicalSerialization,
      SIMULATION_SCENARIO_VECTOR_HASH_V2_PINNED_CANONICAL_JSON,
    );
    assert.equal(result.scenarioVectorHash, SIMULATION_SCENARIO_VECTOR_HASH_V2_PINNED_DIGEST);
    assert.equal(Buffer.byteLength(result.canonicalSerialization, "utf8"), 393);
  });

  it("is independent of source row order and uses exact ASCII ordering", () => {
    const input = createSimulationScenarioVectorHashV2PunctuationInput();
    const reversed = {
      ...input,
      vector: [...input.vector].reverse(),
    };
    const baseline = createSimulationScenarioVectorHashV2(input);
    const reordered = createSimulationScenarioVectorHashV2(reversed);
    const localeCompare = String.prototype.localeCompare;
    let withoutLocale;

    try {
      String.prototype.localeCompare = () => {
        throw new Error("localeCompare must not be called");
      };
      withoutLocale = createSimulationScenarioVectorHashV2(input);
    } finally {
      String.prototype.localeCompare = localeCompare;
    }

    assert.equal(baseline.status, "hashable");
    assert.equal(reordered.status, "hashable");
    assert.equal(withoutLocale.status, "hashable");
    assert.equal(reordered.canonicalSerialization, baseline.canonicalSerialization);
    assert.equal(reordered.scenarioVectorHash, baseline.scenarioVectorHash);
    assert.equal(withoutLocale.scenarioVectorHash, baseline.scenarioVectorHash);
    assert.equal(
      compareSimulationScenarioVectorHashV2Rows(
        { market: "us", currency: "USD", ticker: "A.B" },
        { market: "us", currency: "USD", ticker: "A:B" },
      ),
      -1,
    );
  });

  it("binds every approved identity and weight field to the digest", () => {
    const baseline = requireHashable(
      createSimulationScenarioVectorHashV2(baseInput()),
    );
    const variants = [
      baseInput({ scenarioId: "synthetic-other-scenario" }),
      baseInput({ scenarioVersion: "v2-fixture-2" }),
      baseInput({
        vector: [
          row("A.B", 5_000, { market: "eu" }),
          row("A:B", 5_000),
        ],
      }),
      baseInput({
        vector: [
          row("A.B", 5_000, { currency: "EUR" }),
          row("A:B", 5_000),
        ],
      }),
      baseInput({ vector: [row("A-C", 5_000), row("A:B", 5_000)] }),
      baseInput({ vector: [row("A.B", 4_999), row("A:B", 5_001)] }),
      baseInput({
        vector: [row("A.B", 5_000), row("A:B", 5_000), row("ZERO", 0)],
      }),
    ];

    for (const input of variants) {
      const result = requireHashable(createSimulationScenarioVectorHashV2(input));
      assert.notEqual(result.scenarioVectorHash, baseline.scenarioVectorHash);
    }
  });

  it("preserves explicit zero-bps rows", () => {
    const result = requireHashable(
      createSimulationScenarioVectorHashV2(
        baseInput({
          vector: [row("A", 10_000), row("ZERO", 0)],
        }),
      ),
    );

    assert.equal(result.rowCount, 2);
    assert.equal(result.zeroWeightRowCount, 1);
    assert.match(result.canonicalSerialization, /"ticker":"ZERO","weightBps":0/);
  });

  it("enforces empty, one-row, 64-row, and 65-row boundaries", () => {
    const empty = createSimulationScenarioVectorHashV2(baseInput({ vector: [] }));
    const one = createSimulationScenarioVectorHashV2(
      baseInput({ vector: [row("ONLY", 10_000)] }),
    );
    const sixtyFour = createSimulationScenarioVectorHashV2(
      baseInput({ vector: boundedRows(64) }),
    );
    const sixtyFive = createSimulationScenarioVectorHashV2(
      baseInput({ vector: boundedRows(65) }),
    );

    assert.deepEqual(empty.blockers, [
      "source_vector_empty",
      "source_vector_total_not_10000_bps",
    ]);
    assert.equal(empty.rowCount, 0);
    assert.equal(empty.zeroWeightRowCount, 0);
    assert.equal(empty.totalWeightBps, 0);
    assert.equal(one.status, "hashable");
    assert.equal(sixtyFour.status, "hashable");
    assertBlockers(sixtyFive, ["source_vector_row_cap_exceeded"]);
    assert.equal(sixtyFive.rowCount, null);
  });

  it("rejects duplicate identities but keeps equal tickers distinct across identity axes", () => {
    const duplicate = createSimulationScenarioVectorHashV2(
      baseInput({ vector: [row("SAME", 5_000), row("SAME", 5_000)] }),
    );
    const distinct = createSimulationScenarioVectorHashV2(
      baseInput({
        vector: [
          row("SAME", 5_000, { market: "korea", currency: "KRW" }),
          row("SAME", 5_000, { market: "us", currency: "USD" }),
        ],
      }),
    );

    assertBlockers(duplicate, ["duplicate_instrument_identity"]);
    assert.equal(distinct.status, "hashable");
  });

  it("rejects invalid scenario and instrument strings without normalization", () => {
    for (const scenarioId of ["", " leading", "bad value", "é", "A".repeat(101)]) {
      assertHasBlocker(
        createSimulationScenarioVectorHashV2(baseInput({ scenarioId })),
        "invalid_scenario_id",
      );
    }
    for (const scenarioVersion of ["", "bad value", "A".repeat(101)]) {
      assertHasBlocker(
        createSimulationScenarioVectorHashV2(baseInput({ scenarioVersion })),
        "invalid_scenario_version",
      );
    }

    const invalidRows = [
      row("A", 10_000, { market: "US" }),
      row("A", 10_000, { currency: "usd" }),
      row("a", 10_000),
      row("BAD VALUE", 10_000),
      row("A".repeat(51), 10_000),
    ];
    for (const invalidRow of invalidRows) {
      assertHasBlocker(
        createSimulationScenarioVectorHashV2(baseInput({ vector: [invalidRow] })),
        "invalid_instrument_identity",
      );
    }
  });

  it("accepts exact three-letter currencies independently of planner support", () => {
    const result = createSimulationScenarioVectorHashV2(
      baseInput({ vector: [row("SYNTH", 10_000, { currency: "EUR" })] }),
    );

    assert.equal(result.status, "hashable");
  });

  it("rejects invalid weights, including JavaScript negative zero", () => {
    for (const weightBps of [
      "10000",
      null,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      -0,
      1.5,
      10_001,
    ]) {
      const result = createSimulationScenarioVectorHashV2(
        baseInput({ vector: [row("ONLY", weightBps)] }),
      );
      assertBlockers(result, ["invalid_weight_bps"]);
      assert.equal(result.totalWeightBps, null);
      assert.equal(result.canonicalSerialization, null);
      assert.equal(result.scenarioVectorHash, null);
    }

    assertBlockers(
      createSimulationScenarioVectorHashV2(
        baseInput({ vector: [row("ONLY", 9_999)] }),
      ),
      ["source_vector_total_not_10000_bps"],
    );
  });

  it("returns unique blockers in the frozen policy order", () => {
    const result = createSimulationScenarioVectorHashV2({
      scenarioId: "bad value",
      scenarioVersion: "",
      vector: [
        row("DUP", 5_000),
        row("DUP", 5_000),
        row("bad", 0),
      ],
    });

    assertBlockers(result, [
      "invalid_scenario_id",
      "invalid_scenario_version",
      "invalid_instrument_identity",
      "duplicate_instrument_identity",
    ]);
    assert.equal(new Set(result.blockers).size, result.blockers.length);
    assert.equal(result.canonicalSerialization, null);
    assert.equal(result.scenarioVectorHash, null);
  });

  it("does not mutate or retain mutable input rows", () => {
    const input = baseInput();
    const originalOrder = input.vector.map((item) => item.ticker);
    const success = createSimulationScenarioVectorHashV2(input);
    const failureInput = baseInput({ vector: [row("ONLY", 9_999)] });
    const failureCopy = structuredClone(failureInput);
    const failure = createSimulationScenarioVectorHashV2(failureInput);

    input.vector[0].ticker = "MUTATED";

    assert.equal(success.status, "hashable");
    assert.deepEqual(originalOrder, ["A.B", "A:B"]);
    assert.match(success.canonicalSerialization, /"ticker":"A.B"/);
    assert.doesNotMatch(success.canonicalSerialization, /MUTATED/);
    assert.deepEqual(failureInput, failureCopy);
    assert.equal(failure.status, "invalid");
  });

  it("rejects non-plain outer and row records, accessors, and extra keys without invoking getters", () => {
    const outerGetterInput = baseInput();
    let outerGetterCalls = 0;
    Object.defineProperty(outerGetterInput, "vector", {
      enumerable: true,
      configurable: true,
      get() {
        outerGetterCalls += 1;
        return [];
      },
    });

    const rowGetter = row("ONLY", 10_000);
    let rowGetterCalls = 0;
    Object.defineProperty(rowGetter, "ticker", {
      enumerable: true,
      configurable: true,
      get() {
        rowGetterCalls += 1;
        return "ONLY";
      },
    });

    const extraOuter = { ...baseInput(), extra: true };
    const symbolOuter = baseInput();
    symbolOuter[Symbol("extra")] = true;
    const nullPrototypeOuter = Object.assign(Object.create(null), baseInput());
    const extraRow = { ...row("ONLY", 10_000), extra: true };

    for (const input of [
      null,
      [],
      nullPrototypeOuter,
      extraOuter,
      symbolOuter,
      outerGetterInput,
      baseInput({ vector: [rowGetter] }),
      baseInput({ vector: [extraRow] }),
    ]) {
      assertHasBlocker(
        createSimulationScenarioVectorHashV2(input),
        "invalid_input_shape",
      );
    }
    assert.equal(outerGetterCalls, 0);
    assert.equal(rowGetterCalls, 0);
  });

  it("enforces a dense ordinary vector array without invoking index accessors", () => {
    const sparse = new Array(1);
    const accessor = new Array(1);
    let accessorCalls = 0;
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      configurable: true,
      get() {
        accessorCalls += 1;
        return row("ONLY", 10_000);
      },
    });
    const extraNamed = [row("ONLY", 10_000)];
    extraNamed.extra = true;
    const symbolKeyed = [row("ONLY", 10_000)];
    symbolKeyed[Symbol("extra")] = true;
    const nonstandardPrototype = [row("ONLY", 10_000)];
    Object.setPrototypeOf(nonstandardPrototype, Object.create(Array.prototype));

    for (const vector of [
      sparse,
      accessor,
      extraNamed,
      symbolKeyed,
      nonstandardPrototype,
    ]) {
      assertHasBlocker(
        createSimulationScenarioVectorHashV2(baseInput({ vector })),
        "invalid_input_shape",
      );
    }
    assert.equal(accessorCalls, 0);
  });

  it("rejects a hole even when an inherited numeric index exists", () => {
    const priorDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    let result;

    try {
      Object.defineProperty(Array.prototype, "0", {
        value: row("INHERITED", 10_000),
        enumerable: false,
        writable: true,
        configurable: true,
      });
      result = createSimulationScenarioVectorHashV2(
        baseInput({ vector: new Array(1) }),
      );
    } finally {
      restorePropertyDescriptor(Array.prototype, "0", priorDescriptor);
    }

    assertHasBlocker(result, "invalid_input_shape");
  });

  it(
    "keeps canonical bytes stable under inherited Object and Array toJSON hooks",
    { concurrency: false },
    () => {
      const priorObjectDescriptor = Object.getOwnPropertyDescriptor(
        Object.prototype,
        "toJSON",
      );
      const priorArrayDescriptor = Object.getOwnPropertyDescriptor(
        Array.prototype,
        "toJSON",
      );
      let result;

      try {
        Object.defineProperty(Object.prototype, "toJSON", {
          value() {
            return "corrupted-object";
          },
          enumerable: false,
          writable: true,
          configurable: true,
        });
        Object.defineProperty(Array.prototype, "toJSON", {
          value() {
            return ["corrupted-array"];
          },
          enumerable: false,
          writable: true,
          configurable: true,
        });
        result = createSimulationScenarioVectorHashV2(
          createSimulationScenarioVectorHashV2PunctuationInput(),
        );
      } finally {
        restorePropertyDescriptor(
          Object.prototype,
          "toJSON",
          priorObjectDescriptor,
        );
        restorePropertyDescriptor(
          Array.prototype,
          "toJSON",
          priorArrayDescriptor,
        );
      }

      assert.equal(result.status, "hashable");
      assert.equal(
        result.canonicalSerialization,
        SIMULATION_SCENARIO_VECTOR_HASH_V2_PINNED_CANONICAL_JSON,
      );
      assert.equal(
        result.scenarioVectorHash,
        SIMULATION_SCENARIO_VECTOR_HASH_V2_PINNED_DIGEST,
      );
    },
  );

  it("freezes hashable and invalid results and nested blocker arrays", () => {
    const success = createSimulationScenarioVectorHashV2(baseInput());
    const invalid = createSimulationScenarioVectorHashV2(
      baseInput({ vector: [row("ONLY", -0)] }),
    );

    assert.equal(Object.isFrozen(success), true);
    assert.equal(Object.isFrozen(invalid), true);
    assert.equal(Object.isFrozen(invalid.blockers), true);
  });
});

function baseInput(overrides = {}) {
  return {
    scenarioId: "synthetic-punctuation-order",
    scenarioVersion: "v2-fixture-1",
    vector: [row("A.B", 5_000), row("A:B", 5_000)],
    ...overrides,
  };
}

function row(ticker, weightBps, overrides = {}) {
  return {
    market: "us",
    currency: "USD",
    ticker,
    weightBps,
    ...overrides,
  };
}

function boundedRows(count) {
  return Array.from({ length: count }, (_, index) =>
    row(`T${String(index).padStart(2, "0")}`, index === 0 ? 10_001 - count : 1),
  );
}

function requireHashable(result) {
  assert.equal(result.status, "hashable", JSON.stringify(result));
  return result;
}

function assertBlockers(result, expected) {
  assert.equal(result.status, "invalid", JSON.stringify(result));
  assert.deepEqual(result.blockers, expected);
}

function assertHasBlocker(result, expected) {
  assert.equal(result.status, "invalid", JSON.stringify(result));
  assert.ok(result.blockers.includes(expected), JSON.stringify(result.blockers));
}

function restorePropertyDescriptor(target, property, descriptor) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    delete target[property];
  }
}
