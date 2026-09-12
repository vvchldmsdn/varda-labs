import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { localizedMetadata } from "@/lib/i18n/server";
import { T } from "@/components/i18n/localized-text";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { HoldingOnboardingForm } from "@/components/holding-onboarding-form";
import { getHoldingOnboardingOptions, type HoldingOnboardingOptions } from "@/db/queries/holding-onboarding";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { resolveHoldingOnboardingAccountId } from "@/lib/holding-onboarding";
import "@/components/onboarding/holding-onboarding.css";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return localizedMetadata({ title: "보유 종목 추가 | VARDA LABS" }, "Add holdings | VARDA LABS");
}

export default async function NewHoldingPage({ searchParams }: { searchParams: Promise<{ preview?: string; accountId?: string | string[]; from?: string }> }) {
  const params = await searchParams;
  const preview = process.env.NODE_ENV === "development" && params.preview === "design";
  const resolution = preview ? null : await resolveCurrentTenantContext();
  const options: HoldingOnboardingOptions | { state: "unavailable" } | null = preview ? {
    state: "ready", accounts: [{ id: "11111111-1111-4111-8111-111111111111", code: "preview", name: "나의 증권 계좌", accountType: "securities" }], portfolioGroups: [],
  } : resolution?.ok ? await getHoldingOnboardingOptions(resolution.tenantContext) : null;
  const initialAccountId = options?.state === "ready"
    ? resolveHoldingOnboardingAccountId(options.accounts, params.accountId)
    : "";
  return <main className="varda-holding-add-page" data-design-preview={preview || undefined}>
    <SecondaryPageHeader />
    <div className="varda-holding-add-content">
      <Link className="varda-holding-add-back" href={preview ? "/portfolio/onboarding?preview=design&step=holding" : "/portfolio/holdings"}><ArrowLeft size={15} /><T ko="돌아가기" en="Back" /></Link>
      <header className="varda-holding-add-heading"><p className="varda-onboarding-eyebrow">YOUR PORTFOLIO STARTS HERE</p><h1><T ko="이름과 수량으로 시작해요." en="A name. A quantity. A start." /></h1><p><T ko="보유한 종목을 찾아 목록에 담아 주세요. 매입가와 세부 설정은 나중에 채워도 괜찮습니다." en="Find your holdings and add them to the list. Purchase prices and other details can come later." /></p></header>
      {!preview && !resolution?.ok ? <div className="varda-onboarding-error"><T ko="로그인 후 보유종목을 추가할 수 있습니다." en="Sign in to add holdings." /><p><Link className="varda-onboarding-text-button" href="/auth/sign-in"><T ko="로그인" en="Sign in" /></Link></p></div>
        : options?.state !== "ready" ? <p className="varda-onboarding-error"><T ko="계좌 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." en="Accounts could not be loaded. Please try again shortly." /></p>
        : options.accounts.length === 0 ? <div><p><T ko="종목을 담을 첫 계좌를 먼저 준비해 주세요." en="Create your first account before adding holdings." /></p><Link className="varda-onboarding-text-button" href="/portfolio/onboarding"><T ko="첫 계좌 만들기" en="Create your first account" /></Link></div>
        : <HoldingOnboardingForm key={initialAccountId} options={options} initialAccountId={initialAccountId} preview={preview} fromPlan={params.from === "plan"} />}
      {params.from === "plan" && options?.state === "ready" && options.accounts.length === 0 ? <p className="varda-onboarding-hint"><T ko="저장한 계획은 그대로 남아 있어요. 계좌를 만든 뒤 내 계획에서 종목 등록을 이어갈 수 있습니다." en="Your saved plan remains available. After creating an account, continue adding holdings from My plans." /><Link className="varda-onboarding-text-button" href="/plans"><T ko="나중에 등록하고 내 계획으로" en="Add holdings later and return to my plans" /></Link></p> : null}
    </div>
  </main>;
}
