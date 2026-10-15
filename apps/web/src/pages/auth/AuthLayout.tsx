import type { ReactNode } from "react";

/** The frame of the signed-out pages. */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-start justify-center bg-stone-50 px-4 pt-24">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-lg font-semibold tracking-tight text-indigo-700">
          JobFilly
        </p>
        <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <h1 className="mb-5 text-xl font-semibold text-stone-900">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}
