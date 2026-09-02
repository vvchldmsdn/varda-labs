import type { ReactNode } from "react";

import { PresentationDialog } from "@/components/presentation/presentation-dialog";

export function InvestmentLabDisclosure({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <section className="flex min-h-16 items-center justify-between gap-4 border-b border-[var(--line)] py-3">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-sm font-medium text-[var(--ink)]">{title}</span>
        {detail ? (
          <span className="text-xs text-[var(--faint)]">{detail}</span>
        ) : null}
      </span>
      <PresentationDialog
        description={detail}
        label="열기"
        title={title}
        wide
      >
        <div className="min-w-0">{children}</div>
      </PresentationDialog>
    </section>
  );
}
