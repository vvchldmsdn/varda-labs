import assert from "node:assert/strict";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE_URL = readArgument("--base-url");
const PASSWORD =
  process.env.VARDA_APP_PASSWORD?.trim() ||
  process.env.APP_ACCESS_PASSWORD?.trim();
const USERNAME = process.env.VARDA_APP_USER?.trim() || "varda";
const LEAK_PATTERN =
  /provider[_-]?subject|ownerUserId|api[_-]?key|authorization|password|secret|access[_-]?token|refresh[_-]?token|id[_-]?token|DATABASE_URL|postgres(?:ql)?:\/\//i;

if (!BASE_URL) throw new Error("--base-url is required");
if (!PASSWORD) throw new Error("Dashboard access password is not configured");

const authorization = `Basic ${Buffer.from(
  `${USERNAME}:${PASSWORD}`,
).toString("base64")}`;

const rootWithoutAuth = await request("/");
assert.equal(rootWithoutAuth.status, 401);

const signInWithoutAuth = await request("/auth/sign-in");
assert.equal(signInWithoutAuth.status, 401);

const sessionWithoutAuth = await request("/auth/session");
assert.equal(sessionWithoutAuth.status, 401);

const authApiWithoutAuth = await request("/api/auth/get-session");
assert.equal(authApiWithoutAuth.status, 401);

const signOutWithoutAuth = await request("/api/auth/sign-out", false, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: new URL(BASE_URL).origin,
  },
  body: "{}",
});
assert.equal(signOutWithoutAuth.status, 401);

const signIn = await request("/auth/sign-in", true);
assert.equal(signIn.status, 200);
assert.match(signIn.body, />Sign in</);
assert.match(signIn.body, /Portfolio access remains/);
assert.doesNotMatch(signIn.body, LEAK_PATTERN);

const rejectedAuthApi = await request("/api/auth/get-session", true);
assert.equal(rejectedAuthApi.status, 404);
assert.doesNotMatch(rejectedAuthApi.body, LEAK_PATTERN);

const session = await request("/auth/session", true);
assert.equal(session.status, 200);
assert.match(session.body, /Server session evidence/);
assert.match(session.body, /Not present/);
assert.match(session.body, /Not attempted/);
assert.doesNotMatch(session.body, LEAK_PATTERN);

const signOut = await request("/api/auth/sign-out", true, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    cookie:
      "__Secure-neon-auth.session_token=auth-transport-smoke-invalid-session",
    origin: new URL(BASE_URL).origin,
  },
  body: "{}",
});
assert.equal(
  signOut.status,
  200,
  `authenticated sign-out transport failed: ${signOut.body}`,
);
assert.deepEqual(JSON.parse(signOut.body), { success: true });
assert.match(
  signOut.setCookieHeaders.join("\n"),
  /__Secure-neon-auth\.session_token=.*(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i,
);
assert.match(
  signOut.setCookieHeaders.join("\n"),
  /__Secure-neon-auth\.session_data=.*(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i,
);

const callback = await request("/auth/callback");
assert.equal(callback.status, 307);
assert.equal(
  new URL(callback.location, BASE_URL).pathname,
  "/auth/session",
);

console.log(
  JSON.stringify(
    {
      smoke: "auth_transport_route",
      baseUrl: BASE_URL,
      rootWithoutAuth: rootWithoutAuth.status,
      signInWithoutAuth: signInWithoutAuth.status,
      sessionWithoutAuth: sessionWithoutAuth.status,
      authApiWithoutAuth: authApiWithoutAuth.status,
      signOutWithoutAuth: signOutWithoutAuth.status,
      signInWithAuth: signIn.status,
      rejectedAuthApiWithAuth: rejectedAuthApi.status,
      sessionWithBasicAuth: session.status,
      signOutWithBasicAuthAndSessionCookie: signOut.status,
      callbackWithoutSession: callback.status,
      providerSessionCreated: false,
      productDatabaseAccess: false,
    },
    null,
    2,
  ),
);

async function request(path, authenticated = false, init = {}) {
  const headers = new Headers(init.headers);
  if (authenticated) headers.set("authorization", authorization);

  const response = await fetch(new URL(path, BASE_URL), {
    ...init,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  return {
    status: response.status,
    body: await response.text(),
    location: response.headers.get("location"),
    setCookieHeaders:
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean),
  };
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
