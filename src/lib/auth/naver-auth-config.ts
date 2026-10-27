import { customFetch, type AuthConfig } from "@auth/core";
import Naver from "@auth/core/providers/naver";
import { isCanonicalSessionProviderSubject } from "./session-subject-binding.ts";
import {
  NAVER_AUTH_BASE_PATH,
  NAVER_AUTH_SESSION_COOKIE,
  NAVER_AUTH_SESSION_MAX_AGE,
} from "./naver-auth-policy.ts";

export function createNaverAuthConfig(
  input: Readonly<{
    clientId: string;
    clientSecret: string;
    secret: string;
    origin: string;
    callbackState?: string;
    fetcher?: typeof fetch;
  }>,
): AuthConfig {
  const secureCookie = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: true,
  };
  return {
    basePath: NAVER_AUTH_BASE_PATH,
    secret: input.secret,
    trustHost: true,
    useSecureCookies: true,
    session: { strategy: "jwt", maxAge: NAVER_AUTH_SESSION_MAX_AGE },
    cookies: {
      sessionToken: { name: NAVER_AUTH_SESSION_COOKIE, options: secureCookie },
      csrfToken: {
        name: "__Host-varda.naver.csrf-token",
        options: secureCookie,
      },
      state: {
        name: "__Host-varda.naver.state",
        options: { ...secureCookie, maxAge: 900 },
      },
      callbackUrl: {
        name: "__Host-varda.naver.callback-url",
        options: secureCookie,
      },
    },
    providers: [
      Naver({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        checks: ["state"],
        client: { token_endpoint_auth_method: "client_secret_post" },
        authorization: {
          url: "https://nid.naver.com/oauth2.0/authorize",
          params: { scope: "" },
        },
        [customFetch]: async (resource, init) => {
          const url = new URL(
            resource instanceof Request ? resource.url : resource,
          );
          if (url.href === "https://nid.naver.com/oauth2.0/token") {
            // Auth.js validates the state cookie before reaching this token request.
            if (
              !input.callbackState ||
              !(init?.body instanceof URLSearchParams)
            ) {
              throw new Error(
                "Naver token exchange is missing its validated callback",
              );
            }
            const body = new URLSearchParams(init.body);
            body.set("state", input.callbackState);
            return (input.fetcher ?? fetch)(resource, {
              ...init,
              body,
              redirect: "error",
            });
          }
          if (url.href !== "https://openapi.naver.com/v1/nid/me") {
            throw new Error("Unexpected Naver authentication endpoint");
          }
          return (input.fetcher ?? fetch)(resource, {
            ...init,
            redirect: "error",
          });
        },
        token: {
          url: "https://nid.naver.com/oauth2.0/token",
          async conform(response: Response) {
            const data: unknown = await response.json().catch(() => null);
            if (!data || typeof data !== "object" || !("expires_in" in data))
              return;
            // Naver documents expires_in as a string; the OAuth client requires a number.
            if (
              typeof data.expires_in !== "string" ||
              !/^[1-9]\d*$/.test(data.expires_in)
            )
              return;
            const expiresIn = Number(data.expires_in);
            if (!Number.isSafeInteger(expiresIn)) return;
            const headers = new Headers(response.headers);
            headers.delete("content-length");
            return Response.json(
              { ...data, expires_in: expiresIn },
              { status: response.status, headers },
            );
          },
        },
        profile(profile) {
          if (
            profile.resultcode !== "00" ||
            !isCanonicalSessionProviderSubject(profile.response?.id)
          ) {
            throw new Error("Naver identity could not be verified");
          }
          return { id: profile.response.id };
        },
      }),
    ],
    pages: { signIn: "/auth/sign-in", error: "/auth/sign-in" },
    callbacks: {
      signIn({ account }) {
        return (
          account?.provider === "naver" &&
          isCanonicalSessionProviderSubject(account.providerAccountId)
        );
      },
      jwt({ token, account }) {
        if (account) {
          if (
            account.provider !== "naver" ||
            !isCanonicalSessionProviderSubject(account.providerAccountId)
          )
            return null;
          // Never put OAuth access tokens, email, or product roles into this cookie.
          return {
            sub: account.providerAccountId,
            authProvider: "naver",
            aud: input.origin,
          };
        }
        return token.authProvider === "naver" &&
          token.aud === input.origin &&
          isCanonicalSessionProviderSubject(token.sub)
          ? token
          : null;
      },
      session({ session, token }) {
        return {
          expires: session.expires,
          user: { id: String(token.sub ?? "") },
        };
      },
      redirect({ url }) {
        const sessionUrl = `${input.origin}/auth/session`;
        const signInUrl = `${input.origin}/auth/sign-in`;
        return url === sessionUrl || url === "/auth/session"
          ? sessionUrl
          : signInUrl;
      },
    },
    logger: {
      error: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
    },
  };
}
