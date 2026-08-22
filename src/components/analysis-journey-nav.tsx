export type AnalysisJourneyItem = Readonly<{
  description: string;
  href: `#${string}`;
  label: string;
  status?: string;
}>;

export function AnalysisJourneyNav({
  items,
  title = "결과 둘러보기",
}: {
  items: readonly AnalysisJourneyItem[];
  title?: string;
}) {
  return (
    <section
      aria-label={title}
      className="border-y border-[#d7ddcf] bg-[#f8faf4]"
      data-analysis-journey-nav
    >
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold text-[#33423a]">{title}</h2>
      </div>
      <nav className="grid border-t border-[#e1e6dc] sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <a
            className="group flex min-h-24 flex-col justify-between gap-3 border-b border-[#e1e6dc] px-4 py-3 last:border-b-0 hover:bg-white sm:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0 xl:last:border-r-0"
            href={item.href}
            key={item.href}
          >
            <span>
              <span className="block text-sm font-semibold text-[#1f2f28] group-hover:text-[#173c35]">
                {item.label}
              </span>
              <span className="mt-1 block text-xs leading-5 text-[#687064]">
                {item.description}
              </span>
            </span>
            {item.status ? (
              <span className="text-xs font-semibold text-[#47624d]">
                {item.status}
              </span>
            ) : null}
          </a>
        ))}
      </nav>
    </section>
  );
}
