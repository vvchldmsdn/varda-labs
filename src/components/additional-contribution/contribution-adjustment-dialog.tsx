"use client";

import dynamic from "next/dynamic";
import { PresentationDialog } from "@/components/presentation/presentation-dialog";
import { T } from "@/components/i18n/localized-text";
import type { AdditionalContributionResultPreview } from "@/lib/additional-contribution-view";
import type { ContributionMarketContext } from "@/lib/contribution-market-context";

const AdjustmentPanel = dynamic(() => import("./contribution-adjustment-panel").then((module) => module.ContributionAdjustmentPanel), {
  ssr: false,
  loading: () => <p role="status"><T ko="비교 화면을 준비하고 있습니다." en="Preparing the comparison." /></p>,
});

export function ContributionAdjustmentDialog({ preview, context }: {
  preview: AdditionalContributionResultPreview;
  context?: ContributionMarketContext;
}) {
  return <PresentationDialog label="시장·투입 가정" labelEn="Market & cash assumptions" title="관측은 확인하고, 가정은 비교하세요." titleEn="Check the facts. Compare your assumptions." description="기본 배분안 옆에서 확인하는 선택형 비교입니다." descriptionEn="An optional comparison alongside your base allocation." mountOnOpen wide>
    <AdjustmentPanel key={`${preview.serviceDate}:${preview.cashAmountKrw}:${preview.rows.map((row) => `${row.allocationKey}:${row.allocationKrw}`).join("|")}`} preview={preview} context={context} />
  </PresentationDialog>;
}
