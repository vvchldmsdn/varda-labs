"use client";

import { useEffect, useId, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";

export type InstrumentChoice = {
  id: string; name: string; ticker: string;
  market: "korea" | "us"; currency: "KRW" | "USD";
  assetType: "etf" | "stock";
};

export function InstrumentSearch({ onSelect, disabled = false, preview = false, initialQuery = "", privateQuery = false }: {
  onSelect: (instrument: InstrumentChoice) => void; disabled?: boolean; preview?: boolean; initialQuery?: string; privateQuery?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<InstrumentChoice[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        // The preview never calls authenticated search or writes data.
        if (preview) {
          setResults([{ id: "preview", name: "KODEX 200", ticker: "069500", market: "korea", currency: "KRW", assetType: "etf" }].filter(row => `${row.name} ${row.ticker}`.toLowerCase().includes(query.trim().toLowerCase())) as InstrumentChoice[]);
          setStatus("ready");
          return;
        }
        const response = privateQuery
          ? await fetch("/api/instruments/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: query.trim() }), signal: controller.signal, cache: "no-store" })
          : await fetch(`/api/instruments/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        if (!response.ok) throw new Error("search unavailable");
        const data = await response.json();
        if (!controller.signal.aborted) { setResults(data.instruments); setStatus("ready"); }
      } catch { if (!controller.signal.aborted) { setResults([]); setStatus("error"); } }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, preview, privateQuery]);
  return <div className="varda-instrument-search">
    <label htmlFor={id}>{t("어떤 종목을 가지고 있나요?", "What do you hold?")}</label>
    <div className="varda-instrument-search-input"><Search size={20} aria-hidden="true" />
      <input id={id} value={query} maxLength={80} disabled={disabled} autoComplete="off"
        placeholder={t("종목 이름 또는 티커 검색", "Search a name or ticker")}
        onChange={event => { setQuery(event.target.value); setResults([]); setStatus(event.target.value.trim() ? "loading" : "idle"); }}
        aria-describedby={`${id}-status`} />
      {status === "loading" && <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
    </div>
    <div id={`${id}-status`} aria-live="polite" className="varda-onboarding-hint">
      {status === "error" ? t("검색을 불러오지 못했습니다. 다시 입력하거나 티커로 직접 등록해 주세요.", "Search is unavailable. Try again or enter a ticker manually.") :
        status === "ready" && !results.length ? t("확인된 종목 목록에 없습니다. 아래에서 티커로 직접 등록할 수 있습니다.", "No match in the verified catalog. You can enter a ticker below.") :
        status === "idle" ? t("등록된 한국·미국 종목을 검색합니다. 시장과 통화는 자동으로 채워집니다.", "Search the available Korean and US catalog. Market and currency are filled in for you.") : null}
    </div>
    {results.length > 0 && <ul className="varda-instrument-results" aria-label={t("검색 결과", "Search results")}>
      {results.map(row => <li key={row.id}><button type="button" disabled={disabled} onClick={() => { onSelect(row); setQuery(""); setResults([]); setStatus("idle"); }}>
        <span><strong>{row.name}</strong><small>{row.ticker} · {row.market === "korea" ? "KR" : "US"} · {row.currency}</small></span><span>{row.assetType.toUpperCase()} ↗</span>
      </button></li>)}
    </ul>}
  </div>;
}
