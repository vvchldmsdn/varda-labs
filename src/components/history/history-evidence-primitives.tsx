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
    <div className="border-b border-[#e1e6dc] px-3 py-3 sm:border-r lg:border-b-0 lg:last:border-r-0">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-normal">{value}</p>
      <p className="mt-1 text-xs text-[#687064]">{detail}</p>
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
        "border-b border-[#dfe3d5] px-2 py-2 font-semibold",
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
        "border-b border-[#eef1e8] px-2 py-2 align-top",
        strong ? "font-semibold text-[#171916]" : "text-[#4d574b]",
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
