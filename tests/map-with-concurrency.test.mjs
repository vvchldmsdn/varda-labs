import assert from "node:assert/strict";
import test from "node:test";

import { mapWithConcurrency } from "../src/lib/async/map-with-concurrency.ts";

test("mapWithConcurrency preserves input order and enforces the limit", async () => {
  let active = 0;
  let maximumActive = 0;
  const result = await mapWithConcurrency([30, 5, 20, 1], 2, async (delay) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active -= 1;
    return delay * 2;
  });

  assert.deepEqual(result, [60, 10, 40, 2]);
  assert.equal(maximumActive, 2);
});

test("mapWithConcurrency stops scheduling new work after a failure", async () => {
  const started = [];

  await assert.rejects(
    mapWithConcurrency([0, 1, 2, 3], 1, async (value) => {
      started.push(value);
      if (value === 1) throw new Error("expected failure");
      return value;
    }),
    /expected failure/,
  );

  assert.deepEqual(started, [0, 1]);
});

test("mapWithConcurrency preserves an undefined rejection", async () => {
  await assert.rejects(
    mapWithConcurrency([1], 1, async () => Promise.reject(undefined)),
    (error) => error === undefined,
  );
});

test("mapWithConcurrency rejects invalid concurrency", async () => {
  await assert.rejects(
    mapWithConcurrency([1], 0, async (value) => value),
    /positive safe integer/,
  );
});
