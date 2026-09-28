import assert from "node:assert/strict";
import { it } from "node:test";
import { summarizeSnapshotProgress, snapshotProgressMessage } from "../src/lib/snapshots/progress.ts";
it("distinguishes failed, blocked and actually running baseline work", () => {
  assert.equal(summarizeSnapshotProgress([{status:"completed"},{status:"failed"}]), "failed");
  assert.equal(summarizeSnapshotProgress([{status:"blocked"},{status:"running"}]), "blocked");
  assert.equal(summarizeSnapshotProgress([{status:"running"},{status:"pending"}]), "running");
  assert.equal(summarizeSnapshotProgress([{status:"completed"},{status:null}]), "unknown");
  assert.equal(summarizeSnapshotProgress([]), "unknown");
  assert.equal(summarizeSnapshotProgress([{status:"completed"}]), "completed");
  assert.match(snapshotProgressMessage("failed").ko, /실패/);
  assert.doesNotMatch(snapshotProgressMessage("failed").ko, /저장하고/);
});