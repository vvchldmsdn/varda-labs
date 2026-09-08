"use client";

import { LabText } from "./lab-text";
import { useSearchParams } from "next/navigation";
import type { InvestmentLabPerformanceData } from "@/db/queries/investment-lab-performance";
import { useResearchDetail, ResearchDetailStatus } from "./research-detail-resource";
import { InvestmentLabPerformanceDetails } from "./investment-lab-performance-details";

export default function InvestmentLabPerformanceResource() {
  const params = useSearchParams();
  const query = new URLSearchParams(params.toString());
  query.set("detail", "performance");
  const { data, error, retry } = useResearchDetail<InvestmentLabPerformanceData | { preview: true }>("/api/research/investment-lab", query.toString());
  if (!data) return <ResearchDetailStatus error={error} retry={retry} />;
  return data.preview ? <p className="text-sm text-[var(--muted)]"><LabText value="예시 화면의 시나리오 요약입니다." /></p> : <InvestmentLabPerformanceDetails data={data} />;
}
