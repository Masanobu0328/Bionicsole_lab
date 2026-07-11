'use client';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ja">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-12 font-sans text-white">
          <section className="w-full max-w-lg rounded-lg border border-white/10 bg-slate-900/80 p-8 shadow-2xl">
            <p className="mb-3 text-xs font-black uppercase tracking-[0.3em] text-teal-300/80">
              Bionic Sole Lab
            </p>
            <h1 className="text-2xl font-black tracking-tight">エラーが発生しました</h1>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              アプリケーションの読み込み中に問題が発生しました。ページを再読み込みしてください。
            </p>
            <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {error.message || '予期しないエラーが発生しました。'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-teal-500 px-4 py-2 text-sm font-bold text-slate-950 transition-colors hover:bg-teal-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-200"
            >
              再読み込み
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
