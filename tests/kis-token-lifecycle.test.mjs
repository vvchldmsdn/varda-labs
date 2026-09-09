import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getReusableKisAccessToken, KisTokenCooldownError } from "../src/lib/market-data/providers/kis-token-lifecycle.ts";

describe("KIS token lifecycle", () => {
  it("coalesces concurrent token issuance inside one request session", async () => {
    let issueCount = 0;
    let release;
    const issued = new Promise((resolve) => {
      release = resolve;
    });
    const session = { tokenCache: null, tokenRequest: null };
    const options = {
      cacheKey: "same-request-concurrent",
      policy: "per_request",
      session,
      now: () => 1_000,
      issueToken: async () => {
        issueCount += 1;
        await issued;
        return { accessToken: "shared-request-token", expiresInSeconds: 3600 };
      },
    };

    const first = getReusableKisAccessToken(options);
    const second = getReusableKisAccessToken(options);
    release();

    assert.deepEqual(await Promise.all([first, second]), [
      "shared-request-token",
      "shared-request-token",
    ]);
    assert.equal(issueCount, 1);
    assert.equal(session.tokenRequest, null);
  });

  it("reuses one token in the same provider session", async () => {
    let issueCount = 0;
    const session = { tokenCache: null };
    const options = {
      cacheKey: "same-session",
      policy: "per_request",
      session,
      now: () => 1_000,
      issueToken: async () => ({
        accessToken: `token-${++issueCount}`,
        expiresInSeconds: 3600,
      }),
    };

    assert.equal(await getReusableKisAccessToken(options), "token-1");
    assert.equal(await getReusableKisAccessToken(options), "token-1");
    assert.equal(issueCount, 1);
  });

  it("reuses an unexpired token across provider sessions in one warm instance", async () => {
    let issueCount = 0;
    const common = {
      cacheKey: "warm-instance",
      policy: "memory_cache",
      now: () => 1_000,
      issueToken: async () => ({
        accessToken: `token-${++issueCount}`,
        expiresInSeconds: 3600,
      }),
    };

    assert.equal(await getReusableKisAccessToken({
      ...common,
      session: { tokenCache: null },
    }), "token-1");
    assert.equal(await getReusableKisAccessToken({
      ...common,
      session: { tokenCache: null },
    }), "token-1");
    assert.equal(issueCount, 1);
  });

  it("coalesces simultaneous issue requests for the same credentials", async () => {
    let issueCount = 0;
    let release;
    const issued = new Promise((resolve) => { release = resolve; });
    const common = {
      cacheKey: "concurrent",
      policy: "memory_cache",
      now: () => 1_000,
      issueToken: async () => {
        issueCount += 1;
        await issued;
        return { accessToken: "shared-token", expiresInSeconds: 3600 };
      },
    };
    const first = getReusableKisAccessToken({
      ...common,
      session: { tokenCache: null },
    });
    const second = getReusableKisAccessToken({
      ...common,
      session: { tokenCache: null },
    });

    release();
    assert.deepEqual(await Promise.all([first, second]), ["shared-token", "shared-token"]);
    assert.equal(issueCount, 1);
  });

  it("issues a replacement when the cached token is inside the expiry safety window", async () => {
    let issueCount = 0;
    let currentTime = 1_000;
    const session = { tokenCache: null };
    const options = {
      cacheKey: "expiry",
      policy: "memory_cache",
      session,
      now: () => currentTime,
      issueToken: async () => ({
        accessToken: `token-${++issueCount}`,
        expiresInSeconds: 120,
      }),
    };

    assert.equal(await getReusableKisAccessToken(options), "token-1");
    currentTime += 61_000;
    assert.equal(await getReusableKisAccessToken(options), "token-2");
    assert.equal(issueCount, 2);
  });

  it("coalesces a failed issue and prevents immediate retries across warm sessions", async () => {
    let currentTime = 1_000;
    let issueCount = 0;
    const failure = new Error("provider returned a private failure body");
    const options = {
      cacheKey: "failure-shared-warm", policy: "memory_cache", now: () => currentTime,
      issueToken: async () => {
        issueCount++;
        if (issueCount === 1) throw failure;
        return { accessToken: "recovered-token", expiresInSeconds: 3600 };
      },
    };
    const results = await Promise.allSettled([
      getReusableKisAccessToken({ ...options, session: { tokenCache: null } }),
      getReusableKisAccessToken({ ...options, session: { tokenCache: null } }),
    ]);
    assert.equal(issueCount, 1);
    assert.ok(results.every(result => result.status === "rejected" && result.reason === failure));
    await assert.rejects(getReusableKisAccessToken({ ...options, session: { tokenCache: null } }), error => {
      assert.ok(error instanceof KisTokenCooldownError);
      assert.equal(error.retryAfterSeconds, 60);
      assert.doesNotMatch(error.message, /private failure body/);
      return true;
    });
    assert.equal(issueCount, 1);
    currentTime += 60_000;
    assert.equal(await getReusableKisAccessToken({ ...options, session: { tokenCache: null } }), "recovered-token");
    assert.equal(issueCount, 2);
  });

  it("retains failure cooldown within per-request sessions, including synchronous issuers", async () => {
    const session = { tokenCache: null };
    let calls = 0;
    const options = { cacheKey: "failure-request", policy: "per_request", session, now: () => 100,
      issueToken: () => { calls++; throw new Error("synchronous fixture failure"); } };
    await assert.rejects(getReusableKisAccessToken(options), /synchronous fixture failure/);
    assert.equal(session.tokenRequest, null);
    await assert.rejects(getReusableKisAccessToken(options), KisTokenCooldownError);
    assert.equal(calls, 1);
    // A different credential scope is not blocked by another scope's failure.
    const other = { ...options, cacheKey: "different-request-scope", issueToken: async () => ({ accessToken: "other-token", expiresInSeconds: 3600 }) };
    assert.equal(await getReusableKisAccessToken(other), "other-token");
  });

  it("honors longer provider backoff and bounds malformed retry timings", async () => {
    for (const [index, retryAfterSeconds, expected] of [[0, 180, 180], [1, Infinity, 60], [2, -1, 60], [3, 100_000, 3600]]) {
      const session = { tokenCache: null };
      const options = { cacheKey: `retry-timing-${index}`, policy: "per_request", session, now: () => 0,
        issueToken: async () => { throw Object.assign(new Error("fixture backoff"), { retryAfterSeconds }); } };
      await assert.rejects(getReusableKisAccessToken(options), /fixture backoff/);
      await assert.rejects(getReusableKisAccessToken(options), error => error instanceof KisTokenCooldownError && error.retryAfterSeconds === expected);
    }
  });
});
