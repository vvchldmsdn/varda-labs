import { buildPortfolioAnalysisScopeHref, type PortfolioAnalysisScopeKey } from "./portfolio-analysis-scope.ts";

const destinations = {
  home: { path: "/", ko: "홈으로", en: "Back to home" },
  contribution: { path: "/additional-contribution", ko: "추가 투입으로", en: "Back to contribution" },
  structure: { path: "/portfolio/structure", ko: "포트 구조로", en: "Back to allocation" },
  manage: { path: "/portfolio/manage", ko: "관리로", en: "Back to manage" },
} as const;

export type PortfolioTargetEntryPoint = keyof typeof destinations;
type SearchValue = string | readonly string[] | undefined;

/** A closed set of internal destinations; the query never supplies a redirect URL. */
export function buildPortfolioTargetNavigation({
  scopeKey, from, isDesignPreview = false, amount,
}: {
  scopeKey: PortfolioAnalysisScopeKey;
  from?: SearchValue;
  isDesignPreview?: boolean;
  amount?: SearchValue;
}) {
  const entryPoint: PortfolioTargetEntryPoint = typeof from === "string" && Object.hasOwn(destinations, from)
    ? from as PortfolioTargetEntryPoint : "manage";
  const destination = destinations[entryPoint];
  const validAmount = entryPoint === "contribution" && typeof amount === "string" && /^\d+$/.test(amount) &&
    Number.isSafeInteger(Number(amount)) && Number(amount) > 0 && Number(amount) <= 100_000_000_000
      ? String(Number(amount)) : undefined;
  const contextQuery = {
    from: entryPoint,
    ...(isDesignPreview ? { preview: "design" } : {}),
    ...(validAmount ? { amount: validAmount } : {}),
  };
  return {
    entryPoint,
    contextQuery,
    settingsHref: buildPortfolioAnalysisScopeHref("/portfolio/targets", scopeKey, contextQuery),
    returnHref: buildPortfolioAnalysisScopeHref(destination.path, scopeKey, {
      ...(isDesignPreview ? { preview: "design" } : {}),
      ...(validAmount ? { amount: validAmount } : {}),
    }),
    returnLabel: { ko: destination.ko, en: destination.en },
  };
}
