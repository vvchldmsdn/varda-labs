import Link from "next/link";

import type { HistoryPositionComparisonModel } from "@/lib/history-position-comparison";

import { historySourceLabel } from "./history-format";
import { HistoryPositionComparisonResult } from "./history-position-comparison-result";

export function HistoryPositionComparison({
  model,
}: {
  model: HistoryPositionComparisonModel;
}) {
  const defaults = comparisonDefaults(model);
  const canCompare = defaults.from !== null && defaults.to !== null;

  return (
    <section
      data-history-position-comparison
      data-history-position-comparison-status={model.status}
      data-history-position-comparison-reason={model.reason}
      data-history-position-comparison-policy={model.policy.version}
      data-history-position-comparison-count={model.rowCount}
      data-history-position-comparison-added={model.addedCount}
      data-history-position-comparison-removed={model.removedCount}
      data-history-position-comparison-changed={model.changedCount}
      data-history-position-comparison-unchanged={model.unchangedCount}
      data-history-position-comparison-unresolved={model.unresolvedCount}
      data-history-position-comparison-from={selectedDate(model, "from")}
      data-history-position-comparison-to={selectedDate(model, "to")}
      data-history-position-comparison-source={selectedSource(model)}
      className="mt-4 border-y border-[#dfe3d5] py-4"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[#687064]">
            저장 스냅샷 비교
          </p>
          <h3 className="mt-1 text-base font-semibold tracking-normal">
            두 시점 보유 변화
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#687064]">
            같은 계정·출처의 두 저장점을 비교합니다. 실시간 시세나 현재 자산
            정보로 과거 기록을 보완하지 않습니다.
          </p>
        </div>
        {model.selection.status !== "idle" ? (
          <Link
            href={baseHistoryHref(model)}
            className="w-fit rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-xs font-semibold text-[#4d574b] hover:bg-[#eef2e8]"
          >
            비교 닫기
          </Link>
        ) : null}
      </div>

      <ComparisonForm
        model={model}
        defaults={defaults}
        canCompare={canCompare}
      />

      {model.status === "ready" || model.status === "partial" ? (
        <HistoryPositionComparisonResult model={model} />
      ) : (
        <p className="mt-3 bg-white px-3 py-3 text-sm leading-6 text-[#687064]">
          {statusMessage(model)}
        </p>
      )}
    </section>
  );
}

function ComparisonForm({
  model,
  defaults,
  canCompare,
}: {
  model: HistoryPositionComparisonModel;
  defaults: ReturnType<typeof comparisonDefaults>;
  canCompare: boolean;
}) {
  return (
    <form
      action="/history"
      method="get"
      className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
    >
      <input type="hidden" name="account" value={model.account} />
      <input type="hidden" name="lane" value={model.lane} />
      <EndpointSelect
        label="이전 저장점"
        name="comparisonFrom"
        options={model.options}
        defaultValue={defaults.from}
        disabled={!canCompare}
      />
      <EndpointSelect
        label="이후 저장점"
        name="comparisonTo"
        options={model.options}
        defaultValue={defaults.to}
        disabled={!canCompare}
      />
      <div className="flex items-end">
        <button
          type="submit"
          disabled={!canCompare}
          className="rounded-md bg-[#1e3a34] px-4 py-2 text-sm font-semibold text-white hover:bg-[#284a42] disabled:cursor-not-allowed disabled:bg-[#aeb7aa]"
        >
          비교
        </button>
      </div>
    </form>
  );
}

function EndpointSelect({
  label,
  name,
  options,
  defaultValue,
  disabled,
}: {
  label: string;
  name: "comparisonFrom" | "comparisonTo";
  options: HistoryPositionComparisonModel["options"];
  defaultValue: string | null;
  disabled: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-semibold text-[#687064]">
      {label}
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        disabled={disabled}
        className="min-w-0 rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-sm font-semibold text-[#171916] disabled:bg-[#eef1ea]"
      >
        {options.length === 0 ? <option value="">저장점 없음</option> : null}
        {options.map((option) => (
          <option key={option.token} value={option.token}>
            {option.snapshotDate} · {historySourceLabel(option.source)}
          </option>
        ))}
      </select>
    </label>
  );
}

function comparisonDefaults(model: HistoryPositionComparisonModel) {
  if (model.selection.status === "requested") {
    return {
      from: `${model.selection.from.snapshotDate}~${model.selection.from.source}`,
      to: `${model.selection.to.snapshotDate}~${model.selection.to.source}`,
    };
  }
  for (const newer of model.options) {
    const older = model.options.find(
      (option) =>
        option.source === newer.source &&
        option.snapshotDate < newer.snapshotDate,
    );
    if (older) return { from: older.token, to: newer.token };
  }
  return { from: null, to: null };
}

function statusMessage(model: HistoryPositionComparisonModel) {
  if (model.reason === "not_requested") {
    if (model.account === "all") {
      return "전체 합산은 여러 계정의 표시 결과일 수 있어 비교하지 않습니다. 증권, ISA 또는 IRP 계정을 선택하세요.";
    }
    if (model.options.length < 2) {
      return "같은 출처로 저장된 포트폴리오 시점이 두 개 이상 있어야 비교할 수 있습니다.";
    }
    return "비교할 이전·이후 저장점을 선택하세요.";
  }
  if (model.reason === "named_account_required") {
    return "전체 합산은 비교 대상으로 사용할 수 없습니다. 증권, ISA 또는 IRP 계정을 선택하세요.";
  }
  if (model.reason === "portfolio_lane_required") {
    return "두 시점 보유 비교는 포트폴리오 기록 화면에서만 확인할 수 있습니다.";
  }
  if (model.reason === "same_source_required") {
    return "출처가 다른 저장점은 같은 기준으로 간주하지 않습니다. 같은 출처의 두 시점을 선택하세요.";
  }
  if (model.reason === "chronological_order_required") {
    return "이전 저장점은 이후 저장점보다 앞선 날짜여야 합니다.";
  }
  if (model.reason === "invalid_parameters") {
    return "저장점 선택값이 올바르지 않습니다. 목록에서 다시 선택하세요.";
  }
  return "선택한 두 저장점 중 하나에 정확히 일치하는 포트폴리오·포지션 근거가 없어 비교하지 않았습니다.";
}

function selectedDate(
  model: HistoryPositionComparisonModel,
  endpoint: "from" | "to",
) {
  return model.selection.status === "requested"
    ? model.selection[endpoint].snapshotDate
    : undefined;
}

function selectedSource(model: HistoryPositionComparisonModel) {
  return model.selection.status === "requested"
    ? model.selection.from.source
    : undefined;
}

function baseHistoryHref(model: HistoryPositionComparisonModel) {
  return `/history?${new URLSearchParams({
    account: model.account,
    lane: model.lane,
  }).toString()}`;
}
