"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="ko">
      <body>
        <main className="min-h-screen bg-[#f6f4ef] px-5 py-8 text-[#191b20]">
          <section className="mx-auto flex min-h-[80vh] w-full max-w-[900px] flex-col justify-center border-y border-[#dcdcd7] py-16">
            <p className="text-xs font-semibold text-[#696c72]">VARDA-LABS / SYSTEM</p>
            <h1 className="mt-5 text-3xl font-semibold sm:text-5xl">화면을 다시 준비하겠습니다.</h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-[#696c72]">
              공통 화면을 불러오는 중 문제가 발생했습니다. 저장 데이터는 변경하지
              않았습니다.
            </p>
            <button
              className="mt-8 min-h-10 w-fit border border-[#315bb5] bg-[#315bb5] px-4 text-sm font-semibold text-white"
              onClick={reset}
              type="button"
            >
              다시 시도
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
