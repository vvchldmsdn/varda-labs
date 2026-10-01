"use client";
import Link from "next/link";
import { useI18n } from "@/components/i18n/locale-provider";
import { intlLocale } from "@/lib/i18n/locale";
import { clearPlanReturnCookies, planReturnIntentCookies } from "@/lib/auth/plan-return";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { preparePlanAccount } from "@/app/plans/actions";
import { SELF_SERVICE_TENANT_ONBOARDING_POLICY } from "@/lib/auth/self-service-tenant-onboarding";
import { createPlanDraft, parseDraft, PLAN_STORAGE_KEY, type PlanDraft, type PlanInput } from "@/lib/investment-plan";
import { trackFirstVisit } from "@/lib/first-visit-events";
import { PlanResults } from "./plan-results";
import { ProductTour } from "./product-tour";
import styles from "./first-visit.module.css";
const planEnglish: Record<string, string> = {
  "다음 투자도, 여기서 이어가세요.": "Continue your next investment here.",
  "내 투자계획": "My investment plans",
  "계획을 저장하면 자산과 목표는 그대로, 다음 투자금만 바꿔 다시 계산할 수 있어요.": "Save your holdings and targets, then calculate again with a new contribution.",
  "계획을 확인하고 있어요.": "Loading your plans.",
  "저장 연결 안내": "Plan storage status",
  "잠시 후 다시 시도해 주세요.": "Please try again shortly.",
  "지금은 로그인할 수 없어요. 계산 결과는 그대로 남아 있습니다.": "Sign-in is temporarily unavailable. Your results are preserved.",
  "계획을 불러오지 못했어요. 계산 결과는 그대로 남아 있습니다.": "Plans could not be loaded. Your results are preserved.",
  "확인 중…": "Checking…",
  "다시 확인": "Check again",
  "내 결과로 돌아가기": "Back to my results",
  "투자금 계산하기": "Calculate a contribution",
  "입력은 한 번, 계획은 계속.": "One input. Plans you can revisit.",
  "로그인하면 이 계획을 내 계정에 보관할 수 있어요.": "Sign in to keep this plan in your account.",
  "가입하고 저장 이어가기": "Sign up and continue saving",
  "기존 계정으로 로그인": "Sign in to your account",
  "가입하지 않고 결과로 돌아가기": "Back to results without signing up",
  "이메일·로그인 확인이 끝났습니다. 계획을 보관할 계정을 준비합니다. 계좌나 실제 자산은 만들지 않습니다.": "Your sign-in is verified. Prepare your Cairn account to save plans; this creates no brokerage accounts or holdings.",
  "연결해야 할 기존 기록이 없으며 새 Cairn Labs 계정으로 시작합니다.": "I have no existing records to link and will start a new Cairn Labs account.",
  "계정 준비 중…": "Preparing account…",
  "계정 준비하고 계획 확인": "Prepare account and view plans",
  "기존 기록 연결 확인": "Check existing account links",
  "지금 로그인한 내 계정에 입력한 내용을 투자계획으로 저장합니다.": "Save these inputs as a plan in my signed-in account.",
  "저장 중…": "Saving…",
  "확인한 계획 저장": "Save confirmed plan",
  "입력 수정": "Edit inputs",
  "이름·평가금액·목표 비중·투자금을 저장합니다. 실제 보유자산 등록은 별도이며, 저장한 계획은 여기서 삭제할 수 있어요.": "Names, values, target weights and contributions are saved. Actual holdings are separate. You can delete saved plans here.",
  "저장한 계획": "Saved plan",
  "다음 투자 계획 계산하기": "Calculate the next contribution",
  "이 자산을 실제 보유종목으로 등록": "Register these as actual holdings",
  "이름과 계획 금액을 참고하고, 실제 종목과 수량을 확인하면 시세·변동 추적을 시작할 수 있습니다. 평가금액으로 수량이나 매입단가를 추정하지 않습니다. 계좌가 없다면 첫 계좌도 필요합니다.": "Confirm the actual instruments and quantities to start tracking prices and movements. Quantities and costs are never inferred from planned values. Create an account first if needed.",
  "실제 자산 등록은 나중에": "Register holdings later",
  "저장 목록 다시 확인": "Refresh saved plans",
  "다음 투자금 계산": "Calculate next contribution",
  "아직 저장한 계획이 없습니다.": "No saved plans yet.",
  "계획 보기": "View plan",
  "이 입력으로 다시 계산": "Recalculate these inputs",
  "삭제": "Delete",
  "계정에서 이 계획을 삭제합니다. 되돌릴 수 없습니다.": "Delete this plan from your account. This cannot be undone.",
  "계획 삭제 확인": "Confirm deletion",
  "이 브라우저의 임시 입력을 복원하지 못했습니다. 계산 화면에서 다시 확인해 주세요.": "The browser draft could not be restored. Check your inputs on the calculator.",
  "임시 입력의 24시간 보관 기간이 끝났습니다.": "The draft expired after 24 hours.",
  "로그인이 만료되었습니다. 입력을 유지한 채 다시 로그인해 주세요.": "Your session expired. Sign in again; your inputs are preserved.",
  "계획은 최대 50개까지 저장할 수 있습니다. 이전 계획을 삭제한 뒤 다시 저장해 주세요.": "You can save up to 50 plans. Delete an older plan before saving another.",
  "계획을 저장하지 못했습니다. 입력은 유지됩니다. 다시 시도하거나 내 계획 목록을 확인해 주세요.": "The plan could not be saved. Your inputs are preserved. Retry or check your saved plans.",
  "계획을 저장했습니다. 실제 보유자산이나 거래로 등록하지 않았습니다.": "Plan saved. No actual holdings or trades were created.",
  "연결이 끊겼습니다. 같은 입력으로 다시 저장하면 중복 생성하지 않습니다.": "Connection lost. Retrying the same input will not create a duplicate.",
  "계정 연결을 완료하지 못했습니다. 다시 시도하거나 기존 계정 연결을 확인해 주세요.": "Account linking failed. Retry or check your existing account.",
  "계정 연결을 확인하지 못했습니다. 입력은 유지됩니다.": "Account linking could not be verified. Your inputs are preserved.",
  "저장한 계획을 삭제했습니다.": "Saved plan deleted.",
  "삭제하지 못했습니다. 다시 시도해 주세요.": "Deletion failed. Please retry.",
  "입력을 옮기지 못했습니다. 브라우저 저장을 허용해 주세요.": "Inputs could not be transferred. Allow browser storage."
};
type SavedPlan = { id: string; input: PlanInput; createdAt: string };
export function PlanLibrary({ localAuthDisabled = false, hideEmpty = false, showTour = true }: { localAuthDisabled?: boolean; hideEmpty?: boolean; showTour?: boolean }) {
  const router=useRouter();
  const { locale, t } = useI18n();
  const text = (ko: string) => t(ko, planEnglish[ko]);
  const [unavailableReason, setUnavailableReason] = useState<"local" | "auth" | "service">("service");
  const [access, setAccess] = useState<"checking" | "ready" | "guest" | "unlinked" | "unavailable">("checking");
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<SavedPlan | null>(null);
  const lock = useRef(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await fetch("/api/investment-plans", { cache: "no-store" });
      if(response.status===401){setAccess("guest");setPlans([]);return;}
      if(response.status===409){setAccess("unlinked");setPlans([]);return;}
      if (!response.ok) { const failure = await response.json().catch(()=>({})); setUnavailableReason(failure.error === "auth_provider_unavailable" ? localAuthDisabled ? "local" : "auth" : "service"); throw new Error(); } const data = await response.json(); setPlans(data.plans); setAccess("ready"); setError(""); }
    catch { setAccess("unavailable");setError(""); }
    finally { setLoading(false); }
  }, [localAuthDisabled]);
  useEffect(() => {
    const frame=requestAnimationFrame(()=>{try { const value = parseDraft(localStorage.getItem(PLAN_STORAGE_KEY)); setDraft(value); if (!value) localStorage.removeItem(PLAN_STORAGE_KEY); } catch { setError("이 브라우저의 임시 입력을 복원하지 못했습니다. 계산 화면에서 다시 확인해 주세요."); } void load();});
    return()=>cancelAnimationFrame(frame);
  }, [load]);
  useEffect(() => {
    if (!draft) return;
    const timer=setTimeout(()=>{try { const stored=parseDraft(localStorage.getItem(PLAN_STORAGE_KEY)); if (!stored || stored.id===draft.id) localStorage.removeItem(PLAN_STORAGE_KEY); } catch {} setDraft(null); setMessage("임시 입력의 24시간 보관 기간이 끝났습니다.");},Math.max(0,draft.expiresAt-Date.now()));
    return()=>clearTimeout(timer);
  },[draft]);
  async function save() {
    if (lock.current || !draft || !confirmed || draft.expiresAt <= Date.now()) return;
    lock.current=true; setPending(true); setError("");
    try {
      const response=await fetch("/api/investment-plans",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:draft.id,input:draft.input})});
      if (!response.ok) {
        const failure=await response.json().catch(()=>({error:"unknown"}));
        if(response.status===401){setAccess("guest");setPlans([]);setSelected(null);}
        if(failure.error==="identity_unlinked"){setAccess("unlinked");setConfirmed(false);}
        setError(response.status===401 ? "로그인이 만료되었습니다. 입력을 유지한 채 다시 로그인해 주세요." : failure.error==="plan_limit" ? "계획은 최대 50개까지 저장할 수 있습니다. 이전 계획을 삭제한 뒤 다시 저장해 주세요." : "계획을 저장하지 못했습니다. 입력은 유지됩니다. 다시 시도하거나 내 계획 목록을 확인해 주세요."); return;
      }
      const data=await response.json();
      // The id is stable across retries; success is emitted only after the server confirms it.
      trackFirstVisit("plan_saved",data.id);
      try { const current=parseDraft(localStorage.getItem(PLAN_STORAGE_KEY)); if(current?.id===draft.id) localStorage.removeItem(PLAN_STORAGE_KEY); } catch {}
      for (const cookie of clearPlanReturnCookies(location.protocol === "https:")) document.cookie = cookie;
      setSelected({id:data.id,input:draft.input,createdAt:new Date().toISOString()});setDraft(null);setMessage("계획을 저장했습니다. 실제 보유자산이나 거래로 등록하지 않았습니다."); await load();
    } catch {setError("연결이 끊겼습니다. 같은 입력으로 다시 저장하면 중복 생성하지 않습니다.");}
    finally {lock.current=false;setPending(false);}
  }
  async function prepare() {
    if(lock.current || !confirmed) return; lock.current=true;setPending(true);setError("");
    try {const form=new FormData();form.set("confirmation",SELF_SERVICE_TENANT_ONBOARDING_POLICY.confirmationValue);const result=await preparePlanAccount(form);
      if(result.status==="success" || result.status==="already_ready") {if(result.status==="success")trackFirstVisit("signup_completed");window.location.reload();}
      else setError("계정 연결을 완료하지 못했습니다. 다시 시도하거나 기존 계정 연결을 확인해 주세요.");
    } catch {setError("계정 연결을 확인하지 못했습니다. 입력은 유지됩니다.");}finally{lock.current=false;setPending(false);}
  }
  async function remove(id:string) {
    if(lock.current)return;lock.current=true;setPending(true);
    try {
      const response=await fetch("/api/investment-plans",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});
      if(!response.ok){const failure=await response.json().catch(()=>({error:"unknown"}));if(response.status!==404||failure.error!=="plan_not_found")throw new Error();}
      if(selected?.id===id)setSelected(null);setMessage("저장한 계획을 삭제했습니다.");await load();
    }catch{setError("삭제하지 못했습니다. 다시 시도해 주세요.");}finally{lock.current=false;setPending(false);}
  }
  function reuse(plan:SavedPlan,holdings=false){try{localStorage.setItem(PLAN_STORAGE_KEY,JSON.stringify(createPlanDraft(plan.input)));router.push(holdings?"/portfolio/holdings/new?from=plan":"/try?mode=personal");}catch{setError("입력을 옮기지 못했습니다. 브라우저 저장을 허용해 주세요.");}}
  function authIntent(){for (const cookie of planReturnIntentCookies("allocation", location.protocol === "https:")) document.cookie = cookie;}
  function cancelAuthIntent(){for (const cookie of clearPlanReturnCookies(location.protocol === "https:")) document.cookie = cookie;}
  if (hideEmpty && !draft && !plans.length && !selected && !error && !message) return null;
  return <section className={styles.planLayout} data-plan-tour={showTour}><div className={styles.planMain}><p className={styles.eyebrow}>MY PLANS</p><h1>{draft?text("다음 투자도, 여기서 이어가세요."):text("내 투자계획")}</h1><p className={styles.privacy}>{text("계획을 저장하면 자산과 목표는 그대로, 다음 투자금만 바꿔 다시 계산할 수 있어요.")}</p>
    {message?<p role="status" className={styles.notice}>{text(message)}</p>:null}{error?<p role="alert" className={styles.error}>{text(error)}</p>:null}
    {loading?<p role="status">{text("계획을 확인하고 있어요.")}</p>:null}
    {access==="unavailable"?<section className={styles.saveUnavailable} aria-label={text("저장 연결 안내")}><h2>{text("잠시 후 다시 시도해 주세요.")}</h2><p role="alert">{unavailableReason==="auth" || unavailableReason==="local" ? text("지금은 로그인할 수 없어요. 계산 결과는 그대로 남아 있습니다.") : text("계획을 불러오지 못했어요. 계산 결과는 그대로 남아 있습니다.")}</p><div className={styles.actions}><button className={`cairn-secondary ${styles.secondary}`} type="button" disabled={loading} onClick={()=>void load()}>{loading?text("확인 중…"):text("다시 확인")}</button><Link className={`cairn-secondary ${styles.secondary}`} href="/try?mode=personal">{draft?text("내 결과로 돌아가기"):text("투자금 계산하기")}</Link></div></section>:null}
    {access==="guest"?<><h2 className={styles.joinHeading}>{text("입력은 한 번, 계획은 계속.")}</h2><p className={styles.privacy}>{text("로그인하면 이 계획을 내 계정에 보관할 수 있어요.")}</p><div className={styles.actions}><Link className={`cairn-primary ${styles.primary}`} prefetch={false} onClick={authIntent} href="/auth/sign-up">{text("가입하고 저장 이어가기")}</Link><Link prefetch={false} onClick={authIntent} href="/auth/sign-in">{text("기존 계정으로 로그인")}</Link><Link onClick={cancelAuthIntent} href="/try?mode=personal">{text("가입하지 않고 결과로 돌아가기")}</Link></div></>:null}
    {access==="unlinked"?<><p className={styles.notice}>{text("이메일·로그인 확인이 끝났습니다. 계획을 보관할 계정을 준비합니다. 계좌나 실제 자산은 만들지 않습니다.")}</p><label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{text("연결해야 할 기존 기록이 없으며 새 Cairn Labs 계정으로 시작합니다.")}</label><button className={`cairn-primary ${styles.primary}`} disabled={!confirmed||pending} onClick={prepare}>{pending?text("계정 준비 중…"):text("계정 준비하고 계획 확인")}</button><p><Link href="/auth/session?view=account">{text("기존 기록 연결 확인")}</Link></p></>:null}

    {access==="ready"&&draft?<><label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{text("지금 로그인한 내 계정에 입력한 내용을 투자계획으로 저장합니다.")}</label><div className={styles.actions}><button className={`cairn-primary ${styles.primary}`} disabled={!confirmed||pending} onClick={save}>{pending?text("저장 중…"):text("확인한 계획 저장")}</button><Link href="/try?mode=personal">{text("입력 수정")}</Link></div></>:null}
    {draft?<PlanResults input={draft.input}/>:null}
    {draft?<p className={styles.privacy}>{text("이름·평가금액·목표 비중·투자금을 저장합니다. 실제 보유자산 등록은 별도이며, 저장한 계획은 여기서 삭제할 수 있어요.")}</p>:null}
    {selected?<section className={styles.saved}><h2>{text("저장한 계획")}</h2><PlanResults input={selected.input}/><div className={styles.actions}><button className={`cairn-primary ${styles.primary}`} onClick={()=>reuse(selected)}>{text("다음 투자 계획 계산하기")}</button><button className={`cairn-secondary ${styles.secondary}`} onClick={()=>reuse(selected,true)}>{text("이 자산을 실제 보유종목으로 등록")}</button></div><p className={styles.privacy}>{text("이름과 계획 금액을 참고하고, 실제 종목과 수량을 확인하면 시세·변동 추적을 시작할 수 있습니다. 평가금액으로 수량이나 매입단가를 추정하지 않습니다. 계좌가 없다면 첫 계좌도 필요합니다.")}</p><Link href="/plans">{text("실제 자산 등록은 나중에")}</Link></section>:null}
    {access==="ready"?<><div className={styles.actions}><button className={`cairn-secondary ${styles.secondary}`} disabled={pending} onClick={()=>void load()}>{text("저장 목록 다시 확인")}</button><Link href="/try?mode=personal">{text("다음 투자금 계산")}</Link></div>{!loading&&!plans.length&&!error?<p>{text("아직 저장한 계획이 없습니다.")}</p>:null}{plans.map(plan=><article key={plan.id}><h2>{new Date(plan.createdAt).toLocaleString(intlLocale(locale))} · {plan.input.rows.length}{t("개 자산의 계획", " holdings plan")}</h2><p className={styles.privacy}>{plan.input.rows.map(row=>row.name).join(" · ")}</p><div className={styles.actions}><button onClick={()=>setSelected(plan)}>{text("계획 보기")}</button><button onClick={()=>reuse(plan)}>{text("이 입력으로 다시 계산")}</button><details><summary>{text("삭제")}</summary><p>{text("계정에서 이 계획을 삭제합니다. 되돌릴 수 없습니다.")}</p><button disabled={pending} onClick={()=>void remove(plan.id)}>{text("계획 삭제 확인")}</button></details></div></article>)}</>:null}
  </div>{showTour ? <aside className={styles.planPreview}><ProductTour /></aside> : null}</section>;
}
