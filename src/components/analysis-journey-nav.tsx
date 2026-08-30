export type AnalysisJourneyItem = Readonly<{
  description: string;
  href: `#${string}`;
  label: string;
  status?: string;
}>;

export function AnalysisJourneyNav({
  items,
  title = "결과 둘러보기",
  variant = "default",
}: {
  items: readonly AnalysisJourneyItem[];
  title?: string;
  variant?: "default" | "editorial";
}) {
  if (variant === "editorial") {
    return (
      <nav
        aria-label={title}
        className="border-y border-[var(--line)]"
        data-analysis-journey-nav
      >
        <div className="grid sm:grid-cols-2 xl:grid-cols-4">
          {items.map((item, index) => (
            <a
              className="group min-w-0 border-b border-[var(--line)] px-4 py-4 first:pl-0 last:pr-0 sm:odd:border-r xl:border-b-0 xl:border-r xl:last:border-r-0"
              href={item.href}
              key={item.href}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-[10px] text-[var(--faint)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {item.status ? (
                  <span className="text-[10px] text-[var(--muted)]">
                    {item.status}
                  </span>
                ) : null}
              </span>
              <strong className="mt-5 block text-sm font-semibold transition-colors group-hover:text-[var(--brand)]">
                {item.label}
              </strong>
              <span className="mt-1 block text-[11px] text-[var(--faint)]">
                {item.description}
              </span>
            </a>
          ))}
        </div>
      </nav>
    );
  }

  return (
    <section
      aria-label={title}
      className="border-y border-[var(--line)] bg-[var(--surface)]"
      data-analysis-journey-nav
    >
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
      </div>
      <nav className="grid border-t border-[var(--wash)] sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <a
            className="group flex min-h-24 flex-col justify-between gap-3 border-b border-[var(--wash)] px-4 py-3 last:border-b-0 hover:bg-white sm:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0 xl:last:border-r-0"
            href={item.href}
            key={item.href}
          >
            <span>
              <span className="block text-sm font-semibold text-[var(--ink)] group-hover:text-[var(--ink)]">
                {item.label}
              </span>
              <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                {item.description}
              </span>
            </span>
            {item.status ? (
              <span className="text-xs font-semibold text-[var(--brand)]">
                {item.status}
              </span>
            ) : null}
          </a>
        ))}
      </nav>
    </section>
  );
}
