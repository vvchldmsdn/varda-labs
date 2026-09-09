import { notFound } from "next/navigation";
import { getAuthTransportRuntimeState } from "@/lib/auth/auth-transport-runtime";
import { getAuthMethodAvailability } from "@/lib/auth/auth-method-availability";
import { AuthHeading, AuthShell } from "./auth-shell";
import {
  EmailRecoveryForm,
  type EmailRecoveryMode,
} from "./email-recovery-form";
import { EmailVerificationForm } from "./email-verification-form";
import styles from "./auth-experience.module.css";

const headings = {
  "forgot-password": {
    title: "비밀번호 찾기",
    description: "가입한 이메일로 재설정 링크를 보내드립니다.",
  },
  "verify-email": {
    title: "이메일 인증",
    description: "메일로 받은 숫자 코드로 이메일을 확인해 주세요.",
  },
  "reset-password": {
    title: "새 비밀번호",
    description: "앞으로 사용할 비밀번호를 입력해 주세요.",
  },
};

export function AuthRecovery({
  mode,
  preview = false,
  resetToken = "",
}: {
  mode: EmailRecoveryMode;
  preview?: boolean;
  resetToken?: string;
}) {
  const designPreview = process.env.NODE_ENV === "development" && preview;
  if (getAuthTransportRuntimeState().state === "disabled" && !designPreview)
    notFound();
  const availability = getAuthMethodAvailability();
  return (
    <AuthShell
      preview={designPreview}
      alternate={{
        href: `/auth/sign-in${designPreview ? "?preview=design" : ""}`,
        label: "로그인",
      }}
    >
      <section className={styles.panel} data-auth-entry>
        <AuthHeading eyebrow="YOUR ACCOUNT" {...headings[mode]} />
        {mode === "verify-email" ? <EmailVerificationForm
          enabled={availability.emailPassword}
          preview={designPreview}
        /> : <EmailRecoveryForm
          mode={mode}
          enabled={availability.emailPassword}
          preview={designPreview}
          resetToken={resetToken}
        />}
      </section>
    </AuthShell>
  );
}
