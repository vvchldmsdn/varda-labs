import Link from "next/link";

import type { SimulationInputReadinessPageModel } from "@/lib/simulation-input-readiness";

type InputReadiness = SimulationInputReadinessPageModel["inputs"][number];
type HistoryRow = SimulationInputReadinessPageModel["history"][number];
type ObservedReturn = NonNullable<InputReadiness["observedReturns"]>[number];

export function SimulationInputReadinessView({
  model,
}: {
  model: SimulationInputReadinessPageModel;
}) {
  return (
    <main
      data-page="simulation-input-readiness"
      data-runtime-trust-status={model.runtimeTrustStatus}
      data-end-query-status={model.endServiceDateSelection.status}
      className="min-h-screen overflow-x-hidden bg-[#f3f4ef] text-[#171916]"
    >
      <div className="mx-auto w-full max-w-[1400px] px-4 py-5">
        <header className="border-b border-[#d7ddcf] pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#687064]">Varda Labs</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal sm:text-3xl">
                시뮬레이션 검증
              </h1>
              <p className="mt-2 text-sm text-[#596158]">
                연구 입력 증거 준비도
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <NavLink href="/">대시보드</NavLink>
              <NavLink href="/investment-lab">투자 랩</NavLink>
              <NavLink href="/portfolio/risk">포트 구조</NavLink>
            </nav>
          </div>
          <div className="mt-4 rounded-lg border border-[#e6d8ae] bg-[#fff9e9] px-4 py-3 text-sm text-[#62542c]">
            이 화면은 저장된 시장 데이터가 연구 입력으로 사용 가능한지 확인합니다.
            시뮬레이션 실행, 미래 예측, 비중 추천 결과가 아닙니다.
          </div>
        </header>

        {model.endServiceDateSelection.status === "invalid" ? (
          <section
            data-invalid-end-query
            className="border-b border-[#d7ddcf] py-4 text-sm text-[#7a5117]"
          >
            기준일은 하나의 <code>YYYY-MM-DD</code> 값으로 입력해야 합니다. 빈 값,
            공백이 포함된 값, 중복된 값은 데이터 조회 전에 차단합니다.
          </section>
        ) : null}

        <section
          aria-label="검사 요약"
          className="grid border-b border-[#d7ddcf] py-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          <SummaryItem
            label="검사 기준일"
            value={formatDate(model.requestedEndServiceDate)}
          />
          <SummaryItem
            label="검사 범위"
            value={`${model.summary.returnStepCount}개 수익률`}
            detail={`${model.summary.requiredPointCount}개 관측점 필요`}
          />
          <SummaryItem
            label="준비된 연구 입력"
            value={`${model.summary.readyInputCount}/${model.summary.totalInputCount}`}
            detail={`${model.summary.unavailableInputCount}개 확인 필요`}
          />
          <SummaryItem
            label="실행 상태"
            value="실행 안 함"
            detail="런타임 신뢰 미확립"
          />
        </section>

        <section
          aria-label="독립 연구 입력"
          className="grid gap-4 py-5 lg:grid-cols-2"
        >
          {model.inputs.map((input) => (
            <InputPanel key={input.id} input={input} />
          ))}
        </section>

        {model.history.length > 0 ? (
          <ReadinessHistory
            rows={model.history}
            selectedServiceDate={model.requestedEndServiceDate}
          />
        ) : null}

        <footer className="border-t border-[#d7ddcf] pt-4 text-sm leading-6 text-[#687064]">
          두 종목은 서로 독립적으로 검사합니다. 현재 보유 종목, 기본 포트폴리오,
          목표 비중 또는 승인된 실행 벡터로 해석하지 않습니다. 결손이 있으면 과거
          날짜로 자동 대체하거나 범위를 임의로 줄이지 않습니다. VOO는 투자 랩의
          가격수익률 준비 상태를 재사용하지 않고 별도의 조정종가·환율 증거를
          검사합니다.
        </footer>
      </div>
    </main>
  );
}

function ReadinessHistory({
  rows,
  selectedServiceDate,
}: {
  rows: readonly HistoryRow[];
  selectedServiceDate: string;
}) {
  return (
    <section
      data-simulation-readiness-history
      aria-labelledby="simulation-readiness-history-title"
      className="border-t border-[#d7ddcf] py-5"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="simulation-readiness-history-title"
            className="text-lg font-semibold"
          >
            최근 기준일 검사
          </h2>
          <p className="mt-1 text-sm text-[#687064]">
            저장된 실행 기록이 아니라, 최근 7개 기준일을 현재 저장 증거로 다시
            검사한 결과입니다.
          </p>
        </div>
        <p className="text-xs text-[#7a8175]">날짜 자동 대체 없음</p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="border-y border-[#d7ddcf] text-xs text-[#687064]">
            <tr>
              <th className="px-3 py-3 font-semibold">기준일</th>
              <th className="px-3 py-3 font-semibold">KODEX 200</th>
              <th className="px-3 py-3 font-semibold">VOO</th>
              <th className="px-3 py-3 text-right font-semibold">검사</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const kodex200 = row.inputs.find((input) => input.id === "kodex200");
              const voo = row.inputs.find((input) => input.id === "voo");
              const selected = row.serviceDate === selectedServiceDate;

              return (
                <tr
                  key={row.serviceDate}
                  data-readiness-history-row={row.serviceDate}
                  data-kodex200-status={kodex200?.status ?? "unavailable"}
                  data-voo-status={voo?.status ?? "unavailable"}
                  className="border-b border-[#e1e5da] align-top"
                >
                  <td className="whitespace-nowrap px-3 py-3 font-semibold">
                    {formatDate(row.serviceDate)}
                    {selected ? (
                      <span className="ml-2 text-xs font-medium text-[#47624d]">
                        선택됨
                      </span>
                    ) : null}
                  </td>
                  <HistoryStatusCell input={kodex200} />
                  <HistoryStatusCell input={voo} />
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    {selected ? (
                      <span className="text-xs font-semibold text-[#687064]">
                        현재 결과
                      </span>
                    ) : (
                      <Link
                        href={`/simulation?end=${row.serviceDate}`}
                        className="inline-flex rounded-md border border-[#cfd6c8] bg-white px-3 py-2 text-xs font-semibold text-[#253029] hover:bg-[#eef1e8]"
                      >
                        이 날짜 검사
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HistoryStatusCell({
  input,
}: {
  input: HistoryRow["inputs"][number] | undefined;
}) {
  const ready = input?.status === "matrix_ready";
  return (
    <td className="px-3 py-3">
      <p className={ready ? "font-semibold text-[#226039]" : "font-semibold text-[#7a5117]"}>
        {ready ? "준비됨" : "사용 불가"}
      </p>
      <p className="mt-1 text-xs text-[#687064]">
        {formatHistoryCoverage(input)}
      </p>
      {!ready && input?.issueLabels[0] ? (
        <p className="mt-1 max-w-[300px] text-xs leading-5 text-[#7a6b4e]">
          {input.issueLabels[0]}
        </p>
      ) : null}
    </td>
  );
}

function formatHistoryCoverage(
  input: HistoryRow["inputs"][number] | undefined,
) {
  if (!input) return "커버리지 없음";
  if (input.returnCoverage) {
    return `${input.returnCoverage.readyReturnCount}/${input.returnCoverage.requiredReturnCount} 수익률 행`;
  }
  return `${input.resolvedPointCount}/${input.requiredPointCount ?? "-"} 관측점`;
}

function InputPanel({ input }: { input: InputReadiness }) {
  const ready = input.status === "matrix_ready";

  return (
    <article
      data-simulation-input={input.id}
      data-readiness-status={input.status}
      data-nearest-prior-date={input.nearestPriorObservedServiceDate ?? ""}
      className="rounded-lg border border-[#d7ddcf] bg-[#fbfcf7]"
    >
      <header className="flex items-start justify-between gap-4 border-b border-[#e1e5da] p-4">
        <div>
          <p className="text-xs font-semibold text-[#687064]">
            {input.marketLabel} · {input.currency}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-normal">
            {input.ticker} · {input.name}
          </h2>
        </div>
        <span
          className={
            ready
              ? "rounded-md bg-[#e5f1e6] px-2.5 py-1 text-xs font-semibold text-[#226039]"
              : "rounded-md bg-[#fff1dc] px-2.5 py-1 text-xs font-semibold text-[#7a5117]"
          }
        >
          {ready ? "준비됨" : "사용 불가"}
        </span>
      </header>

      <dl className="grid sm:grid-cols-2">
        <EvidenceItem label="가격 기준" value={input.priceBasisLabel} />
        <EvidenceItem label="환율 기준" value={input.fxBasisLabel} />
        <EvidenceItem
          label="요청 종료일"
          value={formatDate(input.requestedEndServiceDate)}
        />
        <EvidenceItem
          label="확정 종료일"
          value={formatDate(input.resolvedEndServiceDate)}
        />
        <EvidenceItem
          label="관측 범위"
          value={formatRange(
            input.observedServiceDateFrom,
            input.observedServiceDateTo,
          )}
        />
        <EvidenceItem
          label="기간 축"
          value={`${input.resolvedPointCount}/${input.requiredPointCount ?? "-"} 관측점`}
        />
        <EvidenceItem
          label="가격 커버리지"
          value={formatCoverage(input.priceCoverage)}
        />
        <EvidenceItem
          label="환율 커버리지"
          value={
            input.currency === "KRW"
              ? "불필요"
              : formatCoverage(input.fxCoverage)
          }
        />
        <EvidenceItem
          label="수익률 행 커버리지"
          value={formatReturnCoverage(input.returnCoverage)}
        />
        <EvidenceItem
          label="자동 재시도·날짜 대체"
          value="없음"
        />
      </dl>

      {ready && input.observedReturns ? (
        <ObservedReturnSeriesPanel input={input} rows={input.observedReturns} />
      ) : null}

      <div className="border-t border-[#e1e5da] p-4">
        <h3 className="text-sm font-semibold">
          {ready ? "증거 결손" : "확인할 항목"}
        </h3>
        {input.issues.length === 0 ? (
          <p className="mt-2 text-sm text-[#47624d]">확인된 결손이 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm text-[#6b5227]">
            {input.issues.map((issue) => (
              <li key={`${issue.code}-${issue.dates.join("-")}`}>
                {issue.label}
                {issue.dates.length > 0
                  ? ` (${issue.dates.map(formatDate).join(", ")})`
                  : ""}
              </li>
            ))}
          </ul>
        )}
        {!ready && input.nearestPriorObservedServiceDate ? (
          <Link
            data-review-nearest-prior
            href={`/simulation?end=${input.nearestPriorObservedServiceDate}`}
            className="mt-4 inline-flex rounded-md border border-[#cfd6c8] bg-white px-3 py-2 text-sm font-semibold text-[#253029] hover:bg-[#eef1e8]"
          >
            최근 관측 기준일 {formatDate(input.nearestPriorObservedServiceDate)}로 다시 검사
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function ObservedReturnSeriesPanel({
  input,
  rows,
}: {
  input: InputReadiness;
  rows: readonly ObservedReturn[];
}) {
  if (rows.length === 0) return null;

  const values = rows.map((row) => row.value);
  const maxReturn = Math.max(...values);
  const minReturn = Math.min(...values);
  const latestReturn = rows.at(-1)?.value ?? 0;
  const maxAbsoluteReturn = Math.max(
    ...values.map((value) => Math.abs(value)),
    0.000001,
  );
  const chartWidth = 720;
  const chartHeight = 220;
  const horizontalPadding = 24;
  const verticalAmplitude = 82;
  const zeroY = chartHeight / 2;
  const drawableWidth = chartWidth - horizontalPadding * 2;
  const points = rows
    .map((row, index) => {
      const x =
        horizontalPadding +
        (index / Math.max(rows.length - 1, 1)) * drawableWidth;
      const y = zeroY - (row.value / maxAbsoluteReturn) * verticalAmplitude;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <section
      data-observed-return-series={input.id}
      data-return-row-count={rows.length}
      aria-labelledby={`observed-returns-${input.id}`}
      className="border-t border-[#e1e5da] p-4"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3
            id={`observed-returns-${input.id}`}
            className="text-sm font-semibold"
          >
            {rows.length}개 관측 수익률
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#687064]">
            저장된 조정종가와 기준일별 환율로 계산한 과거 KRW 단순수익률입니다.
          </p>
        </div>
        <p className="text-xs text-[#7a8175]">예측·시뮬레이션 경로 아님</p>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#e1e5da] bg-[#e1e5da] text-sm sm:grid-cols-4">
        <ReturnSummaryItem label="관측 행" value={`${rows.length}개`} />
        <ReturnSummaryItem
          label="최근 수익률"
          value={formatSignedReturn(latestReturn)}
        />
        <ReturnSummaryItem label="최고" value={formatSignedReturn(maxReturn)} />
        <ReturnSummaryItem label="최저" value={formatSignedReturn(minReturn)} />
      </dl>

      <div className="mt-4 overflow-x-auto rounded-md border border-[#e1e5da] bg-white">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label={`${input.ticker}의 과거 ${rows.length}개 KRW 단순수익률 차트`}
          className="h-auto w-full min-w-[640px]"
        >
          <title>{`${input.ticker} 과거 KRW 단순수익률`}</title>
          <line
            x1={horizontalPadding}
            x2={chartWidth - horizontalPadding}
            y1={zeroY}
            y2={zeroY}
            stroke="#cbd2c5"
            strokeWidth="1"
          />
          <polyline
            points={points}
            fill="none"
            stroke="#1f4a3d"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="mt-2 flex justify-between text-xs text-[#7a8175]">
        <span>{formatDate(rows[0]?.serviceDate ?? null)}</span>
        <span>{formatDate(rows.at(-1)?.serviceDate ?? null)}</span>
      </div>

      <details
        data-observed-return-table
        className="mt-4 border-t border-[#e1e5da] pt-3"
      >
        <summary className="cursor-pointer text-sm font-semibold text-[#253029]">
          전체 {rows.length}개 수익률 표 보기
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <thead className="border-y border-[#d7ddcf] text-xs text-[#687064]">
              <tr>
                <th className="px-3 py-2 font-semibold">이전 기준일</th>
                <th className="px-3 py-2 font-semibold">기준일</th>
                <th className="px-3 py-2 text-right font-semibold">KRW 수익률</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.serviceDate} className="border-b border-[#e8ebe3]">
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatDate(row.previousServiceDate)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    {formatDate(row.serviceDate)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {formatSignedReturn(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function ReturnSummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#fbfcf7] px-3 py-2">
      <dt className="text-xs text-[#687064]">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="border-[#d7ddcf] px-4 py-2 first:pl-0 sm:border-r sm:last:border-r-0">
      <p className="text-xs font-medium text-[#687064]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {detail ? <p className="mt-1 text-xs text-[#7a8175]">{detail}</p> : null}
    </div>
  );
}

function EvidenceItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[#e8ebe3] px-4 py-3 sm:odd:border-r">
      <dt className="text-xs font-medium text-[#687064]">{label}</dt>
      <dd className="mt-1 text-sm font-semibold">{value}</dd>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-[#253029] hover:bg-[#eef1e8]"
    >
      {children}
    </Link>
  );
}

function formatCoverage(
  coverage:
    | Readonly<{
        coveredServiceDateCount: number;
        requiredServiceDateCount: number;
        coveragePct: number;
      }>
    | null,
) {
  if (!coverage) return "검사 전";
  return `${coverage.coveredServiceDateCount}/${coverage.requiredServiceDateCount} · ${formatPct(coverage.coveragePct)}`;
}

function formatReturnCoverage(
  coverage:
    | Readonly<{
        readyReturnCount: number;
        requiredReturnCount: number;
        coveragePct: number;
      }>
    | null,
) {
  if (!coverage) return "검사 전";
  return `${coverage.readyReturnCount}/${coverage.requiredReturnCount} · ${formatPct(coverage.coveragePct)}`;
}

function formatRange(from: string | null, to: string | null) {
  if (!from || !to) return "관측 없음";
  return `${formatDate(from)} ~ ${formatDate(to)}`;
}

function formatDate(value: string | null) {
  return value ? value.replaceAll("-", ".") : "-";
}

function formatPct(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatSignedReturn(value: number) {
  const percentage = value * 100;
  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(2)}%`;
}
