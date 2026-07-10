import type { ReactNode } from "react";

export function RiskSection({
  title,
  detail,
  marker,
  children,
}: {
  title: string;
  detail?: string;
  marker: string;
  children: ReactNode;
}) {
  return (
    <section
      data-risk-section={marker}
      className="border-t border-[#d8ddcf] py-5"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
        {detail ? (
          <p className="text-xs font-semibold text-[#687064]">{detail}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function RiskSummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | null;
}) {
  return (
    <div className="min-w-0 rounded-md border border-[#dfe3d5] bg-white px-3 py-3">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-1 break-words text-lg font-semibold tracking-normal text-[#171916]">
        {value}
      </p>
      {detail ? (
        <p className="mt-1 break-words text-xs text-[#687064]">{detail}</p>
      ) : null}
    </div>
  );
}

export function RiskNotice({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "warning" | "danger";
  children: ReactNode;
}) {
  const toneClass = {
    neutral: "border-[#d8ddcf] bg-[#eef2e9] text-[#344038]",
    warning: "border-[#e8d6ae] bg-[#fff8e9] text-[#73551e]",
    danger: "border-[#e5bdbd] bg-[#fff0f0] text-[#7a2e2e]",
  }[tone];
  return (
    <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${toneClass}`}>
      {children}
    </div>
  );
}

export function RiskTableHeader({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      className={`whitespace-nowrap border-b border-[#d8ddcf] px-3 py-2 text-xs font-semibold uppercase text-[#687064] ${alignmentClass(align)}`}
    >
      {children}
    </th>
  );
}

export function RiskTableCell({
  children,
  align = "left",
  strong = false,
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  strong?: boolean;
}) {
  return (
    <td
      className={`border-b border-[#e7eadf] px-3 py-2 align-top text-sm ${alignmentClass(align)} ${strong ? "font-semibold" : ""}`}
    >
      {children}
    </td>
  );
}

export function RiskEmptyMessage({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 border-l-2 border-[#b8c1b1] bg-white px-3 py-2 text-sm text-[#687064]">
      {children}
    </div>
  );
}

function alignmentClass(align: "left" | "right" | "center") {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}
