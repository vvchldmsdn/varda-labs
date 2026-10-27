export type AuthMethodAvailability = Readonly<{
  google: boolean;
  github: boolean;
  naver: boolean;
  emailPassword: boolean;
}>;

export type SocialAuthProvider = "google" | "github" | "naver";

export const SOCIAL_AUTH_LABELS = Object.freeze({
  google: "Google",
  github: "GitHub",
  naver: "네이버",
});

export const AUTH_EMAIL_VERIFIED_PATH = "/auth/sign-in?verified=1";
export const AUTH_PASSWORD_RESET_PATH = "/auth/reset-password";
export const AUTH_MIN_NEW_PASSWORD_LENGTH = 12;
export const AUTH_MAX_PASSWORD_LENGTH = 128;

export function isEmailPasswordEnabled(
  environment: Readonly<{
    VARDA_AUTH_EMAIL_PASSWORD_ENABLED?: string;
  }>,
) {
  return environment.VARDA_AUTH_EMAIL_PASSWORD_ENABLED === "true";
}

export function isGitHubAuthEnabled(
  environment: Readonly<{
    VARDA_AUTH_GITHUB_ENABLED?: string;
  }>,
) {
  return environment.VARDA_AUTH_GITHUB_ENABLED === "true";
}
