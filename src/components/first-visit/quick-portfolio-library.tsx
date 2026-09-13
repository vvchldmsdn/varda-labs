"use client";
import Link from "next/link";
import { clearPlanReturnCookies, planReturnIntentCookies } from "@/lib/auth/plan-return";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { preparePlanAccount } from "@/app/plans/actions";
import { SELF_SERVICE_TENANT_ONBOARDING_POLICY } from "@/lib/auth/self-service-tenant-onboarding";
import { createQuickDraft, parseQuickDraft, QUICK_STORAGE_KEY, type QuickDraft, type QuickInput } from "@/lib/quick-portfolio";
import { trackFirstVisit } from "@/lib/first-visit-events";
import { QuickResults } from "./quick-results";
import styles from "./quick-portfolio.module.css";
type Saved = { id: string; input: QuickInput; createdAt: string };
export function QuickPortfolioLibrary({ localAuthDisabled = false, onVisibility }: { localAuthDisabled?: boolean; onVisibility?: (visible: boolean) => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<QuickDraft | null>(null), [saved, setSaved] = useState<Saved[]>([]), [selected, setSelected] = useState<Saved | null>(null);
  const [access, setAccess] = useState<"loading" | "guest" | "ready" | "unlinked" | "unavailable">("loading");
  const [failure, setFailure] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [pending, setPending] = useState(false), [confirmed, setConfirmed] = useState(false); const lock = useRef(false);
  const load = useCallback(async () => { try { const response = await fetch("/api/portfolio-drafts", { cache: "no-store" });
    if (response.status === 401 || response.status === 409) { setAccess(response.status === 401 ? "guest" : "unlinked"); setSaved([]); setSelected(null); return; }
    const data = await response.json(); if (!response.ok) { setFailure(data.error); setAccess("unavailable"); setSaved([]); setSelected(null); return; }
    setSaved(data.drafts); setAccess("ready");
  } catch { setAccess("unavailable"); setFailure("service_unavailable"); setSaved([]); setSelected(null); } }, []);
  useEffect(() => { const frame = requestAnimationFrame(() => { try { const restored = parseQuickDraft(localStorage.getItem(QUICK_STORAGE_KEY)); setDraft(restored); if (!restored) localStorage.removeItem(QUICK_STORAGE_KEY); } catch { setError("브라우저의 임시 자산 입력을 복원하지 못했습니다."); } void load(); }); return () => cancelAnimationFrame(frame); }, [load]);
  useEffect(() => { if (!draft) return; const timer = setTimeout(() => { try { const current = parseQuickDraft(localStorage.getItem(QUICK_STORAGE_KEY)); if (!current || current.id === draft.id) localStorage.removeItem(QUICK_STORAGE_KEY); } catch {} setDraft(null); setMessage("임시 자산 입력의 24시간 보관 기간이 끝났습니다."); }, Math.max(0, draft.expiresAt - Date.now())); return () => clearTimeout(timer); }, [draft]);
  async function save() { if (lock.current || !draft || !confirmed || draft.expiresAt <= Date.now()) return; lock.current = true; setPending(true); setError("");
    try { const response = await fetch("/api/portfolio-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draft.id, input: draft.input }) }); const data = await response.json();
      if (!response.ok) { if (response.status === 401) { setAccess("guest"); setSaved([]); setSelected(null); } if (data.error === "identity_unlinked") setAccess("unlinked"); setError(data.error === "draft_limit" ? "간편 포트폴리오는 최대 50개까지 보관할 수 있어요. 이전 기록을 삭제한 뒤 다시 저장해 주세요." : "저장하지 못했습니다. 입력은 유지되며 다시 시도해도 중복 저장하지 않습니다."); return; }
      try { const current = parseQuickDraft(localStorage.getItem(QUICK_STORAGE_KEY)); if (current?.id === draft.id) localStorage.removeItem(QUICK_STORAGE_KEY); } catch {}
      trackFirstVisit("portfolio_saved", data.id);
      setSelected({ id: data.id, input: draft.input, createdAt: new Date().toISOString() }); setDraft(null); setConfirmed(false); setMessage("간편 포트폴리오를 저장했습니다. 실제 보유자산이나 거래는 만들지 않았습니다."); for (const cookie of clearPlanReturnCookies(location.protocol === "https:")) document.cookie = cookie; await load();
    } catch { setError("저장 연결이 끊겼습니다. 입력은 유지됩니다. 다시 시도해 주세요."); } finally { lock.current = false; setPending(false); }
  }
  async function prepare() { if (lock.current || !confirmed) return; lock.current = true; setPending(true); setError("");
    try { const form = new FormData(); form.set("confirmation", SELF_SERVICE_TENANT_ONBOARDING_POLICY.confirmationValue); const result = await preparePlanAccount(form); if (result.status === "success" || result.status === "already_ready") { if (result.status === "success") trackFirstVisit("signup_completed"); setConfirmed(false); await load(); } else setError("계정 연결을 완료하지 못했습니다. 기존 기록 연결을 확인하거나 다시 시도해 주세요."); } catch { setError("계정 연결을 확인하지 못했습니다. 입력은 유지됩니다."); } finally { lock.current = false; setPending(false); }
  }
  async function remove(id: string) { if (lock.current) return; lock.current = true; setPending(true); setError("");
    try { const response = await fetch("/api/portfolio-drafts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); const data = await response.json(); if (!response.ok && !(response.status === 404 && data.error === "draft_not_found")) throw new Error(); if (selected?.id === id) setSelected(null); setMessage("간편 포트폴리오를 계정에서 삭제했습니다."); await load(); } catch { setError("삭제하지 못했습니다. 다시 시도해 주세요."); } finally { lock.current = false; setPending(false); }
  }
  function reuse(value: Saved, holdings = false) { try { localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify(createQuickDraft(value.input))); router.push(holdings ? "/portfolio/holdings/new?from=quick" : "/try/analyze"); } catch { setError("브라우저에 입력을 옮기지 못했습니다. 사이트 데이터 저장을 허용해 주세요."); } }
  function authIntent() { for (const cookie of planReturnIntentCookies("quick", location.protocol === "https:")) document.cookie = cookie; }
  const visible = Boolean(draft || saved.length || selected || message || error);
  useEffect(() => { onVisibility?.(visible); }, [onVisibility, visible]);
  if (!visible) return null;
  const local = localAuthDisabled && failure === "auth_provider_unavailable";
  return <section className={styles.saved} aria-label="간편 포트폴리오 저장"><p className={styles.eyebrow}>MY PORTFOLIO</p><h2>입력은 한 번, 내 포트폴리오는 계속.</h2><p className={styles.note}>이름과 대략적인 금액을 저장하면 다음에는 달라진 금액만 고칠 수 있어요. 실제 수량·매입가·거래 내역은 별도입니다.</p>
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {draft && access === "loading" ? <p role="status">저장 연결을 확인하고 있어요.</p> : null}
    {draft && access === "guest" ? <div className={styles.saveNotice}><p>가입 또는 로그인 후 입력을 확인하고 내 계정에 저장하세요.</p><div className={styles.actions}><Link href="/auth/sign-up" prefetch={false} onClick={authIntent} className={styles.primary}>가입하고 포트폴리오 저장</Link><Link href="/auth/sign-in" prefetch={false} onClick={authIntent}>로그인하고 이어가기</Link></div></div> : null}
    {draft && access === "unavailable" ? <div className={styles.saveNotice}><h3>{local ? "현재는 로컬 체험 화면이에요." : "지금은 저장 연결을 확인할 수 없어요."}</h3><p className={styles.note}>{local ? "이 환경에는 로그인·저장 서버가 연결되어 있지 않습니다. 결과는 계속 볼 수 있어요." : failure === "auth_provider_unavailable" ? "로그인 확인 서버가 잠시 응답하지 않습니다. 연결이 돌아오면 입력을 확인하고 저장할 수 있어요." : "저장 서비스가 잠시 응답하지 않습니다. 입력은 이 브라우저에서 계속 확인할 수 있어요."}</p>{!local ? <div className={styles.actions}><button type="button" onClick={() => void load()}>다시 확인</button></div> : null}</div> : null}
    {draft && access === "unlinked" ? <><p>로그인은 확인됐습니다. 간편 포트폴리오를 보관할 Varda 계정을 준비해요.</p><label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />연결해야 할 기존 기록이 없으며 새 Varda 계정으로 시작합니다.</label><div className={styles.actions}><button className={styles.primary} disabled={!confirmed || pending} onClick={() => void prepare()}>계정 준비하고 입력 확인</button><Link href="/auth/session?view=account">기존 기록 연결 확인</Link></div></> : null}
    {draft && access === "ready" ? <><label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />지금 로그인한 내 계정에 아래 이름과 금액을 간편 포트폴리오로 저장합니다.</label><div className={styles.actions}><button className={styles.primary} disabled={!confirmed || pending} onClick={() => void save()}>{pending ? "저장 중…" : "확인한 포트폴리오 저장"}</button></div></> : null}
    {draft ? <><QuickResults input={draft.input} /><div className={styles.actions}><Link href="/try/analyze" onClick={() => { for (const cookie of clearPlanReturnCookies(location.protocol === "https:")) document.cookie = cookie; }}>가입하지 않고 입력·결과로 돌아가기</Link></div></> : null}
    {selected ? <><h3>저장한 간편 포트폴리오</h3><QuickResults input={selected.input} /><div className={styles.actions}><button className={styles.primary} onClick={() => reuse(selected)}>금액을 바꿔 다시 확인</button><button onClick={() => reuse(selected, true)}>수량을 추가해 실제 자산으로 등록</button><Link href="/demo/simulation">시뮬레이션은 샘플로 먼저 보기</Link></div><p className={styles.note}>실제 시세 추적에는 계좌·정확한 종목·수량이 필요해요. 금액으로 수량이나 매입단가를 추정하지 않습니다. 자산 등록은 나중에 해도 됩니다.</p></> : null}
    {access === "ready" && saved.length ? <><h3>내 간편 포트폴리오</h3>{saved.map(value => <article key={value.id}><p>{value.input.rows.map(row => row.name).join(" · ")}</p><p className={styles.note}>{new Date(value.createdAt).toLocaleDateString("ko-KR")} 저장 · {value.input.rows.length}개 자산</p><div className={styles.actions}><button onClick={() => setSelected(value)}>구성 보기</button><button onClick={() => reuse(value)}>금액 수정</button><details><summary>삭제</summary><p className={styles.note}>계정에서 이 간편 포트폴리오를 삭제합니다. 되돌릴 수 없습니다.</p><button disabled={pending} onClick={() => void remove(value.id)}>간편 포트폴리오 삭제 확인</button></details></div></article>)}</> : null}
  </section>;
}
