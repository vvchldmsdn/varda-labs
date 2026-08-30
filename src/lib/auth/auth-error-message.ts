export function authErrorMessage(
  error: { code?: string; status?: number } | null | undefined,
) {
  if (error?.status === 429 || error?.code === "TOO_MANY_REQUESTS") {
    return "요청이 많습니다. 잠시 기다린 후 다시 시도해 주세요.";
  }
  if (
    error?.code === "AUTH_METHOD_UNAVAILABLE" ||
    error?.code === "EMAIL_AND_PASSWORD_DISABLED"
  ) {
    return "이 로그인 방식은 아직 준비 중입니다. 다른 방식으로 로그인해 주세요.";
  }
  if (error?.code === "EMAIL_NOT_VERIFIED")
    return "이메일 인증이 필요합니다. 받은 메일을 확인해 주세요.";
  if (error?.code === "INVALID_TOKEN" || error?.code === "TOKEN_EXPIRED")
    return "링크가 만료되었거나 유효하지 않습니다. 새 메일을 요청해 주세요.";
  if (
    [
      "INVALID_EMAIL_OR_PASSWORD",
      "INVALID_PASSWORD",
      "USER_NOT_FOUND",
    ].includes(error?.code ?? "")
  ) {
    return "이메일 또는 비밀번호를 확인해 주세요.";
  }
  if (
    ["USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"].includes(
      error?.code ?? "",
    )
  ) {
    return "가입 정보를 확인하거나 기존 로그인 방식으로 다시 시도해 주세요.";
  }
  return "요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
