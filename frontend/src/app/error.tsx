'use client';

import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-12 text-white">
      <section className="w-full max-w-lg rounded-lg border border-white/10 bg-slate-900/80 p-8 shadow-2xl">
        <p className="mb-3 text-xs font-black uppercase tracking-[0.3em] text-teal-300/80">
          Bionic Sole Lab
        </p>
        <h1 className="text-2xl font-black tracking-tight">エラーが発生しました</h1>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          処理中に問題が発生しました。再試行しても解決しない場合は、ページを更新してからもう一度お試しください。
        </p>
        <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error.message || '予期しないエラーが発生しました。'}
        </p>
        <Button
          type="button"
          onClick={reset}
          className="mt-6 h-11 bg-teal-500 font-bold text-slate-950 hover:bg-teal-400"
        >
          再試行
        </Button>
      </section>
    </main>
  );
}
