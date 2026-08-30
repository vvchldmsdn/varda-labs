import type { PortfolioDirectHoldingsBaseline } from "@/lib/portfolio-direct-holdings";

const ACCOUNT_LABELS: Record<
  PortfolioDirectHoldingsBaseline["selectedAccount"],
  string
> = {
  brokerage: "증권",
  isa: "ISA",
  irp: "IRP",
  all: "전체",
};

export function DirectHoldingsBaseline({
  model,
  scopeLabel,
}: {
  model: PortfolioDirectHoldingsBaseline;
  scopeLabel?: string;
}) {
  const metrics = model.metrics;

  return (
    <section
      aria-labelledby="direct-holdings-baseline-title"
      className="border-t border-[var(--line)] pt-8 lg:pt-10"
      data-direct-holding-count={model.directHoldingCount}
      data-excluded-holding-count={model.excludedHoldingCount}
      data-policy={model.policy.version}
      data-section="direct-holdings-baseline"
      data-status={model.status}
      data-unresolved-identity-count={model.unresolvedIdentityCount}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-[var(--muted)]">
            CONCENTRATION / CURRENCY
          </p>
          <h2
            className="mt-1 text-xl font-medium tracking-normal sm:text-2xl"
            id="direct-holdings-baseline-title"
          >
            직접 보유 집중도·통화 노출
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            {scopeLabel ?? ACCOUNT_LABELS[model.selectedAccount]}의 현재 평가액을 직접 보유
            종목 기준으로 계산했습니다. ETF 내부 구성, 목표비중, 추천, 주문은
            포함하지 않습니다.
          </p>
        </div>
        <p className="text-sm font-medium text-[var(--muted)]">
          평가 완전성 {statusLabel(model.status)}
        </p>
      </div>

      {metrics ? (
        <>
          <div className="mt-7 grid border-y border-[var(--line)] sm:grid-cols-2 xl:grid-cols-5">
            <MetricCell
              detail={`식별 가능한 직접 보유 ${model.directHoldingCount}개`}
              label="평가액"
              value={formatKrw(metrics.totalValueKrw)}
            />
            <MetricCell
              detail="0에 가까울수록 분산"
              label="HHI"
              value={formatNumber(metrics.hhiPoints, 0)}
            />
            <MetricCell
              detail="1 / 보유비중 제곱합"
              label="유효 종목 수"
              value={formatNumber(metrics.effectiveHoldingCount, 2)}
            />
            <MetricCell
              detail={largestHoldingLabel(model)}
              label="최대 보유비중"
              value={formatPercent(metrics.largestHoldingWeightPct)}
            />
            <MetricCell
              detail="직접 보유 상위 3개 합계"
              label="상위 3개 집중도"
              value={formatPercent(metrics.topThreeWeightPct)}
            />
          </div>

          <div className="mt-8">
            <h3 className="text-sm font-medium text-[var(--ink)]">통화별 노출</h3>
            <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.currencyExposures.map((row) => (
                <div
                  className="border-l border-[var(--line)] pl-4"
                  key={row.currency}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{row.currency}</span>
                    <span className="font-semibold tabular-nums">
                      {formatPercent(row.currentWeightPct)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs tabular-nums text-[var(--muted)]">
                    {formatKrw(row.currentValueKrw)} · {row.holdingCount}개
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="mt-7 border-y border-[var(--warning-soft)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--warning)]">
          식별 가능하고 평가액이 있는 직접 보유 종목이 없어 집중도와 통화
          노출을 계산하지 않았습니다.
        </p>
      )}

      {model.status === "partial" ? (
        <p className="mt-6 border-y border-[var(--warning-soft)] bg-[var(--surface)] px-4 py-3 text-xs leading-5 text-[var(--warning)]">
          표시된 값은 확인 가능한 종목만의 부분 계산입니다. 평가 제외 {" "}
          {model.excludedHoldingCount}개 · 식별 불가 {" "}
          {model.unresolvedIdentityCount}개 · 평가액 오류 {" "}
          {model.invalidValueCount}개
        </p>
      ) : null}

      <p className="mt-3 text-xs text-[var(--muted)]">
        평가 근거 {model.resolvedInputHoldingCount}/{model.inputHoldingCount}행 ·
        identity: account + market + currency + ticker
      </p>
    </section>
  );
}

function MetricCell({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 border-b border-[var(--wash)] px-4 py-5 xl:border-b-0 xl:border-r xl:last:border-r-0">
      <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-3 text-xl font-medium tracking-normal tabular-nums text-[var(--ink)]">
        {value}
      </p>
      <p className="mt-1 truncate text-xs text-[var(--muted)]" title={detail}>
        {detail}
      </p>
    </div>
  );
}

function statusLabel(status: PortfolioDirectHoldingsBaseline["status"]) {
  switch (status) {
    case "complete":
      return "완전";
    case "partial":
      return "부분 계산";
    case "unavailable":
      return "계산 불가";
  }
}

function largestHoldingLabel(model: PortfolioDirectHoldingsBaseline) {
  if (!model.largestHolding) return "-";
  return `${model.largestHolding.ticker} · ${model.largestHolding.name}`;
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number, maximumFractionDigits: number) {
  return value.toLocaleString("ko-KR", { maximumFractionDigits });
}

function formatPercent(value: number) {
  return `${value.toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  })}%`;
}
