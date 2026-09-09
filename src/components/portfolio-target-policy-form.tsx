"use client";

import Link from "next/link";
import { ArrowRight, Check, RotateCcw } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { savePortfolioTargetPolicy } from "@/app/portfolio/targets/actions";
import { ManagementText } from "@/components/i18n/management-text";
import { useI18n } from "@/components/i18n/locale-provider";
import type { PortfolioTargetPolicyActionState } from "@/lib/portfolio-target-policy-write";
import { currentTargetEditorWeights, parseDisplayedTargetPercent, targetInputPercent, type PortfolioTargetEditorRow } from "./portfolio-target-policy-editor";
import styles from "./portfolio-target-policy.module.css";

const INITIAL_STATE: PortfolioTargetPolicyActionState = Object.freeze({ status: "idle", message: null });

export function PortfolioTargetPolicyForm({ universeHash, rows, scopeKey, isDesignPreview = false, returnHref, returnLabel }: {
  universeHash: string;
  rows: readonly PortfolioTargetEditorRow[];
  scopeKey: string;
  isDesignPreview?: boolean;
  returnHref?: string;
  returnLabel?: { ko: string; en: string };
}) {
  const { t, locale } = useI18n();
  const [state, action, pending] = useActionState(savePortfolioTargetPolicy, INITIAL_STATE);
  const initialWeights = rows.map(row => row.buyability === "buyable" ? targetInputPercent(row.targetWeightBps) : "0");
  const [weights, setWeights] = useState(() => initialWeights);
  const [editedSinceSubmit, setEditedSinceSubmit] = useState(false);
  const currentWeights = useMemo(() => currentTargetEditorWeights(rows), [rows]);
  const parsedWeights = weights.map(parseDisplayedTargetPercent);
  const totalBps = parsedWeights.some(value => value === null) ? null : parsedWeights.reduce<number>((sum, value) => sum + value!, 0);
  const totalIsValid = totalBps === 10_000;
  const changed = weights.some((value, index) => value !== initialWeights[index]);
  const percent = (value: number) => new Intl.NumberFormat(locale === "en" ? "en-US" : "ko-KR", { maximumFractionDigits: 2 }).format(value);
  const status = totalBps === null ? t("입력을 확인해 주세요", "Check your inputs")
    : totalIsValid ? t("100%로 맞춰졌어요", "Your targets add up to 100%")
    : totalBps < 10_000 ? t(`${percent((10_000 - totalBps) / 100)}%p를 더 배분해 주세요`, `Allocate ${percent((10_000 - totalBps) / 100)} more percentage points`)
    : t(`${percent((totalBps - 10_000) / 100)}%p를 줄여 주세요`, `Reduce targets by ${percent((totalBps - 10_000) / 100)} percentage points`);

  return (
    <form action={isDesignPreview ? undefined : action} className={styles.form} onSubmit={event => {
      if (isDesignPreview) event.preventDefault();
      else setEditedSinceSubmit(false);
    }}>
      <input name="scope" type="hidden" value={scopeKey} />
      <input name="rowCount" type="hidden" value={rows.length} />
      <input name="universeHash" type="hidden" value={universeHash} />
      <div className={styles.mobileTotal}><div><span>{t("합계", "Total")}</span><strong data-valid={totalIsValid}>{totalBps === null ? "—" : `${percent(totalBps / 100)}%`}</strong><small>/ 100%</small></div><a href="#target-save-summary">{t("저장 확인", "Review & save")}<ArrowRight size={14} aria-hidden="true" /></a></div>
      <div className={styles.editor}>
        <div className={styles.editorHeading}>
          <div><h2>{t("종목별 목표", "Targets by holding")}</h2><p>{t("전체 합계가 100%가 되도록 입력하세요.", "Set each share so the total equals 100%.")}</p></div>
          <button className={styles.reset} type="button" disabled={pending || !changed} onClick={() => {
            setWeights(initialWeights);
            setEditedSinceSubmit(true);
          }}><RotateCcw size={14} aria-hidden="true" />{t("입력 되돌리기", "Reset edits")}</button>
        </div>
        <div className={styles.legend}><span><i />{t("현재 비중", "Current weight")}</span><span><i />{t("입력한 목표", "Your target")}</span></div>
        <ol className={styles.rows}>
          {rows.map((row, index) => {
            const buyable = row.buyability === "buyable";
            const invalid = parsedWeights[index] === null;
            const currentWeight = currentWeights[index];
            const fieldId = `target-weight-${index}`;
            const errorId = `${fieldId}-error`;
            return <li className={styles.row} key={`${row.accountName}:${row.market}:${row.currency}:${row.ticker ?? row.assetName}`}>
              <div className={styles.identity}><span className={styles.rowNumber}>{String(index + 1).padStart(2, "0")}</span><div><label htmlFor={fieldId}>{row.assetName}</label><p>{row.accountName}{row.ticker ? ` · ${row.ticker}` : ""}</p></div></div>
              <div className={styles.weightInput}><label htmlFor={fieldId}>{t("목표 비중", "Target weight")}</label><div><input
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? errorId : !buyable ? `${fieldId}-restriction` : undefined}
                autoComplete="off" disabled={!buyable || pending} id={fieldId} inputMode="decimal" max="100" min="0" name={`targetWeight:${index}`}
                onChange={event => { setWeights(previous => previous.map((value, position) => position === index ? event.target.value : value)); setEditedSinceSubmit(true); }}
                required step="0.01" type="number" value={buyable ? weights[index] : "0"}
              /><span aria-hidden="true">%</span></div>{!buyable ? <input name={`targetWeight:${index}`} type="hidden" value="0" /> : null}</div>
              <div className={styles.comparison}>
                <div className={styles.tracks} aria-hidden="true"><span style={{ width: `${currentWeight ?? 0}%` }} /><span style={{ width: `${(parsedWeights[index] ?? 0) / 100}%` }} /></div>
                <span>{t("현재", "Current")} {currentWeight === null ? "—" : `${percent(currentWeight)}%`}</span>
              </div>
              {invalid ? <p className={styles.fieldError} id={errorId}>{t("0~100 사이, 소수점 둘째 자리까지 입력하세요.", "Enter 0–100 with up to two decimal places.")}</p> : null}
              {!buyable ? <p className={styles.restriction} id={`${fieldId}-restriction`}>{t("이 종목은 현재 목표 0%만 설정할 수 있어요.", "This holding currently supports a target of 0% only.")}</p> : null}
              <details className={styles.rowDetails}><summary>{t("평가액·종목 정보", "Valuation & holding details")}<span aria-hidden="true">+</span></summary><dl>
                <div><dt>{t("현재 평가액", "Current value")}</dt><dd>{row.currentValueKrw === null || !Number.isFinite(row.currentValueKrw) ? t("가격 근거 없음", "Price unavailable") : `₩${new Intl.NumberFormat(locale === "en" ? "en-US" : "ko-KR", { maximumFractionDigits: 0 }).format(row.currentValueKrw)}`}</dd></div>
                <div><dt>{t("시장 · 통화", "Market · currency")}</dt><dd>{row.market === "korea" ? t("한국", "Korea") : row.market === "us" ? t("미국", "US") : row.market} · {row.currency}</dd></div>
              </dl></details>
            </li>;
          })}
        </ol>
        {currentWeights.some(value => value === null) ? <p className={styles.dataNote}>{t("일부 평가액이 없거나 전체 평가액이 유효하지 않아 현재 비중은 표시하지 않습니다. 목표비중은 직접 입력할 수 있어요.", "Current weights are unavailable because some valuations are missing or the total is invalid. You can still enter targets.")}</p> : null}
      </div>
      <aside className={styles.summary} id="target-save-summary" aria-labelledby="target-total-heading">
        <p className={styles.eyebrow} id="target-total-heading">{t("내가 정한 비중", "YOUR ALLOCATION")}</p>
        <p className={styles.total} data-valid={totalIsValid}><strong>{totalBps === null ? "—" : percent(totalBps / 100)}</strong><span>%</span></p>
        <div className={styles.totalTrack} aria-hidden="true"><span style={{ width: `${Math.min(100, (totalBps ?? 0) / 100)}%` }} data-valid={totalIsValid} /></div>
        <p className={styles.totalStatus} aria-live="polite" data-valid={totalIsValid}>{totalIsValid ? <Check size={16} aria-hidden="true" /> : null}{status}</p>
        <p className={styles.summaryNote}>{t("추가 투입과 포트폴리오 분석에 사용할 나의 기준입니다. 저장해도 주문은 실행되지 않습니다.", "Your reference for contribution calculations and portfolio analysis. Saving does not place any orders.")}</p>
        <div className={styles.saveArea}>
          <button className={styles.save} disabled={isDesignPreview || pending || !totalIsValid || rows.length === 0} type="submit">{pending ? <span className={styles.spinner} aria-hidden="true" /> : null}{t(pending ? "저장 중" : "목표비중 저장", pending ? "Saving…" : "Save targets")}<ArrowRight size={17} aria-hidden="true" /></button>
          {isDesignPreview ? <p>{t("예시 데이터입니다. 편집만 체험할 수 있으며 저장하지 않습니다.", "Demo data. Try editing; changes cannot be saved.")}</p> : <p>{t("저장하면 이 범위의 새 승인본으로 적용됩니다.", "Saving creates a new approved revision for this scope.")}</p>}
        </div>
        {state.message && !editedSinceSubmit ? <div className={styles.feedback} role="status" data-success={state.status === "success"}><ManagementText>{state.message}</ManagementText>{state.status === "success" && returnHref && returnLabel ? <Link href={returnHref}>{t(returnLabel.ko, returnLabel.en)}<ArrowRight size={15} aria-hidden="true" /></Link> : null}</div> : null}
        <details className={styles.rules}><summary>{t("저장 기준 알아보기", "About saving targets")}<span aria-hidden="true">+</span></summary><ul><li>{t("각 비중은 0~100%, 소수점 둘째 자리까지 입력합니다.", "Each weight must be 0–100%, with up to two decimal places.")}</li><li>{t("합계는 정확히 100%여야 합니다. 0% 종목도 기록에 남습니다.", "The total must be exactly 100%. Holdings with a 0% target remain in the record.")}</li><li>{t("같은 종목이어도 계좌가 다르면 각각 설정합니다.", "The same holding in different accounts has a separate target in each account.")}</li><li>{t("이전 승인본은 덮어쓰지 않고 이력으로 보존합니다.", "Previous approvals remain in history; they are not overwritten.")}</li><li>{t("편집 중 보유종목 구성이 바뀌면 다시 확인한 뒤 저장해야 합니다.", "If holdings change while editing, review the updated list before saving.")}</li></ul></details>
      </aside>
    </form>
  );
}
