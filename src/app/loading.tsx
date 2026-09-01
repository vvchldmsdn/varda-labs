export default function AppLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="화면을 불러오는 중"
      className="min-h-screen bg-[var(--paper)] px-5 py-8 text-[var(--ink)] sm:px-8"
    >
      <div className="mx-auto w-full max-w-[1540px] animate-pulse motion-reduce:animate-none">
        <div className="flex min-h-14 items-center justify-between border-b border-[var(--line)]">
          <div className="h-4 w-32 bg-[var(--wash)]" />
          <div className="h-4 w-20 bg-[var(--wash)]" />
        </div>
        <section className="grid min-h-[70vh] content-center gap-8 border-b border-[var(--line)] py-16">
          <div className="h-3 w-28 bg-[var(--brand-soft)]" />
          <div className="h-12 w-full max-w-3xl bg-[var(--wash)] sm:h-16" />
          <div className="h-4 w-full max-w-xl bg-[var(--wash)]" />
          <div className="h-64 w-full border-y border-[var(--line)] bg-[var(--surface)]" />
        </section>
      </div>
    </main>
  );
}
