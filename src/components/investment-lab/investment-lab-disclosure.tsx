import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export function InvestmentLabDisclosure({
  title,
  detail,
  children,
  open = false,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="group border-b border-[#dde1db]" open={open}>
      <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-sm font-medium text-[#27382e]">{title}</span>
          {detail ? (
            <span className="text-xs text-[#7a837a]">{detail}</span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="shrink-0 text-[#778076] transition-transform group-open:rotate-180"
          size={16}
        />
      </summary>
      <div className="min-w-0 pb-6">{children}</div>
    </details>
  );
}
