"use client";
import { useMemo, useState } from "react";
import { MoneyInput } from "@/components/first-visit/money-input";
import { AdditionalContributionFlowScene, AdditionalContributionAllocationTable } from "@/components/additional-contribution/additional-contribution-result";
import { AdditionalContributionLogicDialog } from "@/components/additional-contribution/additional-contribution-logic-dialog";
import { buildDemoContribution } from "@/lib/demo-contribution";
import type { PortfolioStructureHoldingRow } from "@/lib/portfolio-structure";
import styles from "./demo.module.css";

export function DemoContribution({ holdings }: { holdings: readonly PortfolioStructureHoldingRow[] }) {
  const [amount, setAmount] = useState("1000000");
  const [equal, setEqual] = useState(false);
  const valid = /^\d+$/.test(amount) && Number(amount) <= 1_000_000_000;
  const preview = useMemo(() => valid ? buildDemoContribution(holdings, Number(amount), equal) : null, [holdings, amount, equal, valid]);
  return <div data-demo-ready="true"><p className={styles.explanation}>금액과 목표를 바꾸면, 같은 배분 엔진이 결과를 다시 계산합니다.</p>
    <div className={styles.controls}><label>추가 투자금 · 원<MoneyInput value={amount} onValueChange={setAmount} aria-invalid={!valid} aria-describedby={!valid ? "demo-amount-error" : undefined}/></label><label>샘플 목표 비중<select value={equal ? "equal" : "sample"} onChange={event => setEqual(event.target.value === "equal")}><option value="sample">샘플에 설정된 목표</option><option value="equal">종목마다 동일 비중</option></select></label></div>
    {!valid ? <p id="demo-amount-error" role="alert">0원부터 10억 원까지, 정수 금액을 입력해 주세요.</p> : null}
    <p className={styles.disclaimer}>매입원가와 MA120 근거가 없는 예시이므로 매도·추세 감액을 적용하지 않습니다. 실제 주문은 실행되지 않습니다.</p>
    {preview ? <><div className={styles.funding}><AdditionalContributionFlowScene preview={preview}/></div><AdditionalContributionLogicDialog preview={preview}/><AdditionalContributionAllocationTable preview={preview}/></> : valid ? <p role="status">{Number(amount) === 0 ? "추가 투자금이 0원이라 나눌 금액이 없어요. 금액을 늘려 다시 계산해보세요." : "현재 입력으로 배분할 수 없습니다."}</p> : null}
  </div>;
}
