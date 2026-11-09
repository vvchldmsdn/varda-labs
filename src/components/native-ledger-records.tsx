"use client";

import { useEffect, useState } from "react";
import { Button, Field, Select, SectionTitle, Status } from "@/components/cairn-ui";
import { nativeRecordAmountLabel, nativeRecordNumber, nativeRecordTypeLabel, type NativeLedgerRecord, type NativeLedgerRecordsRead } from "@/lib/native-ledger-records";
import styles from "./native-ledger-records.module.css";

type ReadyRecords = Extract<NativeLedgerRecordsRead, { state: "ready" }>;
type ReadState = { key: string; result: ReadyRecords | null; error: boolean };

/** No write actions. A scope/session change hides the prior response immediately. */
export function NativeLedgerRecords({ accountId, sessionKey, refreshKey = "", locale = "ko", journal = false }: {
  accountId: string; sessionKey: string; journal?: boolean; refreshKey?: string | number; locale?: "ko" | "en";
}) {
  const [retry, setRetry] = useState(0), [state, setState] = useState<ReadState | null>(null);
  const key = JSON.stringify([accountId, sessionKey, refreshKey, retry]);
  const visible = state?.key === key ? state : null;
  const t = (ko: string, en: string) => locale === "en" ? en : ko;
  useEffect(() => {
    // Account data mounts this section after navigation; complete the explicit link's anchor.
    if (window.location.hash === "#native-records") document.getElementById("native-records")?.scrollIntoView({ block: "start" });
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/portfolio/ledger/records?accountId=${encodeURIComponent(accountId)}`, {
          cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        const result = await response.json();
        if (!response.ok || result.sessionKey !== sessionKey || result.state !== "ready" || result.account?.id !== accountId || !Array.isArray(result.records) || result.records.some((row: NativeLedgerRecord) => row.accountId !== accountId)) throw new Error("unavailable");
        if (active) setState({ key, result, error: false });
      } catch { if (active) setState({ key, result: null, error: true }); }
    })();
    return () => { active = false; controller.abort(); };
  }, [accountId, sessionKey, key]);

  return <section id="native-records" className={styles.section} aria-busy={!visible} aria-label={t("직접 기록한 거래", "Recorded transactions")}>
    <header className={styles.header}><div><SectionTitle>{t("직접 기록한 거래", "Recorded transactions")}</SectionTitle>
      {visible?.result && <p>{visible.result.account.name} · {visible.result.hasMore ? t(`최근 ${visible.result.limit}건`, `Latest ${visible.result.limit} records`) : t(`${visible.result.records.length}건`, `${visible.result.records.length} records`)}</p>}</div>
      <Button type="button" variant="ghost" size="sm" onClick={() => setRetry(value => value + 1)} disabled={!visible}>{t("새로고침", "Refresh")}</Button></header>
    {!visible ? <p role="status">{t("기록을 불러오고 있어요…", "Loading records…")}</p> : visible.error ? <Status as="p" tone="warning">{t("기록을 불러오지 못했어요. 새로고침해 주세요.", "Records could not be loaded. Try refreshing.")}</Status> : visible.result && <>
      {visible.result.records.length === 0 ? <p>{t("이 계좌에 직접 기록한 거래가 없어요.", "No transactions have been recorded for this account.")}</p> : journal ? <RecordJournal records={visible.result.records} locale={locale}/> : <ol className={styles.list}>{visible.result.records.map(record => <NativeRecordItem key={record.id} record={record} locale={locale} />)}</ol>}
      {visible.result.hasMore && <p role="status" className={styles.note}>{t("이전 기록은 보관되어 있어요. 이 목록에는 최근 100건만 표시합니다.", "Earlier records are retained. This list shows the latest 100 records.")}</p>}
    </>}
  </section>;
}

export function NativeRecordItem({ record, locale }: { record: NativeLedgerRecord; locale: "ko" | "en" }) {
  const t = (ko: string, en: string) => locale === "en" ? en : ko;
  const stamp = record.reportedDate ?? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(record.at));
  return <li className={styles.record}>
    <div className={styles.identity}><time dateTime={record.reportedDate ?? record.at}>{stamp} · {t(record.reportedDate ? "날짜만 확인" : "한국시간", record.reportedDate ? "Date only" : "Korea time")}</time>
      <div><strong>{nativeRecordTypeLabel(record.type, locale)}{record.direction ? ` · ${t(record.direction === "in" ? "받음" : "보냄", record.direction === "in" ? "Incoming" : "Outgoing")}` : ""}</strong>
        {(record.assetName || record.ticker) && <span>{record.assetName ?? record.ticker}{record.assetName && record.ticker ? ` · ${record.ticker}` : ""}</span>}</div></div>
    <div className={styles.values}>
      {record.quantity && <strong>{nativeRecordNumber(record.quantity)} {t("주", "shares")}</strong>}
      {record.unitPrice && <span>{t("체결 단가", "Execution price")} {nativeRecordNumber(record.unitPrice.amount)} {record.unitPrice.currency}</span>}
      {record.amounts.map((amount, index) => <span key={`${amount.kind}:${index}`}>{nativeRecordAmountLabel(amount.kind, locale)} <strong>{nativeRecordNumber(amount.amount)} {amount.currency}</strong></span>)}
      {record.ratio && <span>{t("수량 비율", "Quantity ratio")} {record.ratio.n}:{record.ratio.d}</span>}
      {record.costLotCount !== null && <span>{t(`매입 근거 ${record.costLotCount}건`, `${record.costLotCount} acquisition cost entries`)}</span>}
      {record.settlementUnconfirmed && <span className={styles.note}>{t("현금 정산 미확인", "Cash settlement unconfirmed")}</span>}
    </div>
    {record.memo && <p className={styles.memo}>{record.memo}</p>}
  </li>;
}

const koreaDate = new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"});

function RecordJournal({records,locale}:{records:NativeLedgerRecord[];locale:"ko"|"en"}) {
  const [requestedMonth,setMonth]=useState("");
  const [filter,setFilter]=useState<"all"|"buy"|"sell">("all");
  const dated=records.map(record=>({record,day:record.reportedDate ?? koreaDate.format(new Date(record.at))}));
  const months=Array.from(new Set(dated.map(({day})=>day.slice(0,7)))).sort().reverse();
  const month=months.includes(requestedMonth)?requestedMonth:months[0];
  const groups=new Map<string,NativeLedgerRecord[]>();
  for(const {record,day} of dated) {
    if(day.slice(0,7)!==month || filter!=="all" && filter!==record.type) continue;
    const entries=groups.get(day) ?? [];
    entries.push(record);groups.set(day,entries);
  }
  return <div className={styles.journal}>
    <aside><Field htmlFor="record-month">{locale==="ko"?"기록한 달":"Record month"}</Field>
      <Select id="record-month" value={month} onChange={e=>setMonth(e.target.value)}>{months.map(value=><option key={value}>{value}</option>)}</Select>
      <div role="group" aria-label={locale==="ko"?"거래 종류":"Transaction type"}>{(["all","buy","sell"] as const).map(type=><Button variant="bare" key={type} type="button" aria-pressed={filter===type} onClick={()=>setFilter(type)}>{locale==="en"?type:{all:"전체",buy:"매수",sell:"매도"}[type]}</Button>)}</div>
    </aside>
    <div className={styles.days}>{[...groups.keys()].sort().reverse().map(day=><section key={day}><h3><time dateTime={day}>{day}</time></h3>
      <ol className={styles.list}>{groups.get(day)!.map(record=><NativeRecordItem key={record.id} record={record} locale={locale}/>)}</ol>
    </section>)}{groups.size===0&&<p role="status">{locale==="ko"?"이 달에는 선택한 거래가 없어요.":"No matching records this month."}</p>}</div>
  </div>;
}
