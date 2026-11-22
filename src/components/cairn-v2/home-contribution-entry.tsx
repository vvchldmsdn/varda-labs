"use client";

import { useId, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, Field, Form, Input } from "@/components/cairn-ui";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { parseContributionInput } from "@/lib/cairn-v2/planning-contract";
import type { BetaView } from "@/lib/cairn-v2/read-contract";
import { ContributionHome } from "./home-contribution";
import { HomeCard } from "./home-card";
import styles from "./home-contribution.module.css";

function wonFromManwon(value: string) {
  const match = /^(\d+)(?:\.(\d{0,4}))?$/.exec(value.trim());
  if (!match) return null;
  const won = (match[1] + (match[2] ?? "").padEnd(4, "0")).replace(/^0+/, "");
  return parseContributionInput(won).state === "ready" ? won : null;
}

export function ContributionEntry({ view, context, dirty, colors, className, onView }: {
  view: BetaView; context: BetaContext; dirty: boolean; colors: readonly string[];
  className?: string;
  onView: (trigger: HTMLElement, amount?: string) => void;
}) {
  const amountId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<{ base: BetaContext["cashAmountKrw"]; text: string } | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [validate, setValidate] = useState(false);
  const saved = parseContributionInput(context.cashAmountKrw).amount;
  const initial = saved === null ? "" : String(saved / 10000);
  const currentDraft = draft?.base === context.cashAmountKrw ? draft : null;
  const text = currentDraft?.text ?? initial;
  const won = wonFromManwon(text);
  const invalid = validate && !won;
  const canCalculate = context.currency === "KRW";

  function openAllocation(trigger: HTMLElement, submitting = false) {
    const requestedAmount = canCalculate && (submitting || currentDraft !== null) ? won : undefined;
    if (requestedAmount === null) {
      setValidate(true);
      amountRef.current?.focus();
      return;
    }
    setValidate(false);
    setPresetsOpen(false);
    onView(trigger, requestedAmount);
  }

  return <HomeCard kind="contribution" className={className} onOpen={(_, trigger) => openAllocation(trigger)}>
    {canCalculate ? <Form className={styles.entry} noValidate onSubmit={event => {
      event.preventDefault();
      if (submitRef.current) openAllocation(submitRef.current, true);
    }}>
      <Field htmlFor={amountId}>얼마를 더 투자할까요?</Field>
      <div className={styles.inputRow}>
        <div className={styles.inputWrap}>
          <Input ref={amountRef} presentation="amount" id={amountId} aria-label="추가 투자 금액 (만원)" inputMode="decimal" autoComplete="off" placeholder="0"
            aria-invalid={invalid || undefined} aria-describedby={invalid ? amountId + "-error" : undefined}
            value={text} onFocus={() => setPresetsOpen(true)}
            onChange={event => setDraft({ base: context.cashAmountKrw, text: event.target.value })} />
          <span>만원</span>
        </div>
        <Button ref={submitRef} variant="primary" type="submit" className={styles.submit}>배분 보기 <ArrowRight size={14} aria-hidden /></Button>
      </div>
      {invalid && <p id={amountId + "-error"} role="alert">1원부터 1,000억 원까지, 원 단위로 입력해 주세요.</p>}
      {presetsOpen && <div className={styles.presets} role="group" aria-label="투자금 바로가기">
        {[50, 100, 200, 500].map(value => <Button key={value} type="button" variant="bare" aria-pressed={value * 10000 === Number(won)}
          onClick={() => { setDraft({ base: context.cashAmountKrw, text: String(value) }); setPresetsOpen(false); setValidate(false); submitRef.current?.focus(); }}>{value}만원</Button>)}
        <Button type="button" variant="bare" onClick={() => { setPresetsOpen(false); submitRef.current?.focus(); }}>닫기</Button>
      </div>}
    </Form> : <Button variant="secondary" type="button" onClick={e => openAllocation(e.currentTarget)}>배분 보기</Button>}
    <ContributionHome view={view} dirty={dirty || (canCalculate && text !== initial && won !== String(saved))} colors={colors} />
  </HomeCard>;
}
