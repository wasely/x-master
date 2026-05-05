"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Database, PenLine, Sparkles, Video } from "lucide-react";

const tabs = [
  { href: "/tiktok", label: "TikTok", Icon: Video },
  { href: "/database", label: "Database", Icon: Database },
  { href: "/drafts", label: "Drafts", Icon: PenLine },
  { href: "/generate", label: "Generate", Icon: Sparkles },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-1/2 z-50 w-full max-w-[430px] -translate-x-1/2 px-3 pb-[calc(0.85rem+env(safe-area-inset-bottom))]">
      <div className="surface-card grid grid-cols-4 px-2 py-2">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname === href || (href === "/tiktok" && pathname === "/");

          return (
            <Link
              key={href}
              href={href}
              className={
                active
                  ? "flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl bg-white/[0.06]"
                  : "flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl"
              }
            >
              <Icon
                size={20}
                strokeWidth={active ? 2.35 : 1.8}
                className={active ? "text-white" : "text-zinc-600"}
              />
              <span className={active ? "text-[10px] font-medium text-zinc-200" : "text-[10px] text-zinc-600"}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
