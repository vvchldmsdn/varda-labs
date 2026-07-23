import type { SimulationResearchUniversePreflightModel } from "@/lib/simulation-research-universe-preflight";

export function ResearchUniversePreflightSection({
  model,
  preservedQuery,
}: {
  model: SimulationResearchUniversePreflightModel;
  preservedQuery: Readonly<{
    end: string | null;
    horizon: string | null;
    kodexWeight: string | null;
  }>;
}) {
  return (
    <section
      aria-labelledby="research-universe-preflight-title"
      className="border-b border-[#d7ddcf] py-5"
      data-research-universe-preflight
      data-research-universe-selection={model.selectionStatus}
      data-research-universe-status={model.status}
      data-runtime-trust-status={model.runtimeTrustStatus}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2
            className="text-lg font-semibold"
            id="research-universe-preflight-title"
          >
            연구 종목 데이터 점검
          </h2>
          <p className="mt-1 text-sm text-[#687064]">
            계정과 연결하지 않은 연구 입력입니다. 저장된 가격·환율·출처만
            확인하며 시뮬레이션은 실행하지 않습니다.
          </p>
        </div>
        <span className="text-xs font-semibold text-[#687064]">
          실행 권한 미확립
        </span>
      </div>

      <form
        action="/simulation"
        className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
        method="get"
      >
        {preservedQuery.end ? (
          <input name="end" type="hidden" value={preservedQuery.end} />
        ) : null}
        {preservedQuery.horizon ? (
          <input
            name="horizon"
            type="hidden"
            value={preservedQuery.horizon}
          />
        ) : null}
        {preservedQuery.kodexWeight ? (
          <input
            name="kodexWeight"
            type="hidden"
            value={preservedQuery.kodexWeight}
          />
        ) : null}
        <label className="min-w-0">
          <span className="mb-1 block text-xs font-semibold text-[#596158]">
            market:currency:ticker:weight_bps
          </span>
          <input
            aria-label="연구 종목과 비중"
            className="h-11 w-full rounded-md border border-[#cfd6c8] bg-white px-3 text-sm outline-none focus:border-[#47624d]"
            defaultValue={model.rawValue ?? ""}
            name="researchUniverse"
            placeholder="korea:KRW:069500:5000,us:USD:QQQ:5000"
            type="text"
          />
        </label>
        <button
          className="h-11 self-end rounded-md bg-[#173c35] px-4 text-sm font-semibold text-white hover:bg-[#102f29]"
          type="submit"
        >
          데이터 점검
        </button>
      </form>
      <p className="mt-2 text-xs leading-5 text-[#687064]">
        Fount는 managed:KRW:FOUNT:0, 금현물은
        krx-gold:KRW:GOLD_9999_1KG:0 형식으로 남길 수 있습니다. 0bps
        행도 삭제하지 않습니다.
      </p>

      {model.selectionStatus === "invalid" ? (
        <div
          className="mt-4 rounded-md border border-[#e6d8ae] bg-[#fff9e9] px-4 py-3 text-sm text-[#6b5227]"
          data-research-universe-invalid
        >
          {model.issues.map(issueLabel).join(" · ")}
        </div>
      ) : null}

      {model.selectionStatus === "valid" ? (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Summary
              label="기준일"
              value={formatDate(model.requestedEndServiceDate)}
            />
            <Summary
              label="입력 비중"
              value={formatWeight(model.summary.totalWeightBps)}
            />
            <Summary
              label="저장 커버리지 충족"
              value={formatWeight(
                model.summary.storedEvidenceReadyWeightBps,
              )}
            />
            <Summary
              label="출처 요건 충족"
              value={formatWeight(model.summary.provenanceReadyWeightBps)}
            />
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-left text-sm">
              <thead className="border-y border-[#d7ddcf] text-xs text-[#687064]">
                <tr>
                  <th className="px-3 py-3 font-semibold">종목</th>
                  <th className="px-3 py-3 text-right font-semibold">
                    비중
                  </th>
                  <th className="px-3 py-3 font-semibold">저장 이력</th>
                  <th className="px-3 py-3 font-semibold">환율</th>
                  <th className="px-3 py-3 font-semibold">출처 근거</th>
                  <th className="px-3 py-3 font-semibold">판정</th>
                </tr>
              </thead>
              <tbody>
                {model.instruments.map((row) => (
                  <tr
                    className="border-b border-[#e1e5da] align-top"
                    data-research-universe-instrument={row.instrumentKey}
                    data-research-universe-instrument-status={row.status}
                    key={row.instrumentKey}
                  >
                    <td className="px-3 py-3">
                      <p className="font-semibold">{row.ticker}</p>
                      <p className="mt-1 text-xs text-[#687064]">
                        {row.market} · {row.currency}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold">
                      {formatWeight(row.weightBps)}
                    </td>
                    <td className="px-3 py-3">
                      {formatStoredCoverage(row.storedCoverage)}
                    </td>
                    <td className="px-3 py-3">
                      {formatFxCoverage(row.storedCoverage)}
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-semibold">
                        {provenanceLabel(row.provenance.status)}
                      </p>
                      <p className="mt-1 max-w-[260px] text-xs leading-5 text-[#687064]">
                        {formatProvenance(row.provenance)}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p
                        className={
                          row.status ===
                          "provenance_ready_for_separate_review"
                            ? "font-semibold text-[#226039]"
                            : row.status === "excluded_by_policy" ||
                                row.status ===
                                  "zero_weight_not_evaluated"
                              ? "font-semibold text-[#596158]"
                              : "font-semibold text-[#7a5117]"
                        }
                      >
                        {instrumentStatusLabel(row.status)}
                      </p>
                      {row.admissionIssues.length > 0 ? (
                        <p className="mt-1 max-w-[260px] text-xs leading-5 text-[#7a6b4e]">
                          {row.admissionIssues.join(", ")}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            className="mt-4 rounded-md border border-[#d7ddcf] bg-[#fbfcf7] px-4 py-3 text-sm text-[#596158]"
            data-research-universe-result-boundary
          >
            {resultBoundaryLabel(model.status)}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#d7ddcf] bg-[#fbfcf7] px-3 py-3">
      <p className="text-xs text-[#687064]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function formatStoredCoverage(
  coverage: SimulationResearchUniversePreflightModel["instruments"][number]["storedCoverage"],
) {
  if (!coverage) return "해당 없음";
  return `${coverage.returnCoverage.readyReturnCount}/${coverage.returnCoverage.requiredReturnCount} · ${formatPct(coverage.returnCoverage.coveragePct)}`;
}

function formatFxCoverage(
  coverage: SimulationResearchUniversePreflightModel["instruments"][number]["storedCoverage"],
) {
  if (!coverage) return "해당 없음";
  if (coverage.fxCoverage.status === "not_required") return "불필요";
  return `${coverage.fxCoverage.coveredServiceDateCount}/${coverage.fxCoverage.requiredServiceDateCount} · ${formatPct(coverage.fxCoverage.coveragePct)}`;
}

function formatProvenance(
  provenance: SimulationResearchUniversePreflightModel["instruments"][number]["provenance"],
) {
  if (provenance.status === "not_applicable") return "-";
  const provider =
    provenance.providers.length > 0
      ? provenance.providers.join(", ")
      : "provider 없음";
  return `${provenance.qualifiedRowCount}/${provenance.adjustedCloseRowCount}행 · ${provider}`;
}

function provenanceLabel(status: string) {
  switch (status) {
    case "complete":
      return "완전";
    case "partial":
      return "일부만 확인";
    case "ambiguous_binding":
      return "연결 충돌";
    case "missing":
      return "이력 없음";
    case "not_applicable":
      return "해당 없음";
    default:
      return "불완전";
  }
}

function instrumentStatusLabel(status: string) {
  switch (status) {
    case "provenance_ready_for_separate_review":
      return "별도 실행 검토 가능";
    case "stored_coverage_incomplete":
      return "저장 이력 부족";
    case "provenance_incomplete":
      return "출처 근거 부족";
    case "excluded_by_policy":
      return "Fount 제외";
    case "manual_history_required":
      return "금현물 수동 이력 필요";
    case "identity_unresolved":
      return "특수 종목 식별 불일치";
    case "zero_weight_not_evaluated":
      return "0% 행 보존";
    default:
      return "확인 필요";
  }
}

function resultBoundaryLabel(status: string) {
  switch (status) {
    case "stored_evidence_ready_for_separate_review":
      return "선택한 종목의 저장 증거가 충족됐습니다. 이는 시뮬레이션 실행, 추천 또는 provider 이용 권한 승인이 아닙니다.";
    case "partial_diagnostics_only":
      return "일부 종목의 증거가 부족합니다. 준비된 종목의 진단은 유지하지만 비중을 다시 나누거나 전체 포트폴리오 결과로 표시하지 않습니다.";
    default:
      return "진단만 표시합니다. 이 입력으로 포트폴리오 결과를 생성하지 않습니다.";
  }
}

function issueLabel(issue: string) {
  switch (issue) {
    case "repeated_query":
      return "연구 종목 값은 한 번만 입력해야 합니다";
    case "query_too_long":
      return "입력 길이가 제한을 초과했습니다";
    case "empty_query":
      return "연구 종목을 입력해야 합니다";
    case "too_many_rows":
      return "종목은 최대 16개까지 입력할 수 있습니다";
    case "invalid_row_format":
      return "각 행은 market:currency:ticker:weight_bps 형식이어야 합니다";
    case "invalid_market":
      return "market 값이 올바르지 않습니다";
    case "invalid_currency":
      return "통화는 KRW 또는 USD여야 합니다";
    case "invalid_ticker":
      return "ticker 값이 올바르지 않습니다";
    case "invalid_weight_bps":
      return "비중은 0~10000의 정수 bps여야 합니다";
    case "duplicate_instrument":
      return "같은 종목이 중복됐습니다";
    case "weight_total_not_10000":
      return "전체 비중 합계는 10000bps여야 합니다";
    default:
      return issue;
  }
}

function formatDate(value: string | null) {
  return value ? value.replaceAll("-", ".") : "-";
}

function formatWeight(value: number) {
  return `${(value / 100).toFixed(2)}%`;
}

function formatPct(value: number) {
  return `${value.toFixed(2)}%`;
}
