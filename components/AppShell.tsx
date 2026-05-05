import type { ReactNode } from "react";

type AppShellProps = {
  title: string;
  statusSlot?: ReactNode;
  children: ReactNode;
};

export default function AppShell({ title, statusSlot, children }: AppShellProps) {
  return (
    <main className="min-h-screen px-5 pb-[calc(7.75rem+env(safe-area-inset-bottom))] pt-[calc(2.5rem+env(safe-area-inset-top))]">
      <header className="page-header">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-[28px] font-semibold leading-none text-white">{title}</h1>
          {statusSlot ? <div className="shrink-0">{statusSlot}</div> : null}
        </div>
      </header>
      <div className="space-y-4">{children}</div>
    </main>
  );
}
