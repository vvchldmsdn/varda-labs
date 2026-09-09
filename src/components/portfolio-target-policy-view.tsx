import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { T } from "@/components/i18n/localized-text";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { buildPortfolioAnalysisScopeHref, type PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import { buildPortfolioTargetNavigation } from "@/lib/portfolio-target-navigation";
import { PortfolioTargetPolicyForm } from "./portfolio-target-policy-form";
import type { PortfolioTargetEditorRow } from "./portfolio-target-policy-editor";
import styles from "./portfolio-target-policy.module.css";

export function PortfolioTargetPolicyView({ selectedScope, scopes, serviceDate, rows, universeHash, isReady, policyStatus, approvalRevision, from, amount, isDesignPreview = false }: {
  selectedScope: PortfolioAnalysisScope;
  scopes: readonly PortfolioAnalysisScope[];
  serviceDate: string;
  rows: readonly PortfolioTargetEditorRow[];
  universeHash: string | null;
  isReady: boolean;
  policyStatus: string;
  approvalRevision: number | null;
  from?: string | string[];
  amount?: string | string[];
  isDesignPreview?: boolean;
}) {
  const navigation = buildPortfolioTargetNavigation({ scopeKey: selectedScope.key, from, amount, isDesignPreview });
  const approved = policyStatus === "available";
  const needsReview = ["conflict", "integrity_error", "universe_mismatch", "not_effective"].includes(policyStatus);
  return <main className="varda-page" data-page="portfolio-targets" data-design-preview={isDesignPreview || undefined}>
    <SecondaryPageHeader />
    <div className={styles.content} id="varda-main-content" tabIndex={-1}>
      <Link className={styles.back} href={navigation.returnHref}><ArrowLeft size={15} aria-hidden="true" /><T {...navigation.returnLabel} /></Link>
      <header className={styles.heading}>
        <div><p className={styles.eyebrow}>MY PORTFOLIO · MY PLAN</p><h1><T ko="나만의 균형을 정해요." en="Set your own balance." /></h1><p><T ko="목표비중은 각 종목을 얼마나 담고 싶은지 정하는 기준입니다. 선택한 범위 안에서 원하는 비율을 입력하세요." en="Target weights describe how much of each holding you want in your portfolio. Set your preferred shares within the selected scope." /></p></div>
        {isDesignPreview ? <span className={styles.headingBadge}><T ko="예시 · 저장 불가" en="Demo · No saving" /></span> : null}
      </header>
      <div className={styles.scope}><PortfolioAnalysisScopeTabs basePath="/portfolio/targets" query={navigation.contextQuery} scopes={scopes} selectedScopeKey={selectedScope.key} variant="underline" /></div>
      <div className={styles.context}>
        <span><strong>{selectedScope.kind === "all" ? <T ko="전체 자산" en="All assets" /> : selectedScope.label}</strong> · <T ko={`${rows.length}종목`} en={`${rows.length} holdings`} /></span>
        <span><T ko={isDesignPreview ? "예시 기준일" : "적용 기준일"} en={isDesignPreview ? "Demo date" : "Service date"} /> {serviceDate.replaceAll("-", ".")}</span>
        <span>{approved ? <T ko={`승인본 ${approvalRevision ?? "—"} 편집`} en={`Editing approved revision ${approvalRevision ?? "—"}`} /> : <T ko={needsReview ? "이전 목표 검토 필요" : "아직 승인된 목표 없음"} en={needsReview ? "Previous targets need review" : "No approved targets yet"} />}</span>
      </div>
      {!approved && isReady ? <div className={styles.notice}><strong><T ko={needsReview ? "현재 구성에 맞춰 목표를 다시 확인해 주세요." : "편집을 시작할 값을 준비했어요."} en={needsReview ? "Review targets against your current holdings." : "A starting point for your targets."} /></strong><T ko="승인된 목표나 추천이 아닙니다. 원하는 비중으로 편집한 뒤 직접 저장해 주세요." en="These are not approved targets or recommendations. Edit the shares to your preference, then save them yourself." /><details><summary><T ko="시작값은 어떻게 정했나요?" en="Where do the starting values come from?" /></summary><p><T ko="목표 설정이 가능한 종목의 확인된 평가액 비율을 사용합니다. 평가액 합계가 없으면 같은 비중으로 나눕니다. 둘 모두 합계를 100%로 맞춘 편집용 시작값이며, 현재 비중 표시와 다를 수 있습니다." en="Eligible holdings use the proportions of available valuations. If their total value is zero, they start with equal shares. Both are rounded to total 100% for editing and may differ from the displayed current weights." /></p></details></div> : null}
      {isReady && universeHash ? <PortfolioTargetPolicyForm key={`${selectedScope.key}:${universeHash}`} rows={rows} scopeKey={selectedScope.key} universeHash={universeHash} isDesignPreview={isDesignPreview} returnHref={navigation.returnHref} returnLabel={navigation.returnLabel} /> : <div className={styles.blocked}>
        <h2><T ko={rows.length === 0 ? "보유종목부터 연결해 주세요." : "보유종목 구성을 확인해 주세요."} en={rows.length === 0 ? "Start with your holdings." : "Check your holdings first."} /></h2>
        <p><T ko="선택한 범위의 계좌와 보유종목 연결을 확인하면 목표비중을 설정할 수 있습니다. 현재 저장된 목표는 변경하지 않습니다." en="Check the accounts and holdings linked to this scope before setting targets. Existing targets remain unchanged." /></p>
        <Link href={buildPortfolioAnalysisScopeHref("/portfolio/holdings", selectedScope.key, isDesignPreview ? { preview: "design" } : {})}><T ko="보유종목 확인" en="Review holdings" /><ArrowRight size={15} aria-hidden="true" /></Link>
      </div>}
    </div>
  </main>;
}
