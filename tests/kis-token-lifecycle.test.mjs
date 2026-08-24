import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getReusableKisAccessToken } from "../src/lib/market-data/providers/kis-token-lifecycle.ts";

describe("KIS token lifecycle", () => {
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
});
