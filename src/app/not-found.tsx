import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-[var(--paper)] px-5 py-8 text-[var(--ink)] sm:px-8">
      <div className="mx-auto flex min-h-[80vh] w-full max-w-[1180px] flex-col justify-center border-y border-[var(--line)] py-16">
        <p className="text-xs font-semibold text-[var(--brand)]">404 / NOT FOUND</p>
        <h1 className="mt-5 max-w-3xl text-3xl font-semibold sm:text-5xl">
          요청한 화면을 찾을 수 없습니다.
        </h1>
        <p className="mt-5 max-w-xl text-sm leading-7 text-[var(--muted)]">
          주소가 바뀌었거나 현재 계정에서 접근할 수 없는 화면입니다.
        </p>
        <Link className="varda-action mt-8 w-fit" href="/">
          <ArrowLeft size={16} aria-hidden="true" /> 포트폴리오로 돌아가기
        </Link>
      </div>
    </main>
  );
}
