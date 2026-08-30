import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Auth } from "@auth/core";
import { getToken } from "@auth/core/jwt";
import { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies/index.js";
import {
  createReviewedAuthRequest,
  createSocialSignInBody,
} from "../src/lib/auth/auth-transport-api-contract.ts";
import {
  isEmailPasswordEnabled,
  isGitHubAuthEnabled,
  AUTH_EMAIL_VERIFIED_PATH,
  AUTH_PASSWORD_RESET_PATH,
} from "../src/lib/auth/auth-methods.ts";
import { readBoundedAuthBody } from "../src/lib/auth/auth-request-validation.ts";
import { authErrorMessage } from "../src/lib/auth/auth-error-message.ts";
import { createNaverAuthConfig } from "../src/lib/auth/naver-auth-config.ts";
import {
  assessNaverAuthEnvironment,
  canonicalNaverAuthOrigin,
  isNaverAuthorizationUrl,
  NAVER_AUTH_SESSION_COOKIE,
  NAVER_AUTH_SESSION_MAX_AGE,
} from "../src/lib/auth/naver-auth-policy.ts";
import {
  createReviewedNaverAuthRequest,
  expireNaverSessionCookies,
  finalizeNaverAuthCallback,
} from "../src/lib/auth/naver-auth-request.ts";
import {
  resolveProviderSessions,
  verifiedProviderSession,
} from "../src/lib/auth/provider-session-contract.ts";

const ORIGIN = "https://app.example.invalid";
const EMAIL = "new-member@example.invalid";
const PASSWORD = "  private passphrase  ";
const SECRET = "test-only-auth-secret-not-a-production-credential";
const NAVER_SUBJECT = "naver-opaque-subject";
const resetToken = "test-only-reset-token-1234567890";
const acceptedBodies = new Map([
  [
    "sign-in/email",
    { email: EMAIL, password: PASSWORD, callbackURL: "/auth/session" },
  ],
  [
    "sign-up/email",
    {
      name: "Member",
      email: EMAIL,
      password: PASSWORD,
      callbackURL: AUTH_EMAIL_VERIFIED_PATH,
    },
  ],
  [
    "send-verification-email",
    { email: EMAIL, callbackURL: AUTH_EMAIL_VERIFIED_PATH },
  ],
  [
    "request-password-reset",
    { email: EMAIL, redirectTo: AUTH_PASSWORD_RESET_PATH },
  ],
  ["reset-password", { newPassword: PASSWORD, token: resetToken }],
  ["sign-out", {}],
]);

function authRequest(route, body, headers = {}, search = "") {
  return new Request(`${ORIGIN}/api/auth/${route}${search}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("sign-out cookie cleanup", () => {
  const neonCookies = [
    "__Secure-neon-auth.session_token",
    "__Secure-neon-auth.session_data",
    "__Secure-neon-auth.local.session_data",
  ];
  const naverCookies = [
    NAVER_AUTH_SESSION_COOKIE,
    "__Host-varda.naver.csrf-token",
    "__Host-varda.naver.state",
    "__Host-varda.naver.callback-url",
  ];

  for (const [label, body] of [["missing", undefined], ["zero-length", ""], ["JSON", "{}"]]) {
    it(`expires cookies after validation with a ${label} body`, async () => {
      const request = new Request(`${ORIGIN}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          ...(body === "{}" ? { "content-type": "application/json" } : {}),
        },
        body,
      });
      const reviewed = await createReviewedAuthRequest(request, ["sign-out"]);
      assert.equal(reviewed?.kind, "sign-out");
      assert.equal(request.bodyUsed, body !== undefined);

      const headers = new Headers({ "cache-control": "public, max-age=60" });
      for (const name of neonCookies) {
        headers.append(
          "set-cookie",
          `${name}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`,
        );
      }
      const response = expireNaverSessionCookies(
        request,
        Response.json({ success: true }, { headers }),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { success: true });
      const deletionHeaders = response.headers.getSetCookie();
      assert.deepEqual(
        deletionHeaders.slice(0, neonCookies.length),
        headers.getSetCookie(),
        "Neon deletion headers must be preserved byte for byte",
      );
      const cookies = new ResponseCookies(response.headers);
      for (const name of [...neonCookies, ...naverCookies]) {
        const cookie = cookies.get(name);
        assert.ok(cookie, `${name} must be expired`);
        const deletion = deletionHeaders.find((header) =>
          header.startsWith(`${name}=`),
        );
        assert.equal(deletion.split(";", 1)[0], `${name}=`);
        assert.match(deletion, /;\s*Max-Age=0(?:;|$)/i);
        assert.equal(cookie.path, "/");
        assert.equal(cookie.secure, true);
        assert.equal(cookie.httpOnly, true);
      }
    });
  }

  it("expires every Naver session chunk without touching unrelated cookies", async () => {
    const chunks = [
      `${NAVER_AUTH_SESSION_COOKIE}.0`,
      `${NAVER_AUTH_SESSION_COOKIE}.1`,
      `${NAVER_AUTH_SESSION_COOKIE}.10`,
    ];
    const unrelated = [
      "theme",
      `${NAVER_AUTH_SESSION_COOKIE}.backup`,
      `${NAVER_AUTH_SESSION_COOKIE}-other`,
    ];
    const request = authRequest("sign-out", {}, {
      cookie: [...neonCookies, ...naverCookies, ...chunks, ...unrelated]
        .map((name) => `${name}=test-only-cookie`)
        .join("; "),
    });
    assert.ok(await createReviewedAuthRequest(request, ["sign-out"]));
    assert.equal(request.bodyUsed, true);
    const response = expireNaverSessionCookies(
      request,
      Response.json({ success: true }),
    );
    const cookies = new ResponseCookies(response.headers);
    for (const name of [...naverCookies, ...chunks]) {
      const deletion = response.headers.getSetCookie().find((header) =>
        header.startsWith(`${name}=`),
      );
      assert.ok(deletion, name);
      assert.match(deletion, /;\s*Max-Age=0(?:;|$)/i);
      assert.equal(cookies.get(name)?.expires?.getTime(), 0, name);
    }
    for (const name of unrelated) {
      assert.equal(cookies.has(name), false, name);
    }
    assert.equal(cookies.getAll().length, naverCookies.length + chunks.length);
  });
});

describe("reviewed email and social authentication", () => {
  it("forwards the fixed email routes without trimming passwords or accepting product identity", async () => {
    for (const [route, body] of acceptedBodies) {
      const reviewed = await createReviewedAuthRequest(
        authRequest(route, body),
        route.split("/"),
      );
      assert.ok(reviewed, route);
      assert.deepEqual(await reviewed.request.json(), {
        ...body,
        ...("callbackURL" in body
          ? { callbackURL: `${ORIGIN}${body.callbackURL}` }
          : {}),
        ...("redirectTo" in body
          ? { redirectTo: `${ORIGIN}${body.redirectTo}` }
          : {}),
      });
      for (const extra of [
        { role: "admin" },
        { ownerUserId: "existing-owner" },
        { emailVerified: true },
        { userId: "old-user" },
        { provider: "google" },
      ]) {
        assert.equal(
          await createReviewedAuthRequest(
            authRequest(route, { ...body, ...extra }),
            route.split("/"),
          ),
          null,
          route,
        );
      }
    }
    for (const provider of ["google", "github"]) {
      const body = createSocialSignInBody(provider);
      const reviewed = await createReviewedAuthRequest(
        authRequest("sign-in/social", body),
        ["sign-in", "social"],
      );
      assert.equal(reviewed.socialProvider, provider);
      assert.deepEqual(await reviewed.request.json(), body);
    }
    assert.equal(
      await createReviewedAuthRequest(
        authRequest("sign-in/social", createSocialSignInBody("naver")),
        ["sign-in", "social"],
      ),
      null,
    );
  });

  it("rejects cross-origin requests, redirect overrides, unexpected methods, and oversized bodies", async () => {
    const route = "sign-up/email";
    const body = acceptedBodies.get(route);
    for (const headers of [
      { origin: "https://attacker.example.invalid" },
      { origin: "null" },
      { origin: "" },
      { "sec-fetch-site": "cross-site" },
      { "content-type": "text/plain" },
      { "content-length": "99999" },
    ]) {
      assert.equal(
        await createReviewedAuthRequest(
          authRequest(route, body, headers),
          route.split("/"),
        ),
        null,
      );
    }
    assert.equal(
      await createReviewedAuthRequest(
        authRequest(route, body, {}, "?role=admin"),
        route.split("/"),
      ),
      null,
    );
    assert.equal(
      await createReviewedAuthRequest(
        new Request(`${ORIGIN}/api/auth/${route}`),
        route.split("/"),
      ),
      null,
    );
    assert.equal(
      await createReviewedAuthRequest(authRequest("delete-user", {}), [
        "delete-user",
      ]),
      null,
    );
    assert.equal(
      await createReviewedAuthRequest(
        authRequest(route, { ...body, name: "x".repeat(5000) }),
        route.split("/"),
      ),
      null,
    );
    for (const [path, data] of acceptedBodies) {
      for (const key of ["callbackURL", "redirectTo"].filter(
        (key) => key in data,
      )) {
        assert.equal(
          await createReviewedAuthRequest(
            authRequest(path, {
              ...data,
              [key]: "https://attacker.example.invalid",
            }),
            path.split("/"),
          ),
          null,
        );
      }
    }
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4097));
        controller.close();
      },
    });
    assert.equal(
      await readBoundedAuthBody(
        new Request(`${ORIGIN}/api/auth/sign-up/email`, {
          method: "POST",
          body: stream,
          duplex: "half",
        }),
      ),
      null,
    );
    assert.equal(
      await readBoundedAuthBody(
        new Request(ORIGIN, {
          method: "POST",
          body: new Uint8Array([0xc3, 0x28]),
        }),
      ),
      null,
    );
  });

  it("allows existing passwords at sign-in but enforces stronger new passwords and canonical email input", async () => {
    const signIn = {
      ...acceptedBodies.get("sign-in/email"),
      email: ` ${EMAIL} `,
      password: "old-pass",
    };
    const reviewed = await createReviewedAuthRequest(
      authRequest("sign-in/email", signIn),
      ["sign-in", "email"],
    );
    assert.deepEqual(await reviewed.request.json(), {
      ...signIn,
      email: EMAIL,
      callbackURL: `${ORIGIN}/auth/session`,
    });
    for (const password of ["short", "x".repeat(129)]) {
      const body = { ...acceptedBodies.get("sign-up/email"), password };
      assert.equal(
        await createReviewedAuthRequest(authRequest("sign-up/email", body), [
          "sign-up",
          "email",
        ]),
        null,
      );
    }
    const reset = {
      ...acceptedBodies.get("reset-password"),
      token: "<script>",
    };
    assert.equal(
      await createReviewedAuthRequest(authRequest("reset-password", reset), [
        "reset-password",
      ]),
      null,
    );
  });

  it("does not reflect provider internals and requires explicit activation for new methods", () => {
    assert.equal(
      authErrorMessage({
        code: "secret-provider-diagnostic",
        message: "raw-token",
      }),
      authErrorMessage(null),
    );
    assert.equal(
      authErrorMessage({ code: "USER_NOT_FOUND" }),
      authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD" }),
    );
    assert.equal(isEmailPasswordEnabled({}), false);
    assert.equal(isGitHubAuthEnabled({}), false);
    assert.equal(
      isEmailPasswordEnabled({ VARDA_AUTH_EMAIL_PASSWORD_ENABLED: "true" }),
      true,
    );
    assert.equal(
      isGitHubAuthEnabled({ VARDA_AUTH_GITHUB_ENABLED: "true" }),
      true,
    );
  });
});

describe("provider identities remain separate from product ownership", () => {
  const absent = { state: "unauthenticated" };
  const neon = verifiedProviderSession("neon_auth", "verified-neon-subject");
  const naver = verifiedProviderSession("naver", NAVER_SUBJECT);
  it("accepts one verified provider only and fails closed on conflicting sessions", () => {
    assert.deepEqual(resolveProviderSessions(neon, absent), neon);
    assert.deepEqual(resolveProviderSessions(absent, naver), naver);
    assert.deepEqual(resolveProviderSessions(neon, naver), {
      state: "invalid",
    });
    assert.deepEqual(resolveProviderSessions({ state: "unverified" }, naver), {
      state: "invalid",
    });
    assert.deepEqual(resolveProviderSessions({ state: "unverified" }, absent), {
      state: "unverified",
    });
    assert.deepEqual(resolveProviderSessions({ state: "unavailable" }, naver), {
      state: "unavailable",
    });
    for (const subject of [
      null,
      "",
      " leading-space",
      "subject\u0000",
      "x".repeat(256),
    ]) {
      assert.deepEqual(verifiedProviderSession("naver", subject), {
        state: "invalid",
      });
    }
  });
  it("keeps tokens out of browser storage and auth URLs out of analytics", () => {
    for (const file of [
      "email-auth-form",
      "email-recovery-form",
      "auth-transport-controls",
    ]) {
      const source = readFileSync(`src/components/auth/${file}.tsx`, "utf8");
      assert.doesNotMatch(source, /localStorage|sessionStorage|console\./);
    }
    const analytics = readFileSync(
      "src/components/service-speed-insights.tsx",
      "utf8",
    );
    assert.match(analytics, /pathname\.startsWith\("\/auth\/"\)/);
    assert.match(analytics, /url\.search = ""/);
    const recovery = readFileSync(
      "src/components/auth/email-recovery-form.tsx",
      "utf8",
    );
    assert.match(recovery, /url\.searchParams\.delete\("token"\)/);
    assert.match(recovery, /setToken\(""\)/);
    const binding = readFileSync(
      "src/lib/auth/private-session-subject-binding.ts",
      "utf8",
    );
    assert.match(binding, /result\.provider !== "neon_auth"/);
  });
});

function mergeCookies(jar, response) {
  for (const { name, value } of new ResponseCookies(
    new Headers(response.headers),
  ).getAll()) {
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
}
function cookieHeader(jar) {
  return [...jar]
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
}
function naverPost(csrfToken, jar, extra = {}) {
  return new Request(`${ORIGIN}/api/oauth/signin/naver`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({
      csrfToken,
      callbackUrl: "/auth/session",
      ...extra,
    }),
  });
}
async function startNaverFlow(
  profile = {
    resultcode: "00",
    response: { id: NAVER_SUBJECT, email: "existing@example.invalid" },
  },
) {
  const jar = new Map();
  let callbackState;
  let requests = 0;
  const config = (state = callbackState) =>
    createNaverAuthConfig({
      clientId: "test-client",
      clientSecret: "test-client-secret",
      secret: SECRET,
      origin: ORIGIN,
      callbackState: state,
      fetcher: async (resource, init) => {
        requests += 1;
        const url = new URL(
          resource instanceof Request ? resource.url : resource,
        );
        assert.equal(init.redirect, "error");
        if (url.href === "https://nid.naver.com/oauth2.0/token") {
          const body = new URLSearchParams(init.body);
          assert.equal(body.get("client_id"), "test-client");
          assert.equal(body.get("client_secret"), "test-client-secret");
          assert.equal(body.get("state"), callbackState);
          assert.equal(body.get("code"), "test-authorization-code");
          assert.equal(
            body.get("redirect_uri"),
            `${ORIGIN}/api/oauth/callback/naver`,
          );
          assert.equal(body.has("code_verifier"), false);
          assert.equal(new Headers(init.headers).has("authorization"), false);
          return Response.json({
            access_token: "test-access-token",
            refresh_token: "test-refresh-token",
            token_type: "bearer",
            expires_in: "3600",
          });
        }
        assert.equal(url.href, "https://openapi.naver.com/v1/nid/me");
        assert.equal(
          new Headers(init.headers).get("authorization"),
          "Bearer test-access-token",
        );
        return Response.json(profile);
      },
    });
  const csrfRequest = await createReviewedNaverAuthRequest(
    new Request(`${ORIGIN}/api/oauth/csrf`),
    ["csrf"],
    ORIGIN,
  );
  const csrfResponse = await Auth(csrfRequest, config());
  mergeCookies(jar, csrfResponse);
  const { csrfToken } = await csrfResponse.json();
  assert.match(csrfToken, /^[a-f0-9]{64}$/);
  const reviewed = await createReviewedNaverAuthRequest(
    naverPost(csrfToken, jar),
    ["signin", "naver"],
    ORIGIN,
  );
  const signIn = await Auth(reviewed, config());
  mergeCookies(jar, signIn);
  const { url } = await signIn.json();
  assert.equal(isNaverAuthorizationUrl(url), true);
  const authorization = new URL(url);
  assert.equal(authorization.searchParams.get("scope"), "");
  assert.equal(
    authorization.searchParams.get("redirect_uri"),
    `${ORIGIN}/api/oauth/callback/naver`,
  );
  callbackState = authorization.searchParams.get("state");
  assert.ok(callbackState);
  assert.equal(requests, 0);
  return {
    jar,
    csrfToken,
    config,
    get requests() {
      return requests;
    },
    async callback(state = callbackState, callbackJar = jar) {
      const params = new URLSearchParams({
        state,
        code: "test-authorization-code",
      });
      const request = new Request(
        `${ORIGIN}/api/oauth/callback/naver?${params}`,
        { headers: { cookie: cookieHeader(callbackJar) } },
      );
      const reviewed = await createReviewedNaverAuthRequest(
        request,
        ["callback", "naver"],
        ORIGIN,
      );
      return finalizeNaverAuthCallback(
        await Auth(reviewed, config(state)),
        ORIGIN,
      );
    },
  };
}

describe("Naver OAuth protocol and session security", () => {
  it("requires production credentials and a canonical HTTPS origin", () => {
    const ready = {
      VERCEL_ENV: "production",
      VARDA_AUTH_NAVER_ENABLED: "true",
      NAVER_CLIENT_ID: "test-client",
      NAVER_CLIENT_SECRET: "test-secret",
      NAVER_AUTH_SECRET: SECRET,
      NAVER_AUTH_ORIGIN: ORIGIN,
    };
    assert.deepEqual(assessNaverAuthEnvironment(ready), { state: "ready" });
    assert.deepEqual(
      assessNaverAuthEnvironment({ ...ready, VERCEL_ENV: "preview" }),
      { state: "disabled" },
    );
    assert.deepEqual(
      assessNaverAuthEnvironment({ ...ready, NAVER_CLIENT_SECRET: "" }),
      { state: "misconfigured" },
    );
    for (const value of [
      "http://localhost:3213",
      `${ORIGIN}/callback`,
      `${ORIGIN}?secret=x`,
      "https://user:pass@example.invalid",
      `${ORIGIN}:3213`,
    ])
      assert.equal(canonicalNaverAuthOrigin(value), null);
    assert.equal(
      isNaverAuthorizationUrl(
        "https://nid.naver.com.attacker.invalid/oauth2.0/authorize",
      ),
      false,
    );
  });
  it("rejects unreviewed endpoints, CSRF inputs, callback duplicates, and redirect fields", async () => {
    const flow = await startNaverFlow();
    assert.equal(
      await createReviewedNaverAuthRequest(
        naverPost(flow.csrfToken, flow.jar, {
          callbackUrl: "https://attacker.example.invalid",
        }),
        ["signin", "naver"],
        ORIGIN,
      ),
      null,
    );
    assert.equal(
      await createReviewedNaverAuthRequest(
        naverPost(flow.csrfToken, flow.jar, { role: "admin" }),
        ["signin", "naver"],
        ORIGIN,
      ),
      null,
    );
    const crossOrigin = naverPost(flow.csrfToken, flow.jar);
    crossOrigin.headers.set("origin", "https://attacker.example.invalid");
    assert.equal(
      await createReviewedNaverAuthRequest(
        crossOrigin,
        ["signin", "naver"],
        ORIGIN,
      ),
      null,
    );
    for (const path of [
      "session",
      "providers",
      "callback/naver?code=x",
      "callback/naver?code=x&state=x&state=y",
    ]) {
      assert.equal(
        await createReviewedNaverAuthRequest(
          new Request(`${ORIGIN}/api/oauth/${path}`),
          path.split("?")[0].split("/"),
          ORIGIN,
        ),
        null,
      );
    }
    const invalidCsrf = await createReviewedNaverAuthRequest(
      naverPost("0".repeat(64), flow.jar),
      ["signin", "naver"],
      ORIGIN,
    );
    const rejected = await Auth(invalidCsrf, flow.config());
    assert.equal(isNaverAuthorizationUrl((await rejected.json()).url), false);
    assert.equal(flow.requests, 0);
  });
  it("validates state before any token exchange", async () => {
    const flow = await startNaverFlow();
    const wrongState = await flow.callback("wrong-state");
    assert.ok(
      wrongState.headers.get("location").startsWith(`${ORIGIN}/auth/sign-in`),
    );
    assert.equal(flow.requests, 0);
    const absentCookie = await flow.callback(undefined, new Map());
    assert.ok(
      absentCookie.headers.get("location").startsWith(`${ORIGIN}/auth/sign-in`),
    );
    assert.equal(flow.requests, 0);
  });
  it("completes the real Auth.js exchange with Naver token conventions and an encrypted identity-only cookie", async () => {
    const flow = await startNaverFlow();
    const response = await flow.callback();
    assert.equal(response.headers.get("location"), `${ORIGIN}/auth/session`);
    assert.equal(flow.requests, 2);
    const sessionCookie = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith(`${NAVER_AUTH_SESSION_COOKIE}=`));
    assert.ok(sessionCookie);
    assert.match(sessionCookie, /HttpOnly/);
    assert.match(sessionCookie, /Secure/);
    assert.match(sessionCookie, /SameSite=Lax/i);
    assert.doesNotMatch(
      sessionCookie,
      /test-access-token|test-refresh-token|existing@example|naver-opaque-subject/,
    );
    mergeCookies(flow.jar, response);
    const req = new Request(ORIGIN, {
      headers: { cookie: cookieHeader(flow.jar) },
    });
    const token = await getToken({
      req,
      secret: SECRET,
      cookieName: NAVER_AUTH_SESSION_COOKIE,
      secureCookie: true,
    });
    assert.equal(token.sub, NAVER_SUBJECT);
    assert.equal(token.authProvider, "naver");
    assert.equal(token.aud, ORIGIN);
    assert.equal(token.exp - token.iat, NAVER_AUTH_SESSION_MAX_AGE);
    assert.deepEqual(
      Object.keys(token).sort(),
      ["aud", "authProvider", "exp", "iat", "jti", "sub"].sort(),
    );
    assert.equal(
      await getToken({
        req,
        secret: "different-test-secret",
        cookieName: NAVER_AUTH_SESSION_COOKIE,
        secureCookie: true,
      }),
      null,
    );
  });
  it("never substitutes random or email-based identities when provider evidence is invalid", async () => {
    for (const profile of [
      { resultcode: "00", response: { email: EMAIL } },
      { resultcode: "024", response: { id: NAVER_SUBJECT } },
    ]) {
      const flow = await startNaverFlow(profile);
      const response = await flow.callback();
      assert.ok(
        response.headers.get("location").startsWith(`${ORIGIN}/auth/sign-in`),
      );
      assert.equal(
        response.headers
          .getSetCookie()
          .some((cookie) => cookie.startsWith(`${NAVER_AUTH_SESSION_COOKIE}=`)),
        false,
      );
    }
  });
});
