import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acquireBodyScrollLock } from "../src/lib/body-scroll-lock.ts";

describe("nested dialog body scroll ownership", () => {
  it("keeps the outer lock when an inner dialog closes", () => {
    const body = { style: { overflow: "auto" } };
    const closeOuter = acquireBodyScrollLock(body);
    const closeInner = acquireBodyScrollLock(body);
    closeInner();
    assert.equal(body.style.overflow, "hidden");
    closeOuter();
    assert.equal(body.style.overflow, "auto");
  });

  it("restores the original style after outer-first unmount cleanup", () => {
    const body = { style: { overflow: "" } };
    const closeOuter = acquireBodyScrollLock(body);
    const closeInner = acquireBodyScrollLock(body);
    closeOuter();
    assert.equal(body.style.overflow, "hidden");
    closeInner();
    assert.equal(body.style.overflow, "");
  });

  it("ignores repeated cleanup without releasing another modal's lock", () => {
    const body = { style: { overflow: "scroll" } };
    const closeFirst = acquireBodyScrollLock(body);
    const closeSecond = acquireBodyScrollLock(body);
    closeFirst();
    closeFirst();
    assert.equal(body.style.overflow, "hidden");
    closeSecond();
    assert.equal(body.style.overflow, "scroll");
  });

  it("keeps separate documents independent and reacquires the latest base style", () => {
    const first = { style: { overflow: "" } };
    const second = { style: { overflow: "clip" } };
    const closeFirst = acquireBodyScrollLock(first);
    const closeSecond = acquireBodyScrollLock(second);
    closeFirst();
    assert.equal(first.style.overflow, "");
    assert.equal(second.style.overflow, "hidden");
    closeSecond();
    assert.equal(second.style.overflow, "clip");
    first.style.overflow = "auto";
    acquireBodyScrollLock(first)();
    assert.equal(first.style.overflow, "auto");
  });
});
