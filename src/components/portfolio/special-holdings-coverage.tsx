import type {
  PortfolioHoldingAdjustmentReason,
  PortfolioHoldingClassification,
  PortfolioHoldingValuationStatus,
  PortfolioSpecialHoldingsModel,
} from "@/lib/portfolio-special-holdings";
import type { ReactNode } from "react";

export function SpecialHoldingsCoverage({
  model,
}: {
  model: PortfolioSpecialHoldingsModel;
}) {
  return (
    <section
      aria-labelledby="special-holdings-coverage-title"
      className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
      data-adjustable-position-count={model.adjustablePositionCount}
      data-managed-sleeve-count={model.managedSleeveCount}
      data-physical-commodity-count={model.physicalCommodityPositionCount}
      data-policy={model.policy.version}
      data-section="special-holdings-coverage"
      data-status={model.status}
      data-unresolved-position-count={model.unresolvedCount}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            className="text-lg font-semibold tracking-normal"
            id="special-holdings-coverage-title"
          >
            특수 보유자산 커버리지·조정 가능성
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-[#687064]">
            저장된 상품 유형과 상장 식별 근거만 사용합니다. 이름으로 상품
            유형을 추론하지 않으며, 이 표시는 추천·주문 권한이 아닙니다.
          </p>
        </div>
        <p className="text-sm font-semibold text-[#3f4b40]">
          상태 {statusLabel(model.status)}
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCell
          detail={`평가액 비중 ${formatPercent(model.adjustableValuedWeightPct)}`}
          label="조정 가능"
          value={`${model.adjustablePositionCount}/${model.totalPositionCount}`}
        />
        <SummaryCell
          detail="exact ticker identity"
          label="상장 종목"
          value={String(model.listedInstrumentCount)}
        />
        <SummaryCell
          detail="별도 거래 단위 필요"
          label="실물 원자재"
          value={String(model.physicalCommodityPositionCount)}
        />
        <SummaryCell
          detail="명시적 asset_type만 인정"
          label="일임 sleeve"
          value={String(model.managedSleeveCount)}
        />
        <SummaryCell
          detail={`조정 제외 비중 ${formatPercent(model.ineligibleValuedWeightPct)}`}
          label="미분류"
          value={String(model.unresolvedCount)}
        />
      </div>

      {model.attentionRows.length === 0 ? (
        <p className="mt-4 rounded-md border border-[#d8e4d2] bg-[#f3faef] px-4 py-3 text-sm text-[#36563a]">
          현재 선택 범위의 모든 보유자산이 상장 종목 identity와 평가 근거를
          갖고 있습니다.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
            <thead className="text-xs uppercase text-[#687064]">
              <tr>
                <TableHeader>보유자산</TableHeader>
                <TableHeader>계정</TableHeader>
                <TableHeader>분류</TableHeader>
                <TableHeader>평가 상태</TableHeader>
                <TableHeader align="right">평가액</TableHeader>
                <TableHeader align="right">평가 비중</TableHeader>
                <TableHeader>조정 제외 이유</TableHeader>
              </tr>
            </thead>
            <tbody>
              {model.attentionRows.map((row) => (
                <tr key={row.key}>
                  <TableCell strong>
                    <div>{row.ticker ?? "-"}</div>
                    <div className="text-xs font-normal text-[#687064]">
                      {row.name}
                    </div>
                  </TableCell>
                  <TableCell>{row.account}</TableCell>
                  <TableCell>{classificationLabel(row.classification)}</TableCell>
                  <TableCell>{valuationLabel(row.valuationStatus)}</TableCell>
                  <TableCell align="right">{formatKrw(row.currentValueKrw)}</TableCell>
                  <TableCell align="right">
                    {formatPercent(row.currentWeightPct)}
                  </TableCell>
                  <TableCell>{reasonLabel(row.adjustmentReason)}</TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-[#73786c]">
        평가 완료 {model.valuedPositionCount}개 · 평가 제외 {" "}
        {model.excludedPositionCount}개 · 조정 제외 {model.ineligiblePositionCount}개
      </p>
    </section>
  );
}

function SummaryCell({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-[#e2e6da] bg-white p-3">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-[#111411]">
        {value}
      </p>
      <p className="mt-1 text-xs text-[#73786c]">{detail}</p>
    </div>
  );
}

function TableHeader({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`border-b border-[#dfe3d5] px-3 py-2 font-semibold ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function TableCell({
  children,
  align = "left",
  strong = false,
}: {
  children: ReactNode;
  align?: "left" | "right";
  strong?: boolean;
}) {
  return (
    <td
      className={`border-b border-[#edf0e7] px-3 py-2 align-top ${
        align === "right" ? "text-right" : "text-left"
      } ${strong ? "font-semibold" : ""}`}
    >
      {children}
    </td>
  );
}

function statusLabel(status: PortfolioSpecialHoldingsModel["status"]) {
  if (status === "complete") return "완전";
  if (status === "review_required") return "검토 필요";
  return "데이터 없음";
}

function classificationLabel(value: PortfolioHoldingClassification) {
  if (value === "listed_instrument") return "상장 종목";
  if (value === "physical_commodity_position") return "실물 원자재";
  if (value === "managed_sleeve") return "일임 sleeve";
  return "미분류";
}

function valuationLabel(value: PortfolioHoldingValuationStatus) {
  if (value === "valued") return "평가 완료";
  if (value === "missing_price") return "가격 없음";
  if (value === "missing_fx") return "환율 없음";
  return "미지원 통화";
}

function reasonLabel(value: PortfolioHoldingAdjustmentReason) {
  if (value === "listed_instrument_ready") return "-";
  if (value === "valuation_evidence_incomplete") return "평가 근거 불완전";
  if (value === "physical_commodity_execution_model_unavailable") {
    return "거래 단위·체결 모델 미확정";
  }
  if (value === "managed_sleeve_not_directly_adjustable") {
    return "내부 구성·직접 조정 권한 없음";
  }
  return "상품 유형·외부 식별 근거 부족";
}

function formatKrw(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}
