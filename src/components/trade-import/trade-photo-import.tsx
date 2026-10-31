"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { ImagePlus } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button, Input, PageTitle, SectionHeading, Status } from "@/components/cairn-ui";
import { forgetTrade, pendingTrade, rememberTrade } from "@/lib/trade-operation-recovery";
import { importIssue, photoImportMessage, PhotoSaveError, savePhotoTrades, type ReviewedPhotoTrade, type TradeImportContext } from "@/lib/trade-photo-import";
import styles from "./trade-photo-import.module.css";

const Review = dynamic(() => import("./trade-photo-review").then(m => m.TradePhotoReview), { loading: () => <Status as="p">검토 화면을 준비하고 있어요…</Status> });
type PhotoRow = ReviewedPhotoTrade & { photo: string };
async function request(url: string, body?: object) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(30_000), ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new PhotoSaveError(data.error ?? "unavailable", [400, 409].includes(response.status) && data.error !== "account_changed");
  return data;
}
export function TradePhotoImport({ initial, preview = false }: { initial: TradeImportContext; preview?: boolean }) {
  const { t } = useI18n();
  const [context, setContext] = useState(initial), [rows, setRows] = useState<PhotoRow[]>([]), [active, setActive] = useState("");
  const [progress, setProgress] = useState<string | null>(null), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null), task = useRef<AbortController | null>(null), urls = useRef<string[]>([]), mounted = useRef(true), saving = useRef(false);
  const session = useRef(initial.sessionKey);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; task.current?.abort(); urls.current.forEach(URL.revokeObjectURL); }; }, []);
  useEffect(() => {
    if (!busy && !uncertain && !rows.some(r => r.status === "review")) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [rows, busy, uncertain]);
  const current = rows.find(r => r.key === active);
  const editable = !busy && !uncertain && progress === null;
  const pending = rows.filter(r => r.status === "review"), savedCount = rows.filter(r => r.status === "saved").length;
  const ready = pending.filter(r => !importIssue(r, context, rows)).length;
  function change(patch: Partial<ReviewedPhotoTrade>) { setRows(previous => previous.map(r => r.key === active ? { ...r, verified: false, ...patch } : r)); setError(""); }
  async function readPhotos(files: File[]) {
    if (!editable || files.length > 10 || rows.length >= 50) { setError("한 번에 사진 10장, 거래 50건까지 확인할 수 있어요."); return; }
    const controller = new AbortController(); task.current = controller; setProgress("인식 도구 준비 중"); setError(""); setMessage("");
    let next: PhotoRow[] = []; let excluded = 0, unread = 0;
    try {
      const [{ readBrokeragePhotoText }, { parseTradePhoto }] = await Promise.all([import("@/lib/balance-photo-reader"), import("@/lib/trade-photo")]);
      for (let index = 0; index < files.length; index++) {
        if (controller.signal.aborted) break;
        try {
          const page = await readBrokeragePhotoText(files[index], controller.signal, value => { if (mounted.current && !controller.signal.aborted) setProgress(`${index + 1}/${files.length}장 · ${value}%`); }, { tradeNumbers: true });
          if (controller.signal.aborted) break;
          const result = parseTradePhoto(page.lines, page.width, page.height); excluded += result.excluded;
          if (!result.rows.length) { unread++; continue; }
          if (rows.length + next.length + result.rows.length > 50) { unread++; continue; }
          const photo = URL.createObjectURL(files[index]); urls.current.push(photo);
          next = next.concat(result.rows.map(row => ({ ...row, photo, key: crypto.randomUUID(), operationId: crypto.randomUUID(), accountId: initial.accounts.length === 1 ? initial.accounts[0].id : "", assetId: "", afterEventId: "", verified: false, status: "review" as const })));
        } catch { if (!controller.signal.aborted) unread++; }
      }
      if (mounted.current) {
        // Keep successful photos if a later photo fails or recognition is cancelled.
        next.sort((a, b) => a.date.localeCompare(b.date)); setRows(previous => [...previous, ...next]); if (!active) setActive(next[0]?.key ?? "");
        setMessage(`${next.length}건을 검토 목록에 담았어요.${excluded ? ` 미체결·취소 ${excluded}건은 제외했어요.` : ""}${unread ? ` ${unread}장은 읽지 못했거나 한도를 넘었어요. 체결 상세 사진으로 다시 선택해 주세요.` : ""}${controller.signal.aborted ? " 인식은 중단했어요." : ""}`);
      }
    } catch { if (mounted.current) setError("인식 도구를 준비하지 못했어요. 연결을 확인하고 사진을 다시 선택해 주세요."); }
    finally { if (mounted.current) setProgress(null); task.current = null; }
  }
  async function save() {
    if (preview || saving.current || !navigator.locks) { setError(preview ? "디자인 검증 화면에서는 거래를 저장하지 않습니다." : "이 브라우저에서는 안전한 동시 저장을 지원하지 않아요. 최신 브라우저로 다시 시도해 주세요."); return; }
    saving.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await navigator.locks.request(`cairn:trade:${session.current}`, async () => {
        await savePhotoTrades(rows, session.current, {
          context: async () => {
            const fresh = await request("/api/portfolio/ledger?view=import") as TradeImportContext;
            if (fresh.sessionKey !== session.current) throw new Error("account_changed");
            if (mounted.current) setContext(fresh); return fresh;
          },
          pending: () => pendingTrade(localStorage, session.current),
          remember: value => rememberTrade(localStorage, value),
          forget: id => forgetTrade(localStorage, session.current, id),
          lookup: async operationId => {
            const result = await request("/api/portfolio/ledger", { sessionKey: session.current, operationId });
            if (!["committed", "cancelled", "unconfirmed"].includes(result.status)) throw new Error("unavailable");
            return result.status;
          },
          post: async mutation => { const result = await request("/api/portfolio/ledger", { sessionKey: session.current, mutation }); if (!["created", "existing"].includes(result.status)) throw new Error("unavailable"); },
        }, key => { if (mounted.current) setRows(previous => previous.map(r => r.key === key ? { ...r, status: "saved" } : r)); });
      });
      if (mounted.current) { setUncertain(false); setMessage("확인한 거래를 저장했어요. 보유 수량과 체결금액이 반영됐습니다."); }
    } catch (cause) {
      if (mounted.current) {
        const code = cause instanceof Error ? cause.message : "unavailable";
        if (["account_changed", "sign_in_required", "account_unavailable"].includes(code)) { urls.current.forEach(URL.revokeObjectURL); urls.current = []; setRows([]); setContext({ ...initial, accounts: [], entries: [], canWrite: false }); }
        setError(photoImportMessage(code));
        try { setUncertain(!!pendingTrade(localStorage, session.current)); } catch { setUncertain(true); }
      }
    } finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  return <div id="varda-main-content" className={styles.content}>
    <header className={styles.heading}><div><PageTitle>{t("사진으로 거래 기록", "Record trades from photos")}</PageTitle><p>{t("증권사 체결 내역을 한 번에 옮겨 보세요.", "Bring your brokerage fills together.")}</p></div><Link href="/portfolio/ledger" prefetch={false}>{t("직접 입력 ↗", "Enter manually ↗")}</Link></header>
    {preview && <Status as="p">디자인 검증 · 예시 계좌입니다. 사진은 실제로 읽지만 저장은 하지 않습니다.</Status>}
    <section className={styles.upload}>
      <div className={styles.uploadIntro}><ImagePlus aria-hidden="true" /><SectionHeading title={t("체결 내역을 골라 주세요", "Choose your trade photos")} description={t("수량·단가가 보이는 사진이면 돼요", "Include the filled quantity and price")} /></div>
      <Button variant="primary" type="button" size="lg" disabled={!editable || rows.length >= 50} onClick={() => input.current?.click()}>{t("사진 선택", "Choose photos")} <span aria-hidden="true">↗</span></Button><Input hidden ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label={t("거래 사진 파일", "Trade photo files")} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) void readPhotos(files); }} />
      <p className={styles.privacy}>{t("사진은 이 기기에서만 읽어요", "Photos stay on this device")}</p>
    </section>
    <details className={styles.help}><summary>{t("어떤 사진을 올리면 되나요?", "Which photos work?")}</summary><p>{t("체결 수량·단가가 있는 상세 화면이나, 체결 수량·금액이 있는 목록을 선택하세요. 미체결·취소 주문은 제외해요.", "Choose fill details showing quantity and price, or a list with filled quantity and amount. Unfilled and cancelled orders are excluded.")}</p><p>{t("JPG·PNG·WebP · 장당 12MB / 1,600만 픽셀 · 최대 10장, 50건. 사진은 서버에 전송하거나 보관하지 않습니다.", "JPG, PNG or WebP · up to 12MB / 16 megapixels per photo, 10 photos and 50 trades. Photos are never uploaded or stored on the server.")}</p></details>
    <ol className={styles.steps} aria-label={t("거래 가져오기 순서", "Import steps")}><li aria-current={!rows.length ? "step" : undefined}><span>1</span>{t("사진 선택", "Choose")}</li><li aria-current={pending.length ? "step" : undefined}><span>2</span>{t("체결 확인", "Review")}</li><li aria-current={savedCount > 0 && !pending.length ? "step" : undefined}><span>3</span>{t("기록 저장", "Save")}</li></ol>
    {progress && <Status as="div">사진을 읽고 있어요 · {progress} <Button variant="ghost" onClick={() => task.current?.abort()}>인식 중단</Button></Status>}
    {message && <Status as="p" tone="success">{message}</Status>}{error && <Status as="p" tone="danger" role="alert">{error}</Status>}
    {!context.complete && <Status as="p" tone="warning">{photoImportMessage("incomplete_history")}</Status>}
    {rows.length === 0 ? <p className={styles.empty}>{t("현금 출금액 없이, 체결금액으로 기록해요. 기존 기록은 유지돼요.", "Record execution amounts without cash settlement. Existing records stay intact.")}</p> : <>
      <div className={styles.stats}><span>{t("확인 대기", "To review")}<strong>{pending.length}</strong></span><span>{t("저장 준비", "Ready")}<strong>{ready}</strong></span><span>{t("저장 완료", "Saved")}<strong>{savedCount}</strong></span></div>
      <div className={styles.layout}>
        <section className={styles.list} aria-label={t("사진에서 읽은 거래 목록", "Trades read from photos")}><SectionHeading title={t("확인할 거래", "Review trades")} description={t("날짜순 · 같은 날은 체결순", "By date, then execution order")} />{rows.map((row, i) => <div key={row.key} className={styles.row} data-active={row.key === active} data-state={row.status}>
          <Button variant="bare" type="button" className={styles.choose} onClick={() => setActive(row.key)} disabled={busy} aria-pressed={row.key === active}><span>{String(i + 1).padStart(2, "0")} · {row.date || "날짜 확인"}</span><strong>{row.label}</strong><span>{row.side === "buy" ? "매수" : "매도"} · {row.quantity || "?"}주 · {row.price || "?"} {row.currency}</span><small>{row.status === "saved" ? "저장 완료" : row.status === "excluded" ? "제외됨" : row.verified ? "확인함" : "확인 필요"}</small></Button>
          {row.status === "review" && <div className={styles.reorder}><Button size="sm" variant="ghost" aria-label={`${i + 1}번 거래 위로`} disabled={!editable || i === 0} onClick={() => setRows(previous => { const next = [...previous]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next.map(r => ({ ...r, verified: r.status === "review" ? false : r.verified })); })}>↑</Button><Button size="sm" variant="ghost" disabled={!editable} onClick={() => { setActive(row.key); setRows(previous => previous.map(r => r.key === row.key ? { ...r, status: "excluded", verified: false } : r)); }}>제외</Button></div>}
        </div>)}</section>
        <section aria-label="선택한 거래 검토" className={styles.detail}>
          {current && <><details className={styles.photo}><summary>원본 사진과 비교</summary><Image unoptimized src={current.photo} alt="체결 내역 확인용 원본 사진" width={945} height={2048} /></details>
          {current.status === "review" ? <Review key={current.key} row={current} queue={rows} context={context} disabled={!editable} change={change} /> : <Status as="p">{current.status === "saved" ? "이 거래는 저장됐어요. 다시 등록하지 않습니다." : "검토 목록에서 제외한 거래입니다."}{current.status === "excluded" && <Button variant="ghost" disabled={!editable} onClick={() => change({ status: "review" })}>다시 확인</Button>}</Status>}</>}
        </section>
      </div>
      <footer className={styles.footer}><div><strong>{t(`${savedCount}건 저장 · ${pending.length}건 남음`, `${savedCount} saved · ${pending.length} remaining`)}</strong><p>{t("순서대로 저장해요. 오류가 나면 멈춥니다.", "Saved in order; stops if a trade fails.")}</p></div><Button variant="primary" size="lg" type="button" disabled={busy || !!progress || !pending.length || !context.canWrite || (!uncertain && ready !== pending.length)} onClick={() => void save()}>{busy ? t("거래 저장 중…", "Saving trades…") : uncertain ? t("저장 확인 후 계속", "Check save and continue") : t(`확인한 ${pending.length}건 저장`, `Save ${pending.length} reviewed trades`)}</Button></footer>
      {uncertain && <p className={styles.hint}>저장 결과가 불확실한 동안 입력을 유지합니다. 다른 미확인 거래가 있다면 <Link prefetch={false} href="/portfolio/ledger">직접 입력 화면에서 저장 여부 확인</Link>을 먼저 해 주세요.</p>}
    </>}
  </div>;
}
