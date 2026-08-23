"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function PortfolioRefreshButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function refresh() {
    startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      aria-label="저장된 최신 데이터 다시 읽기"
      className={
        compact
          ? "grid h-9 w-9 place-items-center text-xl text-[#252824] transition-colors hover:text-[#347e62] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62] disabled:opacity-40"
          : "inline-flex min-h-11 items-center gap-3 px-1 text-sm font-medium text-[#252824] transition-colors hover:text-[#347e62] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62] disabled:opacity-40"
      }
      disabled={pending}
      onClick={refresh}
      title="가격 공급자를 호출하지 않고 저장된 최신 데이터를 다시 읽습니다"
    >
      <span aria-hidden="true" className={pending ? "animate-spin" : undefined}>
        ↻
      </span>
      {compact ? null : <span>{pending ? "불러오는 중" : "화면 새로고침"}</span>}
    </button>
  );
}
