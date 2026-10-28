"use client";

import { useActionFormReset } from "@/components/cairn-ui/client";

import { AuthText } from "./auth-localized";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import styles from "./auth-experience.module.css";

import { createEmptyPortfolio } from "@/app/portfolio/onboarding/actions";
import {
  INITIAL_SELF_SERVICE_TENANT_ONBOARDING_STATE,
  SELF_SERVICE_TENANT_ONBOARDING_POLICY,
} from "@/lib/auth/self-service-tenant-onboarding";
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput, Status as CairnStatus } from "@/components/cairn-ui";


export function SelfServiceTenantOnboardingForm({
  preview = false,
}: {
  preview?: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    createEmptyPortfolio,
    INITIAL_SELF_SERVICE_TENANT_ONBOARDING_STATE,
  );
  const {formRef: actionFormRef, onReset: actionFormOnReset} = useActionFormReset(state);

  return (
    <CairnForm
      action={preview ? undefined : action}
      className={styles.form}
      onSubmit={
        preview
          ? (event) => {
              event.preventDefault();
              router.push("/portfolio/onboarding?preview=design&step=account");
            }
          : undefined
      } onReset={actionFormOnReset} ref={actionFormRef}
    >
      <CairnField className={styles.checkbox}>
        <CairnInput
          required
          type="checkbox"
          name="confirmation"
          value={SELF_SERVICE_TENANT_ONBOARDING_POLICY.confirmationValue}
          disabled={pending}
        />
        <span><AuthText>{"연결해야 할 기존 기록이 없으며, 새 포트폴리오로 시작합니다."}</AuthText></span>
      </CairnField>

      {state.status !== "idle" ? (
        <CairnStatus as="p" tone="danger" role="alert" className={styles.error}>
          <AuthText>{state.status === "invalid"
            ? "새 포트폴리오로 시작하는지 확인해 주세요."
            : state.status === "unauthorized"
              ? "로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요."
              : state.status === "conflict"
                ? "계정 연결 상태가 변경됐습니다. 새로고침 후 기존 기록을 확인해 주세요."
                : "포트폴리오를 만들지 못했습니다. 잠시 후 다시 시도해 주세요."}</AuthText>
        </CairnStatus>
      ) : null}

      <CairnButton variant="primary"
        type="submit"
        disabled={pending}
        className={styles.primaryButton}
        aria-busy={pending}
      >
        <AuthText>{pending ? "포트폴리오 만드는 중" : "새 포트폴리오 만들기"}</AuthText>
        {pending ? (
          <LoaderCircle
            size={17}
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          <ArrowRight size={17} aria-hidden="true" />
        )}
      </CairnButton>
    </CairnForm>
  );
}
