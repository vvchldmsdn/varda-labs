const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9._~-]+/gi;
const NAMED_SECRET_PATTERN =
  /(KIS_APP_KEY|KIS_APP_SECRET|KIS_ACCESS_TOKEN|secret|token|api[_-]?key)=([^&\s]+)/gi;
const STRUCTURED_KIS_SECRET_PATTERN =
  /(appkey|appsecret|authorization|access_token)(["':=\s]+)([^,"'\s]+)/gi;

export function redactSensitiveText(value: string) {
  return value
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]")
    .replace(NAMED_SECRET_PATTERN, "$1=[redacted]")
    .replace(STRUCTURED_KIS_SECRET_PATTERN, "$1$2[redacted]");
}

export function safeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return redactSensitiveText(message).slice(0, 1000);
}
