import {
  HISTORY_ACCOUNTS,
  HISTORY_LANES,
  type HistoryAccount,
  type HistoryLane,
} from "@/lib/history-balance";

import { historyAccountLabel, historyLaneLabel } from "./history-format";

export function HistoryControls({
  account,
  lane,
}: {
  account: HistoryAccount;
  lane: HistoryLane;
}) {
  return (
    <form
      action="/history"
      method="get"
      className="mt-4 grid gap-3 md:grid-cols-[180px_220px_auto]"
    >
      <label className="grid gap-1 text-xs font-semibold text-[#687064]">
        계정
        <select
          name="account"
          defaultValue={account}
          className="rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-sm font-semibold text-[#171916]"
        >
          {HISTORY_ACCOUNTS.map((option) => (
            <option key={option} value={option}>
              {historyAccountLabel(option)}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-[#687064]">
        기록 구분
        <select
          name="lane"
          defaultValue={lane}
          className="rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-sm font-semibold text-[#171916]"
        >
          {HISTORY_LANES.map((option) => (
            <option key={option} value={option}>
              {historyLaneLabel(option)}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end">
        <button
          type="submit"
          className="rounded-md bg-[#1e3a34] px-4 py-2 text-sm font-semibold text-white hover:bg-[#284a42]"
        >
          적용
        </button>
      </div>
    </form>
  );
}
