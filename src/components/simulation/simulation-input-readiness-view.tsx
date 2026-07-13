import Link from "next/link";

import type { SimulationInputReadinessModel } from "@/lib/simulation-input-readiness";

type InputReadiness = SimulationInputReadinessModel["inputs"][number];

export function SimulationInputReadinessView({
  model,
}: {
  model: SimulationInputReadinessModel;
}) {
  return (
    <main
      data-page="simulation-input-readiness"
      data-runtime-trust-status={model.runtimeTrustStatus}
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
