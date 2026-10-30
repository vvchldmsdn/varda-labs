"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Button, Field, InfoDisclosure, Input, SectionHeading, Status } from "@/components/cairn-ui";
import { InstrumentSearch, type InstrumentChoice } from "./instrument-search";
import { balanceQuantity, type BalancePhotoRow } from "@/lib/balance-photo";
import type { HoldingDraft } from "@/lib/holding-batch";
import styles from "./balance-photo-panel.module.css";

type ReviewRow = BalancePhotoRow & { key: string; instrument?: InstrumentChoice; verified: boolean };
export function BalancePhotoPanel({ onAdd, remaining, disabled, preview = false }: {
  onAdd: (rows: HoldingDraft[]) => boolean; remaining: number; disabled: boolean; preview?: boolean;
}) {
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
      if (result.state !== "review") { setError(result.state === "not_balance" ? "거래 내역 사진입니다. 종목명과 보유 수량이 함께 보이는 잔고 사진을 선택해 주세요." : "잔고 표의 열을 확인하지 못했어요. ‘종목명’과 ‘보유 수량’ 제목까지 포함한 사진을 선택하거나 아래에서 직접 입력해 주세요."); return; }
      const next = result.rows.map(row => ({ ...row, key: crypto.randomUUID(), verified: false }));
      setRows(next); setActive(next[0].key); previewUrl.current = URL.createObjectURL(file); setPhoto(previewUrl.current);
      setMessage(`${next.length}개 후보를 읽었어요. 누락된 종목과 수량을 사진에서 확인해 주세요.`);
    } catch { if (request === generation.current && !controller.signal.aborted) setError("사진을 읽지 못했어요. JPG·PNG·WebP, 12MB·1,600만 픽셀 이하 사진으로 다시 시도해 주세요. 직접 입력도 가능합니다."); }
    finally { if (request === generation.current) { setProgress(null); task.current = null; } }
  }
  const valid = rows.length > 0 && rows.length <= remaining && rows.every(row => row.instrument && row.verified && balanceQuantity(row.quantity));
  return <section className={styles.panel} aria-label="잔고 사진으로 시작하기">
    <div className={styles.intro}>
      <SectionHeading title="잔고 사진으로 시작하기" />
      <p>기기에서 읽기 · 사진 전송·보관 없음</p>
    </div>
    <div className={styles.choose}><Button type="button" variant="secondary" disabled={busy || rows.length > 0 || remaining < 1} onClick={() => fileInput.current?.click()}>잔고 사진 선택 ↗</Button><Input ref={fileInput} type="file" hidden aria-label="잔고 사진 파일" accept="image/jpeg,image/png,image/webp" disabled={busy || rows.length > 0 || remaining < 1} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void recognize(file); }} /></div>
    <InfoDisclosure summary="사진 등록 안내">
      <p>종목명과 보유 수량 제목까지 포함해 주세요. 읽은 종목과 수량은 직접 확인한 뒤 저장합니다.</p>
      <p>수량은 소수점 6자리까지 확인합니다. 매입가·평가금액은 자동 등록하지 않으며, 중복 사진이나 일반·소수점 잔고도 자동 합산하지 않습니다.</p>
    </InfoDisclosure>
    {progress !== null && <><Status as="p" role="status">{progress < 30 ? "처음에는 인식 도구를 준비하는 데 시간이 걸릴 수 있어요." : `사진을 읽고 있어요 · ${progress}%`}</Status><progress className={styles.progress} max={100} value={progress} aria-label="사진 인식 진행" /><Button type="button" variant="secondary" onClick={() => { generation.current++; task.current?.abort(); task.current = null; setProgress(null); setMessage("인식을 취소했어요."); }}>취소</Button></>}
    {message && <Status as="p" role="status">{message}</Status>}
    {error && <Status as="p" tone="danger" role="alert">{error}</Status>}
    {rows.length > 0 && <div className={styles.review}>
      <details><summary>선택한 잔고 사진 보기</summary>{/* Keep the local blob on this device; never send it to the optimizer. */}{photo && <Image unoptimized width={945} height={2048} src={photo} className={styles.photo} alt="선택한 잔고 사진, 저장 전 수량 대조용" />}</details>
      <div className={styles.rows}>{rows.map(row => <div className={styles.row} key={row.key} data-active={active === row.key}>
        <div><strong>{row.instrument?.name ?? row.label}</strong><small>{row.quantity || "수량 확인 필요"}주 · {row.verified ? "확인 완료" : "확인 필요"}</small></div>
        <div className={styles.actions}><Button variant="secondary" type="button" disabled={busy} onClick={() => setActive(row.key)}>확인</Button><Button variant="ghost" type="button" disabled={busy} aria-label={`${row.label} 제외`} onClick={() => { const next = rows.filter(item => item.key !== row.key); setRows(next); if (active === row.key) setActive(next[0]?.key ?? ""); }}>제외</Button></div>
      </div>)}</div>
      {current && <div className={styles.editor} key={current.key}>
        <strong>{current.label}</strong>
        {current.instrument ? <><p className={styles.note}>{current.instrument.name} · {current.instrument.ticker} · {current.instrument.currency}</p><Button variant="ghost" type="button" disabled={busy} onClick={() => update(current.key, { instrument: undefined })}>종목 다시 선택</Button></> : <InstrumentSearch initialQuery={current.label} privateQuery preview={preview} disabled={busy} manualEntryAvailable={false} onSelect={instrument => {
          if (rows.some(row => row.key !== current.key && row.instrument?.market === instrument.market && row.instrument.ticker === instrument.ticker)) { setError("같은 종목이 이미 있어요. 사진이 겹쳤는지 확인하고, 합산이 필요하면 확인 목록에서 수량을 직접 수정해 주세요."); return; }
          update(current.key, { instrument });
        }} />}
        <Field>보유 수량<Input inputMode="decimal" value={current.quantity} maxLength={24} disabled={busy} onChange={event => update(current.key, { quantity: event.target.value })} /></Field>
        <Field className={styles.check}><Input type="checkbox" checked={current.verified} disabled={busy || !current.instrument || !balanceQuantity(current.quantity)} onChange={event => update(current.key, { verified: event.target.checked })} />사진의 종목과 보유 수량을 확인했어요.</Field>
      </div>}
      <div className={styles.actions}><Button variant="primary" type="button" disabled={busy || !valid} onClick={() => {
        const accepted = onAdd(rows.map(row => ({ key: row.key, instrumentId: row.instrument!.id, name: row.instrument!.name, ticker: row.instrument!.ticker, market: row.instrument!.market, assetType: row.instrument!.assetType, quantity: balanceQuantity(row.quantity)!, averageCost: "", currentPrice: "" })));
        if (accepted) { clear(); setMessage("확인 목록에 담았어요. 계좌와 수량을 확인한 후 목록을 저장해 주세요."); } else setError("목록에 같은 종목이 있거나 등록 한도를 넘었어요. 기존 목록을 확인해 주세요.");
      }}>{rows.length}종목 확인 목록에 담기</Button><Button variant="ghost" type="button" disabled={busy} onClick={() => { clear(); setMessage(""); setError(""); }}>다른 사진 선택</Button></div>
      {rows.length > remaining && <p className={styles.note}>이번 목록에는 {remaining}종목을 더 담을 수 있어요. 일부를 제외하고 나누어 등록해 주세요.</p>}
    </div>}
  </section>;
}
