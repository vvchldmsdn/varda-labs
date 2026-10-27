
import { T } from "@/components/i18n/localized-text";
import { translateHomeHistory } from "@/components/home/home-history-messages";
import type { ReactNode } from "react";

export function HistoryEvidenceSummaryCell({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border-b border-[var(--wash)] px-3 py-3 sm:border-r lg:border-b-0 lg:last:border-r-0">
      <p className="text-xs font-semibold text-[var(--muted)]">{<T ko={label} en={translateHomeHistory(label)}/>}</p>
      <p className="mt-1 text-lg font-semibold tracking-normal"><T ko={value} en={translateHomeHistory(value)}/></p>
      <p className="mt-1 text-xs text-[var(--muted)]">{<T ko={detail} en={translateHomeHistory(detail)}/>}</p>
    </div>
  );
}

export function HistoryTableHeader({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "border-b border-[var(--line)] px-2 py-2 font-semibold",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

export function HistoryTableCell({
  children,
  strong = false,
  align = "left",
}: {
  children: ReactNode;
  strong?: boolean;
  align?: "left" | "right";
}) {
  return (
    <td
      className={cn(
        "border-b border-[var(--wash)] px-2 py-2 align-top",
        strong ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)]",
        align === "right" ? "text-right tabular-nums" : "text-left",
      )}
    >
      {children}
    </td>
  );
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
