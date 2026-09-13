"use client";
import Link from "next/link";
import { clearPlanReturnCookies } from "@/lib/auth/plan-return";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createQuickDraft, parseQuickDraft, QUICK_STORAGE_KEY, type QuickDraft, type QuickInput } from "@/lib/quick-portfolio";
import { ContinueWithPortfolio } from "./portfolio-activation";
import { QuickResults } from "./quick-results";
import styles from "./quick-portfolio.module.css";
type Saved = { id: string; input: QuickInput; createdAt: string };
export function QuickPortfolioLibrary({ onVisibility }: { localAuthDisabled?: boolean; onVisibility?: (visible: boolean) => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<QuickDraft | null>(null), [saved, setSaved] = useState<Saved[]>([]), [selected, setSelected] = useState<Saved | null>(null);
  const [access, setAccess] = useState<"loading" | "guest" | "ready" | "unlinked" | "unavailable">("loading");
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [pending, setPending] = useState(false); const lock = useRef(false);
  const load = useCallback(async () => { try { const response = await fetch("/api/portfolio-drafts", { cache: "no-store" });
    if (response.status === 401 || response.status === 409) { setAccess(response.status === 401 ? "guest" : "unlinked"); setSaved([]); setSelected(null); return; }
    const data = await response.json(); if (!response.ok) { setAccess("unavailable"); setSaved([]); setSelected(null); return; }
    setSaved(data.drafts); setAccess("ready");
  } catch { setAccess("unavailable"); setSaved([]); setSelected(null); } }, []);
  useEffect(() => { const frame = requestAnimationFrame(() => { try { const restored = parseQuickDraft(localStorage.getItem(QUICK_STORAGE_KEY)); setDraft(restored); if (!restored) localStorage.removeItem(QUICK_STORAGE_KEY); } catch { setError("브라우저의 임시 자산 입력을 복원하지 못했습니다."); } void load(); }); return () => cancelAnimationFrame(frame); }, [load]);
  useEffect(() => { if (!draft) return; const timer = setTimeout(() => { try { const current = parseQuickDraft(localStorage.getItem(QUICK_STORAGE_KEY)); if (!current || current.id === draft.id) localStorage.removeItem(QUICK_STORAGE_KEY); } catch {} setDraft(null); setMessage("임시 자산 입력의 24시간 보관 기간이 끝났습니다."); }, Math.max(0, draft.expiresAt - Date.now())); return () => clearTimeout(timer); }, [draft]);
  async function remove(id: string) { if (lock.current) return; lock.current = true; setPending(true); setError("");
    try { const response = await fetch("/api/portfolio-drafts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); const data = await response.json(); if (!response.ok && !(response.status === 404 && data.error === "draft_not_found")) throw new Error(); if (selected?.id === id) setSelected(null); setMessage("간편 포트폴리오를 계정에서 삭제했습니다."); await load(); } catch { setError("삭제하지 못했습니다. 다시 시도해 주세요."); } finally { lock.current = false; setPending(false); }
  }
  function reuse(value: Saved, holdings = false) { try { localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify({ ...createQuickDraft(value.input), id: value.id })); router.push(holdings ? "/portfolio/holdings/new?from=quick" : "/try/analyze"); } catch { setError("브라우저에 입력을 옮기지 못했습니다. 사이트 데이터 저장을 허용해 주세요."); } }
  const visible = Boolean(draft || saved.length || selected || message || error);
  useEffect(() => { onVisibility?.(visible); }, [onVisibility, visible]);
  if (!visible) return null;
  return <section className={styles.saved} aria-label="간편 포트폴리오 저장"><p className={styles.eyebrow}>MY PORTFOLIO</p><h2>입력은 한 번, 내 포트폴리오는 계속.</h2>
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {draft && access === "loading" ? <p role="status">저장 연결을 확인하고 있어요.</p> : null}
    {draft && (access === "guest" || access === "ready" || access === "unlinked") ? <div className={styles.actions}><ContinueWithPortfolio draft={draft} signedIn={access !== "guest"} /></div> : null}
    {draft && access === "unavailable" ? <div className={styles.saveNotice}><p>지금은 저장할 수 없어요. 입력은 그대로 남아 있습니다.</p><button type="button" onClick={() => void load()}>다시 확인</button></div> : null}
    {draft ? <><QuickResults input={draft.input} /><div className={styles.actions}><Link href="/try/analyze" onClick={() => { for (const cookie of clearPlanReturnCookies(location.protocol === "https:")) document.cookie = cookie; }}>내 입력으로 돌아가기</Link></div></> : null}
    {selected ? <><h3>저장한 간편 포트폴리오</h3><QuickResults input={selected.input} /><div className={styles.actions}><button className={styles.primary} onClick={() => reuse(selected)}>금액을 바꿔 다시 확인</button><button onClick={() => reuse(selected, true)}>수량을 추가해 실제 자산으로 등록</button><Link href="/demo/simulation">시뮬레이션은 샘플로 먼저 보기</Link></div></> : null}
    {access === "ready" && saved.length ? <><h3>내 간편 포트폴리오</h3>{saved.map(value => <article key={value.id}><p>{value.input.rows.map(row => row.name).join(" · ")}</p><p className={styles.note}>{new Date(value.createdAt).toLocaleDateString("ko-KR")} 저장 · {value.input.rows.length}개 자산</p><div className={styles.actions}><button onClick={() => setSelected(value)}>구성 보기</button><button onClick={() => reuse(value)}>금액 수정</button><details><summary>삭제</summary><p className={styles.note}>계정에서 이 간편 포트폴리오를 삭제합니다. 되돌릴 수 없습니다.</p><button disabled={pending} onClick={() => void remove(value.id)}>간편 포트폴리오 삭제 확인</button></details></div></article>)}</> : null}
  </section>;
}
