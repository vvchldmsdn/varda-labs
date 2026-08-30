# Multi-provider authentication

Updated: 2026-08-30

## Scope

The sign-in and sign-up pages now expose Google, GitHub, Naver, and
email/password entry points. Email verification resend, password reset request,
and password reset completion are separate pages. They use the existing
presentation design system and continue into the existing onboarding flow.

This implementation does not enable provider applications, change Neon Auth
settings, send real verification mail, or deploy itself. New methods default to
disabled until their server-side activation flags and provider settings are
ready. Development `?preview=design` renders interactive forms without sending
credentials or creating accounts. Live authentication remains Production-only.

## Runtime boundaries

| Method         | Credential/session authority                  | Product identity                    |
| -------------- | --------------------------------------------- | ----------------------------------- |
| Google         | Managed Neon Auth                             | `neon_auth` + verified Neon user ID |
| GitHub         | Managed Neon Auth                             | `neon_auth` + verified Neon user ID |
| Email/password | Managed Neon Auth                             | `neon_auth` + verified Neon user ID |
| Naver          | Auth.js OAuth + encrypted application session | `naver` + Naver profile ID          |

Managed Neon Auth's OAuth provider API currently supports Google, GitHub,
Microsoft, and Vercel, but not Naver. Naver therefore has a separate restricted
transport at `/api/oauth/*`. Both session types resolve through the same existing
`auth_identities` and `app_users` boundary. No product schema change is required.

- Neon sessions must report `emailVerified: true` before product access or
  empty-tenant provisioning. A successful password check alone is insufficient.
- Naver uses the provider-verified opaque ID, not email/name, as identity. Email
  access is not required for the Naver application.
- The application never adopts a legacy portfolio or grants a role from a
  submitted email, profile, URL, or request body. Existing identity linking
  inside Neon is governed by Neon's verified-provider linking policy; confirm
  it does not link unverified email identities when enabling new providers.
- Simultaneous Neon and Naver sessions fail closed. The user can sign out and
  choose one account. Explicit cross-provider account linking is not included.
- New users still explicitly create an empty portfolio through onboarding.
  Existing ownership, tenant-scoped reads, RLS, and admin checks are unchanged.

## 1. GitHub

1. In the production Neon branch's Auth settings, enable GitHub. For a custom
   GitHub OAuth application, copy the exact callback URL shown by Neon into the
   GitHub application. Do not use the Naver callback URL or guess the Auth host.
2. Store the GitHub client ID and secret in Neon Auth's provider settings, not
   browser code or public Vercel variables.
3. Confirm the production application origin is trusted and verified GitHub
   accounts can sign in, including accounts with private email addresses.
4. Set `VARDA_AUTH_GITHUB_ENABLED=true` in Vercel Production and redeploy.

## 2. Email and password

1. Enable email/password in the production Neon Auth configuration.
2. Require email verification. Configure verification mail on signup/sign-in,
   the verification link lifetime, reset-password mail, and server-side rate
   limits. The UI resend cooldown is not a security rate limiter.
3. Configure the Neon email provider / production SMTP sender and verify sender
   domain delivery. Passwords and verification/reset token issuance remain in
   managed Neon Auth. Never create a password table in the product database.
4. Confirm a password reset revokes prior sessions according to the managed
   provider's supported security setting. Check verification/account-linking
   behavior against the current managed server release before public activation.
5. Trust `https://varda-labs.vercel.app` and allow these application returns:
   - Verification: `/auth/sign-in?verified=1`
   - Password reset: `/auth/reset-password`
   - Email sign-in continuation: `/auth/session`
6. Set `VARDA_AUTH_EMAIL_PASSWORD_ENABLED=true` in Vercel Production and redeploy.

The browser submits fixed relative return paths. The server validates them and
converts email return URLs to absolute application URLs before forwarding to
Neon. The `verified=1` parameter displays guidance only; it never grants access.
Reset tokens are removed from the address bar after hydration, excluded from
analytics, and never persisted to local/session storage. Auth pages use
`no-referrer` and `noindex` metadata.

New passwords require 12-128 characters. Existing shorter passwords can still
be used for sign-in if accepted by the provider. Passwords are not trimmed, and
password managers and paste remain supported.

## 3. Naver

1. Register a Naver Login application and use this exact callback:
   `https://varda-labs.vercel.app/api/oauth/callback/naver`
2. Configure the service URL as `https://varda-labs.vercel.app`. Request only
   necessary user permissions. The code consumes the stable profile ID only.
3. Register test users while the app is under review. Complete Naver's review
   before claiming that arbitrary public Naver users can sign in.
4. Add these server-only Vercel Production variables:

| Variable                   | Value                                                              |
| -------------------------- | ------------------------------------------------------------------ |
| `NAVER_CLIENT_ID`          | Naver application client ID                                        |
| `NAVER_CLIENT_SECRET`      | Naver application secret                                           |
| `NAVER_AUTH_SECRET`        | A separate cryptographically random secret, at least 32 characters |
| `NAVER_AUTH_ORIGIN`        | `https://varda-labs.vercel.app`                                    |
| `VARDA_AUTH_NAVER_ENABLED` | `true`, only after provider configuration is ready                 |

Generate the session secret in a trusted secret manager or deployment console.
Do not paste any secret into chat, screenshots, shell history, source control,
or `NEXT_PUBLIC_*` variables. Redeploy after setting the variables.

Auth.js validates CSRF and OAuth state before token exchange. The adapter uses
Naver's required `client_secret_post`, repeats the validated state in the token
request, and normalizes the documented string `expires_in` field. Outbound
requests are restricted to Naver's token and profile endpoints; redirects from
those endpoints are not followed.

The Naver session is an encrypted, secure, HttpOnly, SameSite=Lax, host-only
cookie lasting eight hours. It contains only provider identity and token
metadata, not OAuth access tokens, email, product roles, or holdings. Sign-out
clears both managed Neon and Naver cookies. Individual stolen Naver session
tokens cannot be remotely revoked by this stateless implementation; disabling
an identity blocks product access, and rotating `NAVER_AUTH_SECRET` invalidates
all Naver sessions. Keep that operational limitation in the security review.

## Verification before public activation

```text
node --no-warnings --test tests/multi-provider-auth.test.mjs tests/auth-transport-runtime.test.mjs
npm run audit:auth-transport
npm test
npm run lint
npm run build
```

Then test with real, separate accounts in the production provider configuration:

1. Existing Google login still resolves to the existing portfolio.
2. New Google, GitHub, verified email, and Naver users start with empty portfolios.
3. An unverified email cannot create a product user or read another user's data.
4. Verification resend, expired links, password reset, and login after reset work.
5. Incorrect credentials return safe messages; provider mail/rate-limit behavior
   does not disclose existing account details.
6. Sign-out clears both session types, and expired/tampered cookies are rejected.
7. Naver cancellation/errors return to the application sign-in screen.
8. Two independent accounts cannot access each other's accounts/holdings/history
   even after changing scope or identifiers in a URL.

The automated Naver tests mock provider network responses while executing the
real Auth.js CSRF, state, token exchange, and encrypted cookie implementation.
They do not replace real provider registration, email delivery, or interactive
OAuth acceptance testing.

Dependency audit also reports pre-existing advisories in the installed
Next/Neon dependency tree. The managed Neon server's version is independent of
the local SDK. Verify provider-side fixes and plan the SDK/framework upgrades
before broad public registration; do not treat a successful build as a clean
security audit or run a breaking `npm audit fix --force` blindly.

## References

- [Neon branch OAuth provider API](https://api-docs.neon.tech/reference/addbranchneonauthoauthprovider)
- [Neon Auth management API guide](https://github.com/neondatabase/website/blob/main/content/docs/auth/guides/manage-auth-api.md)
- [Neon Auth SDK](https://github.com/neondatabase/neon-js/blob/main/packages/auth/README.md)
- [Auth.js Naver provider](https://authjs.dev/reference/core/providers/naver)
- [Naver Login API](https://developers.naver.com/docs/login/api/api.md)
