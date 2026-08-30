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
      className="border-t border-[var(--line)] py-5"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
        {detail ? (
          <p className="text-xs font-semibold text-[var(--muted)]">{detail}</p>
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
    <div className="min-w-0 rounded-md border border-[var(--line)] bg-white px-3 py-3">
      <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-1 break-words text-lg font-semibold tracking-normal text-[var(--ink)]">
        {value}
      </p>
      {detail ? (
        <p className="mt-1 break-words text-xs text-[var(--muted)]">{detail}</p>
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
    neutral: "border-[var(--line)] bg-[var(--wash)] text-[var(--ink)]",
    warning: "border-[var(--warning-soft)] bg-[var(--surface)] text-[var(--warning)]",
    danger: "border-[var(--negative-soft)] bg-[var(--surface)] text-[var(--negative)]",
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
      className={`whitespace-nowrap border-b border-[var(--line)] px-3 py-2 text-xs font-semibold uppercase text-[var(--muted)] ${alignmentClass(align)}`}
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
      className={`border-b border-[var(--wash)] px-3 py-2 align-top text-sm ${alignmentClass(align)} ${strong ? "font-semibold" : ""}`}
    >
      {children}
    </td>
  );
}

export function RiskEmptyMessage({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 border-l-2 border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--muted)]">
      {children}
    </div>
  );
}

function alignmentClass(align: "left" | "right" | "center") {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}
