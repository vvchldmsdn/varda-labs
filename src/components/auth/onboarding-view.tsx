import Link from "next/link";
import { ArrowRight, Check, Plus, Wallet } from "lucide-react";
import { AuthHeading, AuthShell } from "./auth-shell";
import { SelfServiceTenantOnboardingForm } from "./self-service-tenant-onboarding-form";
import { OnboardingAccountForm } from "./onboarding-account-form";
import styles from "./auth-experience.module.css";

export type OnboardingStep = "portfolio" | "account" | "holding";
const steps = [
  { id: "portfolio", label: "포트폴리오" },
  { id: "account", label: "첫 계좌" },
  { id: "holding", label: "첫 종목" },
] as const;

export function OnboardingView({
  step,
  accountName,
  preview = false,
}: {
  step: OnboardingStep;
  accountName?: string;
  preview?: boolean;
}) {
  const activeIndex = steps.findIndex((item) => item.id === step);
  const connectionHref = `/auth/session?view=account${preview ? "&preview=design" : ""}`;
  return (
    <AuthShell
      preview={preview}
      alternate={{ href: connectionHref, label: "내 계정" }}
    >
      <section className={styles.onboardingPanel} aria-label="포트폴리오 시작">
        <ol className={styles.steps} aria-label="시작 단계">
          {steps.map((item, index) => (
            <li
              key={item.id}
              className={styles.step}
              data-current={index === activeIndex}
              data-complete={index < activeIndex}
              aria-current={index === activeIndex ? "step" : undefined}
            >
              <span className={styles.stepNumber}>
                {index < activeIndex ? (
                  <Check size={14} aria-label="완료" />
                ) : (
                  `0${index + 1}`
                )}
              </span>
              <span className={styles.stepLabel}>{item.label}</span>
            </li>
          ))}
        </ol>
        {step === "portfolio" ? (
          <>
            <AuthHeading
              eyebrow="01 / A FRESH START"
              title="나만의 포트폴리오"
              description={
                <>
                  새 포트폴리오는 빈 기록에서 시작합니다.
                  <br />
                  이전 서비스의 기록이 있다면 기존 데이터를 연결해 주세요.
                </>
              }
            />
            <SelfServiceTenantOnboardingForm preview={preview} />
            <details className={styles.disclosure}>
              <summary>이전 서비스에 기록이 있나요?</summary>
              <p>
                기존 자산을 자동으로 가져오지 않습니다. 안내받은 연결 코드가
                있다면 새 포트폴리오를 만들기 전에 기존 데이터 연결을 진행해
                주세요.
              </p>
              <Link href={connectionHref} className={styles.textLink}>
                기존 데이터 연결
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </details>
          </>
        ) : step === "account" ? (
          <>
            <AuthHeading
              eyebrow="02 / YOUR FIRST ACCOUNT"
              title="첫 계좌 등록"
              description={
                <>
                  자산을 보관하는 곳의 이름을 정해주세요.
                  <br />
                  계좌번호나 금융기관 비밀번호는 필요하지 않습니다.
                </>
              }
            />
            <OnboardingAccountForm preview={preview} />
          </>
        ) : (
          <>
            <AuthHeading
              eyebrow="03 / READY TO BEGIN"
              title="첫 종목을 기록해볼까요"
              description={
                <>
                  포트폴리오와 계좌가 준비됐습니다.
                  <br />
                  보유한 종목을 추가하면 나의 자산 흐름이 시작됩니다.
                </>
              }
            />
            <div className={styles.accountSummary}>
              <Wallet size={28} strokeWidth={1.5} aria-hidden="true" />
              <div>
                <p>{accountName}</p>
                <small>등록된 계좌 · 원화 기준 평가</small>
              </div>
            </div>
            <div className={styles.stack}>
              <Link
                className={styles.primaryButton}
                href="/portfolio/holdings/new"
              >
                <Plus size={17} aria-hidden="true" />
                보유 종목 추가
              </Link>
              <Link className={styles.secondaryButton} href="/">
                지금은 홈 둘러보기
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <p className={styles.note}>
              종목을 등록하기 전에는 평가액과 수익률이 비어 있을 수 있습니다.
            </p>
          </>
        )}
      </section>
    </AuthShell>
  );
}
