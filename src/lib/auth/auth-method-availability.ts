import "server-only";

import {
  isEmailPasswordEnabled,
  isGitHubAuthEnabled,
  type AuthMethodAvailability,
} from "./auth-methods";
import { getAuthTransportRuntimeState } from "./auth-transport-runtime";
import { getNaverAuthRuntimeState } from "./naver-auth-runtime";

export function getAuthMethodAvailability(): AuthMethodAvailability {
  const neon = getAuthTransportRuntimeState().state === "ready";
  return {
    google: neon,
    github:
      neon &&
      isGitHubAuthEnabled({
        VARDA_AUTH_GITHUB_ENABLED: process.env.VARDA_AUTH_GITHUB_ENABLED,
      }),
    emailPassword:
      neon &&
      isEmailPasswordEnabled({
        VARDA_AUTH_EMAIL_PASSWORD_ENABLED:
          process.env.VARDA_AUTH_EMAIL_PASSWORD_ENABLED,
      }),
    naver: getNaverAuthRuntimeState().state === "ready",
  };
}
