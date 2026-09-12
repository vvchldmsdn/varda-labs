"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { preparePlanAccount } from "@/app/plans/actions";
import { SELF_SERVICE_TENANT_ONBOARDING_POLICY } from "@/lib/auth/self-service-tenant-onboarding";
import { createPlanDraft, parseDraft, PLAN_STORAGE_KEY, type PlanDraft, type PlanInput } from "@/lib/investment-plan";
import { trackFirstVisit } from "@/lib/first-visit-events";
import { PlanResults } from "./plan-results";
import { ProductTour } from "./product-tour";
import styles from "./first-visit.module.css";
type SavedPlan = { id: string; input: PlanInput; createdAt: string };
export function PlanLibrary({ localAuthDisabled = false }: { localAuthDisabled?: boolean }) {
  const router=useRouter();
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
      document.cookie="varda_plan_return=; Path=/; Max-Age=0; SameSite=Lax";
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
  function authIntent(){document.cookie="varda_plan_return=1; Path=/; Max-Age=86400; SameSite=Lax";}
  function cancelAuthIntent(){document.cookie="varda_plan_return=; Path=/; Max-Age=0; SameSite=Lax";}
  return <section className={styles.planLayout}><div className={styles.planMain}><p className={styles.eyebrow}>MY PLANS</p><h1>{draft?"다음 투자도, 여기서 이어가세요.":"내 투자계획"}</h1><p className={styles.privacy}>계획을 저장하면 자산과 목표는 그대로, 다음 투자금만 바꿔 다시 계산할 수 있어요.</p>
    {message?<p role="status" className={styles.notice}>{message}</p>:null}{error?<p role="alert" className={styles.error}>{error}</p>:null}
    {loading?<p role="status">계획을 확인하고 있어요.</p>:null}
    {access==="unavailable"?<section className={styles.saveUnavailable} aria-label="저장 연결 안내"><h2>{unavailableReason==="local"?"현재는 로컬 체험 화면이에요.":"지금은 계정에 저장할 수 없어요."}</h2><p role="alert">{unavailableReason==="local"?"이 화면에는 로그인·저장 서버가 연결되어 있지 않아요. 가입을 시도해도 지금은 저장되지 않습니다.":unavailableReason==="auth"?"로그인 확인 서버와 연결되지 않았어요. 잠시 후 다시 확인하면 저장을 이어갈 수 있어요.":"저장 서비스를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요."}</p><p>{unavailableReason==="local"?"계정 저장에는 로그인·저장 서버 연결이 필요해요. 그동안 아래에서 결과를 보거나 Varda의 다른 기능을 체험해보세요.":"계산 결과는 그대로 남아 있어요. 연결이 돌아오면 가입·로그인 후 내용을 확인하고 저장합니다."}</p><div className={styles.actions}>{unavailableReason!=="local"?<button className={styles.secondary} type="button" disabled={loading} onClick={()=>void load()}>{loading?"연결 확인 중…":"다시 확인"}</button>:<a className={styles.primary} href="#product-tour">투자 랩·시뮬레이션 체험하기</a>}<Link className={styles.secondary} href="/try?mode=personal">{draft?"계산 결과로 돌아가기":"내 투자금 계산하기"}</Link></div></section>:null}
    {access==="guest"?<><h2 className={styles.joinHeading}>입력은 한 번, 계획은 계속.</h2><p className={styles.privacy}>로그인하면 이 계획을 내 계정에 보관할 수 있어요.</p><ol className={styles.joinSteps}><li>가입 또는 기존 계정으로 로그인</li><li>지금 입력한 계획을 확인하고 저장</li><li>다음 투자 때 불러와 금액만 변경</li></ol><div className={styles.actions}><Link className={styles.primary} prefetch={false} onClick={authIntent} href="/auth/sign-up">가입하고 저장 이어가기</Link><Link prefetch={false} onClick={authIntent} href="/auth/sign-in">기존 계정으로 로그인</Link><Link onClick={cancelAuthIntent} href="/try?mode=personal">가입하지 않고 결과로 돌아가기</Link></div></>:null}
    {access==="unlinked"?<><p className={styles.notice}>이메일·로그인 확인이 끝났습니다. 계획을 보관할 계정을 준비합니다. 계좌나 실제 자산은 만들지 않습니다.</p><label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>연결해야 할 기존 기록이 없으며 새 Varda 계정으로 시작합니다.</label><button className={styles.primary} disabled={!confirmed||pending} onClick={prepare}>{pending?"계정 준비 중…":"계정 준비하고 계획 확인"}</button><p><Link href="/auth/session?view=account">기존 기록 연결 확인</Link></p></>:null}
    
    {access==="ready"&&draft?<><label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>지금 로그인한 내 계정에 입력한 내용을 투자계획으로 저장합니다.</label><div className={styles.actions}><button className={styles.primary} disabled={!confirmed||pending} onClick={save}>{pending?"저장 중…":"확인한 계획 저장"}</button><Link href="/try?mode=personal">입력 수정</Link></div></>:null}
    {draft?<PlanResults input={draft.input}/>:null}
    {draft?<p className={styles.privacy}>이름·평가금액·목표 비중·투자금을 저장합니다. 실제 보유자산 등록은 별도이며, 저장한 계획은 여기서 삭제할 수 있어요.</p>:null}
    {selected?<section className={styles.saved}><h2>저장한 계획</h2><PlanResults input={selected.input}/><div className={styles.actions}><button className={styles.primary} onClick={()=>reuse(selected)}>다음 투자 계획 계산하기</button><button className={styles.secondary} onClick={()=>reuse(selected,true)}>이 자산을 실제 보유종목으로 등록</button></div><p className={styles.privacy}>이름과 계획 금액을 참고하고, 실제 종목과 수량을 확인하면 시세·변동 추적을 시작할 수 있습니다. 평가금액으로 수량이나 매입단가를 추정하지 않습니다. 계좌가 없다면 첫 계좌도 필요합니다.</p><Link href="/plans">실제 자산 등록은 나중에</Link></section>:null}
    {access==="ready"?<><div className={styles.actions}><button className={styles.secondary} disabled={pending} onClick={()=>void load()}>저장 목록 다시 확인</button><Link href="/try?mode=personal">다음 투자금 계산</Link></div>{!loading&&!plans.length&&!error?<p>아직 저장한 계획이 없습니다.</p>:null}{plans.map(plan=><article key={plan.id}><h2>{new Date(plan.createdAt).toLocaleString("ko-KR")} · {plan.input.rows.length}개 자산의 계획</h2><p className={styles.privacy}>{plan.input.rows.map(row=>row.name).join(" · ")}</p><div className={styles.actions}><button onClick={()=>setSelected(plan)}>계획 보기</button><button onClick={()=>reuse(plan)}>이 입력으로 다시 계산</button><details><summary>삭제</summary><p>계정에서 이 계획을 삭제합니다. 되돌릴 수 없습니다.</p><button disabled={pending} onClick={()=>void remove(plan.id)}>계획 삭제 확인</button></details></div></article>)}</>:null}
  </div><aside className={styles.planPreview}><ProductTour /></aside></section>;
}




