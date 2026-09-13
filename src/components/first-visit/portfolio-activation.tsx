"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ACTIVATION_STORAGE_KEY, activationIntent, bindCurrentActivationIntent, parseActivationIntent } from "@/lib/portfolio-activation";
import { QUICK_STORAGE_KEY, type QuickDraft } from "@/lib/quick-portfolio";
import { clearPlanReturnCookies, planReturnIntentCookies } from "@/lib/auth/plan-return";
import { trackFirstVisit } from "@/lib/first-visit-events";
import styles from "./quick-portfolio.module.css";

export function ContinueWithPortfolio({ draft, signedIn = false, preview = false }: { draft: QuickDraft; signedIn?: boolean; preview?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  return <><button type="button" disabled={preview} className={styles.primary} onClick={() => {
    if (preview) return;
    try {
      localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify(draft));
      localStorage.setItem(ACTIVATION_STORAGE_KEY, JSON.stringify(activationIntent(draft)));
      for (const cookie of planReturnIntentCookies("quick", location.protocol === "https:")) document.cookie = cookie;
      router.push("/portfolio/activate");
    } catch { setError("입력을 보관할 수 없어요. 브라우저의 사이트 저장 권한을 확인해 주세요."); }
  }}>{signedIn ? "저장하고 Home으로" : "가입하고 이 자산으로 시작"}</button>{error ? <p role="alert">{error}</p> : null}</>;
}

export function PortfolioActivation() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(true);
  const running = useRef(false);
  async function resume() {
    if (running.current) return;
    running.current = true; setPending(true); setError("");
    try {
      const saved = parseActivationIntent(localStorage.getItem(ACTIVATION_STORAGE_KEY), localStorage.getItem(QUICK_STORAGE_KEY));
      if (!saved) { setError("이어갈 입력이 없어요. 내 자산을 확인해 주세요."); return; }
      const status = await fetch("/api/portfolio-activation", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (status.status === 401) { location.replace("/auth/sign-up"); return; }
      const identity = await status.json();
      if (!status.ok || typeof identity.sessionKey !== "string") throw new Error();
      if (saved.intent.sessionKey && saved.intent.sessionKey !== identity.sessionKey) {
        setError("로그인한 계정이 바뀌었어요. 입력을 확인한 뒤 다시 저장해 주세요."); return;
      }
      saved.intent.sessionKey = identity.sessionKey;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!bindCurrentActivationIntent(localStorage, saved, identity.sessionKey)) {
          setError("다른 화면에서 입력이 바뀌었거나 저장이 취소됐어요. 최신 입력을 확인해 주세요."); return;
        }
        const response = await fetch("/api/portfolio-activation", { method: "POST", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: saved.draft, sessionKey: saved.intent.sessionKey }) });
        const data = await response.json();
        if (response.status === 202) {
          if (data.accountCreated === true) trackFirstVisit("signup_completed", identity.sessionKey);
          continue;
        }
        if (response.status === 401) { location.replace("/auth/sign-in"); return; }
        if (!response.ok) {
          setError(data.error === "account_changed" ? "로그인한 계정이 바뀌었어요. 입력을 확인한 뒤 다시 저장해 주세요." :
            data.error === "draft_limit" ? "저장 공간이 가득 찼어요. 내 기록에서 이전 입력을 삭제해 주세요." :
            data.error === "expired_input" ? "입력 보관 기간이 끝났어요. 내 자산을 다시 확인해 주세요." :
            "저장하지 못했어요. 입력은 그대로 있으니 다시 시도해 주세요."); return;
        }
        if (data.id !== saved.draft.id) throw new Error();
        trackFirstVisit("portfolio_saved", data.id);
        // Do not erase newer input from another tab. Cleanup failure after a
        // confirmed commit must not turn success into a failed save.
        try {
          const current = parseActivationIntent(localStorage.getItem(ACTIVATION_STORAGE_KEY), localStorage.getItem(QUICK_STORAGE_KEY));
          if (current?.draft.id === saved.draft.id) { localStorage.removeItem(QUICK_STORAGE_KEY); localStorage.removeItem(ACTIVATION_STORAGE_KEY);
            for (const cookie of clearPlanReturnCookies(location.protocol === "https:")) document.cookie = cookie;
          }
        } catch {}
        location.replace("/?welcome=1"); return;
      }
      throw new Error();
    } catch { setError("지금은 연결할 수 없어요. 잠시 후 다시 시도해 주세요."); }
    finally { running.current = false; setPending(false); }
  }
  useEffect(() => { const frame = requestAnimationFrame(() => { void resume(); }); return () => cancelAnimationFrame(frame); }, []);
  return <section className={styles.workspace} aria-busy={pending}>
    <h1>{pending ? "내 자산을 가져오고 있어요" : "잠시 확인해 주세요"}</h1>
    {pending ? <p role="status">곧 Home으로 이동합니다.</p> : <><p role="alert">{error}</p><div className={styles.actions}><button className={styles.primary} onClick={() => void resume()}>다시 시도</button><Link href="/try/analyze" onClick={() => {
      try { localStorage.removeItem(ACTIVATION_STORAGE_KEY); } catch {}
      for (const cookie of clearPlanReturnCookies(location.protocol === "https:")) document.cookie = cookie;
    }}>내 입력 확인</Link><Link href="/plans">내 기록</Link></div></>}
  </section>;
}
