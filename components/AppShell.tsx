import type { ReactNode } from "react";

type AppShellProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  statusSlot?: ReactNode;
  children: ReactNode;
};

export default function AppShell({
  eyebrow = "X Master",
  title,
  description,
  statusSlot,
  children,
}: AppShellProps) {
  return (
    <main className="relative min-h-screen px-5 pb-[calc(7.75rem+env(safe-area-inset-bottom))] pt-[calc(2.75rem+env(safe-area-inset-top))]">
      <div className="pointer-events-none absolute inset-x-5 top-0 h-40 rounded-b-[2rem] bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.1),_transparent_70%)]" />

      <header className="page-header">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
              {eyebrow}
            </p>
            <h1 className="mt-3 text-[30px] font-semibold leading-none text-white">{title}</h1>
          </div>
          {statusSlot ? <div className="shrink-0">{statusSlot}</div> : null}
        </div>
        {description ? (
          <p className="mt-4 max-w-[28rem] text-[13px] leading-6 text-zinc-400">{description}</p>
        ) : null}
      </header>

      <div className="space-y-5">{children}</div>
    </main>
  );
}
