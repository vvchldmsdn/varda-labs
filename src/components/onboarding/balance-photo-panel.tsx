"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Check, ImagePlus } from "lucide-react";
import { Button, Field, InfoDisclosure, Input, SectionHeading, Status } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import { InstrumentSearch, type InstrumentChoice } from "./instrument-search";
import { balanceQuantity, type BalancePhotoRow } from "@/lib/balance-photo";
import type { HoldingDraft } from "@/lib/holding-batch";
import styles from "./balance-photo-panel.module.css";

type ReviewRow = BalancePhotoRow & { key: string; instrument?: InstrumentChoice; verified: boolean };
export function BalancePhotoPanel({ onAdd, remaining, disabled, preview = false }: {
  onAdd: (rows: HoldingDraft[]) => boolean; remaining: number; disabled: boolean; preview?: boolean;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ReviewRow[]>([]), [active, setActive] = useState("");
  const [photo, setPhoto] = useState<string>(), [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const task = useRef<AbortController | null>(null), previewUrl = useRef<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; task.current?.abort(); if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  const current = rows.find(row => row.key === active);
  const busy = progress !== null || disabled;
  function update(key: string, change: Partial<ReviewRow>) { setRows(previous => previous.map(row => row.key === key ? { ...row, verified: false, ...change } : row)); setError(""); }
  function clear() { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = undefined; setPhoto(undefined); setRows([]); setActive(""); }
  async function recognize(file: File) {
    const request = ++generation.current; task.current?.abort(); const controller = new AbortController(); task.current = controller;
    setError(""); setMessage(""); setProgress(0); clear();
    try {
      const { readBalancePhoto } = await import("@/lib/balance-photo-reader");
      const result = await readBalancePhoto(file, controller.signal, value => { if (request === generation.current) setProgress(value); });
      if (request !== generation.current || controller.signal.aborted) return;
      if (result.state !== "review") { setError(result.state === "not_balance" ? t("거래 내역 사진이에요. 종목명과 보유 수량이 보이는 잔고 사진을 선택해 주세요.", "This is a transaction photo. Choose a balance photo showing holding names and quantities.") : t("잔고 표를 읽지 못했어요. 종목명·보유 수량 제목까지 포함하거나 직접 입력해 주세요.", "The balance table could not be read. Include the name and quantity headers, or enter holdings manually.")); return; }
      const next = result.rows.map(row => ({ ...row, key: crypto.randomUUID(), verified: false }));
      setRows(next); setActive(next[0].key); previewUrl.current = URL.createObjectURL(file); setPhoto(previewUrl.current);
      setMessage(t(`${next.length}종목을 읽었어요. 사진과 맞는지 확인해 주세요.`, `${next.length} possible holdings found. Check them against the photo.`));
    } catch { if (request === generation.current && !controller.signal.aborted) setError(t("사진을 읽지 못했어요. JPG·PNG·WebP, 12MB·1,600만 픽셀 이하로 다시 선택하거나 직접 입력해 주세요.", "Could not read the photo. Choose JPG, PNG or WebP under 12 MB and 16 megapixels, or enter manually.")); }
    finally { if (request === generation.current) { setProgress(null); task.current = null; } }
  }
  const valid = rows.length > 0 && rows.length <= remaining && rows.every(row => row.instrument && row.verified && balanceQuantity(row.quantity));
  const verifiedCount = rows.filter(row => row.verified && row.instrument && balanceQuantity(row.quantity)).length;
  return <section className={styles.panel} aria-label={t("잔고 사진으로 시작하기", "Start with a balance photo")}>
    <div className={styles.intro}>
      <span className={styles.icon} aria-hidden="true"><ImagePlus size={26} /></span>
      <SectionHeading title={t("잔고 사진으로 간편하게", "Start with a balance photo")} description={t("기기에서 읽고, 확인한 종목만 담아요.", "Read on your device. Add only what you verify.")} />
    </div>
    <div className={styles.choose}><Button type="button" variant="secondary" disabled={busy || rows.length > 0 || remaining < 1} onClick={() => fileInput.current?.click()}><ImagePlus size={19} aria-hidden="true" />{t("잔고 사진 선택", "Choose balance photo")}</Button></div>
    <Input ref={fileInput} type="file" hidden aria-label={t("잔고 사진 파일", "Balance photo file")} accept="image/jpeg,image/png,image/webp" disabled={busy || rows.length > 0 || remaining < 1} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void recognize(file); }} />
    <InfoDisclosure summary={t("어떤 사진을 올리나요?", "Which photo should I use?")}>
      <p>{t("종목명·보유 수량 제목까지 포함해 주세요. 사진은 기기에서만 읽으며 전송·보관하지 않습니다.", "Include the holding name and quantity headers. Photos are read only on this device, without upload or storage.")}</p>
      <p>{t("수량은 소수점 6자리까지 지원해요. 매입가·평가금액은 자동 등록하지 않으며 중복 사진이나 일반·소수점 잔고도 자동 합산하지 않아요. 종목과 수량을 확인한 뒤 목록에서 저장해 주세요.", "Quantities support up to six decimal places. Purchase prices and values are not added automatically. Duplicate photos and whole/fractional holdings are not merged. Review holdings and quantities before saving the list.")}</p>
    </InfoDisclosure>
    {progress !== null && <><Status as="p" role="status">{progress < 30 ? t("사진 읽기를 준비하고 있어요…", "Preparing to read your photo…") : t(`사진을 읽고 있어요 · ${progress}%`, `Reading your photo · ${progress}%`)}</Status><progress className={styles.progress} max={100} value={progress} aria-label={t("사진 인식 진행", "Photo reading progress")} /><Button type="button" variant="ghost" onClick={() => { generation.current++; task.current?.abort(); task.current = null; setProgress(null); setMessage(t("인식을 취소했어요.", "Reading cancelled.")); }}>{t("취소", "Cancel")}</Button></>}
    {message && <Status as="p" role="status">{message}</Status>}
    {error && <Status as="p" tone="danger" role="alert">{error}</Status>}
    {rows.length > 0 && <div className={styles.review}>
      <div className={styles.reviewHeading}><strong>{t("종목·수량 확인", "Review holdings and quantities")}</strong><span>{verifiedCount}/{rows.length}</span></div>
      <InfoDisclosure summary={t("선택한 사진 보기", "View selected photo")}>{/* Keep the local blob on this device; never send it to the optimizer. */}{photo && <Image unoptimized width={945} height={2048} src={photo} className={styles.photo} alt={t("선택한 잔고 사진, 저장 전 수량 대조용", "Selected balance photo for quantity verification")} />}</InfoDisclosure>
      <div className={styles.rows}>{rows.map(row => <div className={styles.row} key={row.key} data-active={active === row.key}>
        <div><strong>{row.instrument?.name ?? row.label}</strong><small>{row.quantity ? t(`${row.quantity}주`, `${row.quantity} shares`) : t("수량 확인 필요", "Quantity needed")} · {row.verified ? t("확인 완료", "Verified") : t("확인 필요", "Review needed")}</small></div>
        <div className={styles.actions}><Button variant="secondary" type="button" disabled={busy} aria-pressed={active === row.key} onClick={() => setActive(row.key)}>{row.verified && <Check size={16} aria-hidden="true" />}{t("확인", "Review")}</Button><Button variant="ghost" type="button" disabled={busy} aria-label={t(`${row.label} 제외`, `Remove ${row.label}`)} onClick={() => { const next = rows.filter(item => item.key !== row.key); setRows(next); if (active === row.key) setActive(next[0]?.key ?? ""); }}>{t("제외", "Remove")}</Button></div>
      </div>)}</div>
      {current && <div className={styles.editor} key={current.key}>
        <strong>{current.label}</strong>
        {current.instrument ? <><p className={styles.note}>{current.instrument.name} · {current.instrument.ticker} · {current.instrument.currency}</p><Button variant="ghost" type="button" disabled={busy} onClick={() => update(current.key, { instrument: undefined })}>{t("종목 다시 선택", "Choose again")}</Button></> : <InstrumentSearch initialQuery={current.label} privateQuery preview={preview} disabled={busy} manualEntryAvailable={false} onSelect={instrument => {
          if (rows.some(row => row.key !== current.key && row.instrument?.market === instrument.market && row.instrument.ticker === instrument.ticker)) { setError(t("같은 종목이 있어요. 사진이 겹쳤는지 확인하고, 합산하려면 목록에서 수량을 직접 수정해 주세요.", "This holding already exists. Check for overlapping photos. To combine holdings, edit the quantity in the review list.")); return; }
          update(current.key, { instrument });
        }} />}
        <Field>{t("보유 수량", "Quantity")}<Input inputMode="decimal" value={current.quantity} maxLength={24} disabled={busy} onChange={event => update(current.key, { quantity: event.target.value })} /></Field>
        <Field className={styles.check}><Input type="checkbox" checked={current.verified} disabled={busy || !current.instrument || !balanceQuantity(current.quantity)} onChange={event => update(current.key, { verified: event.target.checked })} />{t("사진의 종목과 수량을 확인했어요.", "I verified the holding and quantity against the photo.")}</Field>
      </div>}
      <div className={styles.actions}><Button variant="primary" type="button" disabled={busy || !valid} onClick={() => {
        const accepted = onAdd(rows.map(row => ({ key: row.key, instrumentId: row.instrument!.id, name: row.instrument!.name, ticker: row.instrument!.ticker, market: row.instrument!.market, assetType: row.instrument!.assetType, quantity: balanceQuantity(row.quantity)!, averageCost: "", currentPrice: "" })));
        if (accepted) { clear(); setMessage(t("목록에 담았어요. 계좌·수량 확인 후 목록을 저장해 주세요.", "Added to your review list. Check the account and quantities, then save the list.")); } else setError(t("같은 종목이 있거나 등록 한도를 넘었어요. 기존 목록을 확인해 주세요.", "A holding is already in the list, or the limit was exceeded. Check your review list."));
      }}>{t(`${rows.length}종목 확인 목록에 담기`, `Add ${rows.length} holdings to review`)}</Button><Button variant="ghost" type="button" disabled={busy} onClick={() => { clear(); setMessage(""); setError(""); }}>{t("다른 사진 선택", "Choose another photo")}</Button></div>
      {rows.length > remaining && <p className={styles.note}>{t(`${remaining}종목을 더 담을 수 있어요. 일부를 제외하고 나누어 등록해 주세요.`, `You can add ${remaining} more holdings. Remove some to add them separately.`)}</p>}
    </div>}
  </section>;
}
