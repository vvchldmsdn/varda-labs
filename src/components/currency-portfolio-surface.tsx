"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppNavigation } from "@/components/app-navigation";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { CurrencyTrackedView } from "@/components/currency-tracked-view";
import { CurrencyResearchView } from "@/components/currency-research-view";
import { useI18n } from "@/components/i18n/locale-provider";
import type { CurrencyTrackedInput } from "@/lib/currency-tracked-portfolio";
import type { CurrencyResearchInput } from "@/lib/currency-research";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { Currency } from "@/lib/money";
import styles from "./currency-portfolio-surface.module.css";

export type CurrencySurface = "home" | "today" | "history" | "structure" | "contribution" | "lab" | "simulation";
const paths: Record<CurrencySurface, string> = { home: "/", today: "/today", history: "/history", structure: "/portfolio/structure", contribution: "/additional-contribution", lab: "/investment-lab", simulation: "/simulation" };
export function CurrencyPortfolioSurface({ surface, evidence, research, scopes, selectedScope, economicUnsupported = false, researchUnavailableReason, contributionPolicy, reporting = evidence?.reporting ?? research?.reportingCurrency ?? "USD" }: {
  surface: CurrencySurface; evidence?: CurrencyTrackedInput; research?: CurrencyResearchInput | null;
  scopes: readonly PortfolioAnalysisScope[]; selectedScope: PortfolioAnalysisScope;
  economicUnsupported?: boolean;
  researchUnavailableReason?: string;
  reporting?: Currency;
  contributionPolicy?: { trimDriftThresholdPct: number; minimumExecutionRatioPct: number };
}) {
  const { t } = useI18n();
  const params = useSearchParams();
  const path = paths[surface];
  const query = { ...Object.fromEntries(params.entries()), currency: reporting };
  const historicQuery = new URLSearchParams(params.toString());
  historicQuery.set("scope", selectedScope.key); historicQuery.set("currency", reporting); historicQuery.set("model", "bootstrap");
  if (researchUnavailableReason === "invalid_horizon") historicQuery.delete("horizon");
  if (researchUnavailableReason === "invalid_end_date") historicQuery.delete("end");
  const historicHref = `/simulation?${historicQuery.toString()}`;
  const invalidSelection = researchUnavailableReason?.startsWith("invalid_");
  const researchReason = researchUnavailableReason === "native_cash_component_not_supported" ? t("현재 경제 모형에는 보유 현금을 계산하는 항목이 없습니다. 현금 비중을 포함한 과거 수익률 경로를 선택할 수 있어요.", "This economic model has no cash component. Historical paths can include your cash weight.")
    : researchUnavailableReason === "native_portfolio_input_mismatch" ? t("경제 모형의 자산·금액·비중이 현재 보유 기록과 일치하지 않아 계산을 보류합니다.", "The economic model's assets, values or weights do not match your current holdings.")
    : researchUnavailableReason === "native_valuation_incomplete" ? t("현재 보유 자산과 현금의 전체 평가가 확인되어야 계산할 수 있어요.", "Complete current valuations of holdings and cash are required.")
    : researchUnavailableReason === "invalid_horizon" ? t("계산 기간은 63개 또는 126개 시장 관측으로 선택해 주세요.", "Choose a horizon of 63 or 126 market observations.")
    : researchUnavailableReason === "invalid_end_date" ? t("과거 기준일은 오늘까지의 올바른 날짜 하나로 선택해 주세요.", "Choose one valid historical date no later than today.")
    : researchUnavailableReason === "invalid_model" ? t("경제지표 또는 과거 수익률 경로를 선택해 주세요.", "Choose economic or historical paths.") : null;
  const ledgerHref = selectedScope.kind === "account" ? `/portfolio/ledger?accountId=${encodeURIComponent(selectedScope.accountId)}` : "/portfolio/ledger";
  return <div className={styles.surface}>
    <AppNavigation activePath={path} selectedScopeKey={selectedScope.key} />
    <div className={styles.controls}><PortfolioAnalysisScopeTabs basePath={path} scopes={scopes} selectedScopeKey={selectedScope.key} query={query} variant="underline" /><Link className={styles.ledgerLink} href={ledgerHref}>{t("보유 정보 보완 ↗", "Complete holding details ↗")}</Link></div>
    {economicUnsupported || (surface === "simulation" && researchUnavailableReason) ? <main id="varda-main-content" className={styles.unavailable}><p className={styles.eyebrow}>{invalidSelection ? t("계산 조건", "RESEARCH SETTINGS") : t("경제지표 경로", "ECONOMIC PATHS")} · {reporting}</p><h1>{invalidSelection ? t("계산 조건을 확인해 주세요.", "Check the research settings.") : reporting === "USD" ? t("달러 기준 경제 모형은 아직 준비 중이에요.", "Economic paths are not yet available in USD.") : t("이 보유 구성의 경제 모형은 아직 준비 중이에요.", "Economic paths are not yet available for these holdings.")}</h1><p>{researchReason ?? (reporting === "USD" ? t("현재 경제 모형은 원화 수익률로 학습합니다. 달러 기준의 과거 수익률 경로를 선택할 수 있어요.", "The current economic model is calibrated to KRW returns. You can choose historical paths in USD instead.") : t("확인된 가격 이력으로 과거 수익률 경로를 계산할 수 있어요.", "You can explore historical paths using verified price history."))}</p><Link href={historicHref}>{t("과거 수익률 경로 보기 →", "Explore historical paths →")}</Link></main>
      : evidence ? <><CurrencyTrackedView key={`${evidence.ownerId}:${selectedScope.key}:${surface}:${evidence.reporting}`} evidence={evidence} surface={surface === "lab" || surface === "simulation" ? undefined : surface} contributionPolicy={contributionPolicy} nativeContributionScopeKey={surface === "contribution" ? selectedScope.key : undefined} hideCurrencyControl />{surface === "structure" && research ? <CurrencyResearchView evidence={research} surface="structure" hideCurrencyControl /> : null}</>
      : research ? <CurrencyResearchView key={`${research.input.version === 3 ? research.input.ownerId : "amount"}:${selectedScope.key}:${surface}:${reporting}`} evidence={research} surface={surface === "lab" || surface === "simulation" ? surface : undefined} hideCurrencyControl />
      : <main id="varda-main-content" className={styles.unavailable}><h1>{t("분석에 필요한 보유 정보가 부족해요.", "More holding evidence is needed.")}</h1><p>{t("보유 수량과 가격 이력을 확인한 뒤 이 화면에서 이어서 볼 수 있어요.", "Add verifiable quantities and price history to continue here.")}</p><Link href={ledgerHref}>{t("보유 정보 보완 →", "Complete holding details →")}</Link></main>}
  </div>;
}
