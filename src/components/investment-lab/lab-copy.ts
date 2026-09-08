import { commonEnglish, translationEntry } from "@/lib/i18n/locale";
import { labCopyA } from "./lab-copy-a";
import { labCopyB } from "./lab-copy-b";
import { labCopyC } from "./lab-copy-c";
import { labCopyExtra } from "./lab-copy-extra";

const english: Readonly<Record<string, string>> = { ...commonEnglish, ...labCopyA, ...labCopyB, ...labCopyC, ...labCopyExtra,
  "계산에는 미사용": "Not used in calculations",
  "비교할 최신 writer 구간 없음": "No latest recording period for comparison",
  "같은 날짜 재실행은 최신 상태로 갱신": "A rerun on the same date updates the latest state",
  "날짜축 불연속": "Nonconsecutive dates", "근거 축적 중": "Collecting evidence",
  "기간 전 60개 공동 수익률": "60 shared pre-period returns", "리밸런싱 없음": "No rebalancing",
};

const rules: readonly [RegExp, (...values: string[]) => string][] = [
  [/^실제 ([-+−₩\d—].*)$/, (amount) => `Actual ${amount}`],
  [/^(.+)와 실제 포트폴리오 평가액 비교$/, (scenario) => `${labEnglish(scenario)} versus actual portfolio value`],
  [/^(\S+) 실제 (.+) 비교 (.+)$/, (date, actual, comparison) => `${date}; actual ${actual}; comparison ${comparison}`],
  [/^([\d,.]+)개(?: 관측일| 평가일)$/, (count) => `${count} observation dates`],
  [/^([\d,.]+)개 구간$/, (count) => `${count} periods`],
  [/^([\d,.]+)(?:개|건|일|행)$/, (count) => count],
  [/^([+−\-]?[\d,.]+)원(\/g)?$/, (amount, unit) => `KRW ${amount}${unit ?? ""}`],
  [/^([+−\-]?[\d,.]+)(억|만)(?:원)?$/, (amount, unit) => new Intl.NumberFormat("en-US", {notation:"compact", maximumFractionDigits:1}).format(Number(amount.replaceAll(",", "").replace("−", "-")) * (unit === "억" ? 100_000_000 : 10_000))],
  [/^선택 배분 (.+)$/, (weights) => `Selected mix ${weights}`],
  [/^수익률 축 커버리지 (.+)$/, (coverage) => `Return-series coverage ${coverage}`],
  [/^가격 ([\d,]+)$/, (count) => `Prices ${count}`],
  [/^환율 ([\d,]+)$/, (count) => `FX ${count}`],
  [/^평가 가능 ([\d,]+)$/, (count) => `Valued ${count}`],
  [/^제외 ([\d,]+)$/, (count) => `Excluded ${count}`],
  [/^reference 일치 ([\d,]+)개$/, (count) => `Matched references ${count}`],
  [/^reference 누락 ([\d,]+)개$/, (count) => `Missing references ${count}`],
  [/^완전 커버 ([\d,]+)개$/, (count) => `Fully covered ${count}`],
  [/^가격·환율 근거가 있는 평가 하위집합\(제외 ([\d,]+)개\)$/, (count) => `Valuation subset with price and FX evidence (${count} excluded)`],
  [/^(.+) 기준, 재정규화 안 함$/, (basis) => `${labEnglish(basis)}; not renormalized`],
  [/^([\d,]+)개 구간 · 거래 ([\d,]+)건$/, (periods, flows) => `${periods} periods · ${flows} transactions`],
  [/^([\d,]+)개 구간 · 체결 ([\d,]+)건$/, (periods, flows) => `${periods} periods · ${flows} executions`],
  [/^지연 체결 ([\d,]+)건$/, (count) => `${count} delayed executions`],
  [/^체결 ([\d,]+)건$/, (count) => `${count} executions`],
  [/^출처 합의 (.+)$/, (coverage) => `Source agreement ${coverage}`],
  [/^([\d,]+)개 공동 수익률$/, (count) => `${count} shared returns`],
  [/^([\d,]+)개 수익률$/, (count) => `${count} returns`],
  [/^상장 ([\d,]+)개$/, (count) => `${count} listed instruments`],
  [/^대기 ([\d,]+)일$/, (count) => `${count} dates with pending trades`],
  [/^([\d,]+)개 기간$/, (count) => `${count} periods`],
  [/^([\d,]+(?:\/[\d,]+)?)개 연속 일간$/, (count) => `${count} consecutive daily returns`],
  [/^제외 보유행 ([\d,]+)개$/, (count) => `${count} excluded holding rows`],
  [/^조정 ([\d,]+)$/, (count) => `${count} adjusted`],
  [/^원종가 ([\d,]+)$/, (count) => `${count} raw close`],
  [/^입력 검증에서 제외 ([\d,]+)일$/, (count) => `${count} dates excluded by input validation`],
  [/^Fount는 ([\d,]+)개 평가일에서 제외했습니다\.$/, (count) => `Fount was excluded on ${count} valuation dates.`],
  [/^([\d,]+)bp 최소 하한 제약 발동$/, (bps) => `Minimum weight constraint of ${bps} bp applied`],
  [/^(.+) ([\d,]+)bp 최소 하한 제약 발동$/, (instrument, bps) => `${instrument}: minimum weight constraint of ${bps} bp applied`],
  [/^고정혼합 KODEX (.+)$/, (weight) => `Fixed mix KODEX ${weight}`],
  [/^기간 전 최소변동성 KODEX (.+)$/, (weight) => `Pre-period minimum-volatility KODEX ${weight}`],
  [/^실제 포트폴리오와 KODEX 200 (.+)%, VOO (.+)% 고정 배분 same-flow 경로를 비교합니다\.$/, (kodex, voo) => `Compares the actual portfolio with a fixed ${kodex}% KODEX 200 / ${voo}% VOO allocation using identical cash flows.`],
  [/^실제 평가액: ([\d,]+)개 레거시·불완전 관측은 provider로 복원할 수 없어 별도 재구성 검토가 필요$/, (count) => `Actual value: ${count} legacy or incomplete observations cannot be restored from a market provider and require separate reconstruction review`],
  [/^시장 가격·환율: ([\d,]+)개 누락 근거는 승인 후 provider backfill 후보$/, (count) => `Market prices / FX: ${count} missing records are candidates for provider backfill after approval`],
  [/^현재 (.+)$/, (amount) => `Current ${labEnglish(amount)}`],
  [/^입력 (.+)$/, (date) => `Entered ${date}`],
  [/^KRX 금현물: (.+)$/, (status) => `KRX spot gold: ${labEnglish(status)}`],
  [/^최신 writer 구간 ([\d,]+)\/([\d,]+)일$/, (covered, required) => `Latest recording period: ${covered}/${required} dates`],
  [/^구분 가능한 일별 저장값 ([\d,]+)개$/, (count) => `${count} distinct daily recorded values`],
  [/^저장값 이월 ([\d,]+)일$/, (count) => `${count} dates with carried-forward values`],
  [/^KODEX 200 (.+) ([\d.]+)% \+ VOO 원종가 × 저장 USD\/KRW ([\d.]+)% 기준\(원종가 배당·기업행사 미조정\)$/, (basis, kodex, voo) => `KODEX 200 ${labEnglish(basis)} ${kodex}% + VOO raw close × recorded USD/KRW ${voo}%; raw prices exclude dividend and corporate-action adjustments`],
];

/** Product copy only: never apply this to asset names, account names, or arbitrary data. */
export function labEnglish(value: string): string {
  if (!/[가-힣]/.test(value)) return value;
  const normalized = value.replace(/\s+/g, " ").trim();
  const direct = translationEntry(english, normalized);
  if (direct !== undefined) return `${/^\s/.test(value) ? " " : ""}${direct}${/\s$/.test(value) ? " " : ""}`;
  // Explicit display templates retain interpolated user/market values verbatim.
  if (normalized.startsWith("감소 · ")) return `Decrease · ${normalized.slice(5)}`;
  if (normalized.startsWith("증가 · ")) return `Increase · ${normalized.slice(5)}`;
  if (normalized.endsWith(" · 날짜별 비교")) return `${labEnglish(normalized.slice(0, -9))} · Daily comparison`;
  for (const [pattern, render] of rules) {
    const match = normalized.match(pattern);
    if (match) return render(...match.slice(1));
  }
  if (normalized.startsWith("· ")) return `· ${labEnglish(normalized.slice(2))}`;
  if (normalized.includes(" · ")) return normalized.split(" · ").map(labEnglish).join(" · ");
  return value;
}
