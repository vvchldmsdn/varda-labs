"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { createFirstAccount } from "@/app/portfolio/onboarding/actions";
import type { AccountManagementActionState } from "@/lib/account-management";
import styles from "./auth-experience.module.css";

const initialState: AccountManagementActionState = {
  status: "idle",
  message: null,
};
const messages = {
  invalid: "계좌 이름을 1~100자로 입력해 주세요.",
  unauthorized: "로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.",
  conflict:
    "계좌 상태가 변경됐거나 같은 이름이 사용 중입니다. 새로고침 후 확인해 주세요.",
  error: "계좌를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.",
} as const;

export function OnboardingAccountForm({
  preview = false,
}: {
  preview?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [state, action, pending] = useActionState(
    createFirstAccount,
    initialState,
  );
  return (
    <form
      action={preview ? undefined : action}
      className={styles.form}
      onSubmit={
        preview
          ? (event) => {
              event.preventDefault();
              router.push("/portfolio/onboarding?preview=design&step=holding");
            }
          : undefined
      }
    >
      <label className={styles.field} htmlFor="onboarding-account-name">
        계좌 이름
        <input
          id="onboarding-account-name"
          className={styles.input}
          name="name"
          type="text"
          required
          minLength={1}
          maxLength={100}
          autoComplete="off"
          placeholder="예: 나의 증권 계좌"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
          aria-invalid={state.status === "invalid" || undefined}
          aria-describedby={
            state.status in messages ? "account-error" : undefined
          }
        />
      </label>
      <p className={styles.notice}>
        이 계좌의 기준 통화는 KRW입니다. 미국 종목도 종목별 거래 통화로 기록할
        수 있습니다.
      </p>
      {state.status in messages ? (
        <p id="account-error" role="alert" className={styles.error}>
          {messages[state.status as keyof typeof messages]}
        </p>
      ) : null}
      <button
        type="submit"
        className={styles.primaryButton}
        disabled={pending || !name.trim()}
        aria-busy={pending}
      >
        {pending ? "계좌 등록 중" : "계좌 등록하고 계속"}
        {pending ? (
          <LoaderCircle
            size={17}
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          <ArrowRight size={17} aria-hidden="true" />
        )}
      </button>
    </form>
  );
}
