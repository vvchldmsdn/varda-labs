"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen bg-[var(--paper)] px-5 py-8 text-[var(--ink)] sm:px-8">
      <div className="mx-auto flex min-h-[70vh] w-full max-w-[1180px] flex-col justify-between border-y border-[var(--line)] py-8 sm:py-12">
        <p className="text-xs font-semibold text-[var(--muted)]">VARDA-LABS / RECOVERY</p>
        <section className="max-w-2xl py-20" aria-labelledby="app-error-title">
          <p className="text-xs text-[var(--brand)]">요청을 끝까지 처리하지 못했습니다</p>
          <h1 id="app-error-title" className="mt-4 text-3xl font-semibold sm:text-5xl">
            이 화면만 다시 불러옵니다.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-7 text-[var(--muted)]">
            저장된 포트폴리오 데이터는 변경하지 않았습니다. 같은 문제가 반복되면
            아래 확인 코드를 함께 알려 주세요.
          </p>
          {error.digest ? (
            <p className="mt-4 font-mono text-xs text-[var(--faint)]">
              확인 코드 {error.digest}
            </p>
          ) : null}
          <div className="mt-8 flex flex-wrap gap-3">
            <button className="varda-action" onClick={reset} type="button">
              <RotateCcw size={16} aria-hidden="true" /> 다시 시도
            </button>
            <Link className="varda-action" href="/">
              홈으로
            </Link>
          </div>
        </section>
        <p className="text-xs text-[var(--faint)]">현재 요청 범위 밖의 화면은 계속 사용할 수 있습니다.</p>
      </div>
    </main>
  );
}
