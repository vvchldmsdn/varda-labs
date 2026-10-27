import { redirect } from "next/navigation";
import Link from "next/link";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { getSavedCurrencyResearch } from "@/db/queries/currency-research";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { CurrencyResearchView } from "@/components/currency-research-view";
import { currencyResearchFixture } from "@/lib/currency-research-fixture";
import { getLocale } from "@/lib/i18n/server";
import { isPlanId } from "@/lib/investment-plan";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio research | CAIRN LABS", robots: { index: false, follow: false } };
export default async function ReportingResearchPage({ searchParams }: { searchParams: Promise<{ preview?: string; draft?: string }> }) {
  const params = await searchParams;
  if (process.env.NODE_ENV === "development" && params.preview === "currency") {
    return <><SecondaryPageHeader researchHref="/portfolio/research?preview=currency" /><CurrencyResearchView evidence={currencyResearchFixture()} /></>;
  }
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) redirect("/auth/sign-in");
  const input = params.draft && !isPlanId(params.draft) ? null : await getSavedCurrencyResearch(resolution.tenantContext, params.draft);
  const en = await getLocale() === "en";
  return <><SecondaryPageHeader researchHref={params.draft && isPlanId(params.draft) ? `/portfolio/research?draft=${encodeURIComponent(params.draft)}` : "/portfolio/research"} />{input ? <CurrencyResearchView evidence={input} /> : <main className="mx-auto max-w-4xl px-6 py-12"><h1 className="text-3xl">{en ? "Start with your assets" : "내 자산으로 시작하세요"}</h1><Link href="/try/analyze" className="mt-6 inline-block underline">{en ? "Enter amounts →" : "금액 입력하기 →"}</Link></main>}</>;
}
