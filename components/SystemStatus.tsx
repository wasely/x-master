"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Database, Loader2, Sparkles } from "lucide-react";

type HealthResponse = {
  ok: boolean;
  count?: number;
  rejectionCount?: number;
  error?: string;
};

type SystemStatusProps = {
  compact?: boolean;
  showCounts?: boolean;
  refreshTrigger?: number;
};

function formatCount(value?: number) {
  return typeof value === "number" ? value.toLocaleString() : "--";
}

export default function SystemStatus({
  compact = false,
  showCounts = false,
  refreshTrigger,
}: SystemStatusProps) {
  const [status, setStatus] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      try {
        const response = await fetch("/api/chroma/health", { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as HealthResponse | null;

        if (cancelled) return;

        setStatus(
          data ?? {
            ok: false,
            error: "Could not reach the library.",
          },
        );
      } catch {
        if (cancelled) return;

        setStatus({
          ok: false,
          error: "Could not reach the library.",
        });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadStatus();
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 8000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refreshTrigger]);

  if (compact) {
    return (
      <div className="status-pill">
        {loading ? (
          <Loader2 size={14} className="animate-spin text-zinc-500" />
        ) : status?.ok ? (
          <Sparkles size={14} className="text-emerald-300" />
        ) : (
          <AlertCircle size={14} className="text-amber-300" />
        )}
        <span className="text-[11px] font-medium text-zinc-200">
          {loading ? "Checking" : status?.ok ? "Library ready" : "Library offline"}
        </span>
      </div>
    );
  }

  return (
    <section className="surface-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="section-label">System</p>
          <p className="mt-3 text-[17px] font-medium text-white">
            {loading ? "Checking the library" : status?.ok ? "Library is online" : "Library needs attention"}
          </p>
          <p className="mt-2 text-[13px] leading-6 text-zinc-400">
            {loading
              ? "Verifying the local vector library and saved examples."
              : status?.ok
                ? "Saved voice examples are available for search and generation."
                : status?.error ?? "The library is not reachable right now."}
          </p>
        </div>
        <div className={status?.ok ? "status-pill status-pill-online" : "status-pill status-pill-warn"}>
          {loading ? (
            <Loader2 size={14} className="animate-spin text-zinc-500" />
          ) : status?.ok ? (
            <Sparkles size={14} className="text-emerald-300" />
          ) : (
            <AlertCircle size={14} className="text-amber-300" />
          )}
          <span className="text-[11px] font-medium text-zinc-200">
            {loading ? "Checking" : status?.ok ? "Online" : "Offline"}
          </span>
        </div>
      </div>

      {showCounts ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-2 text-zinc-500">
              <Database size={14} />
              <span className="text-[11px] uppercase tracking-[0.18em]">Saved</span>
            </div>
            <p className="mt-3 text-[22px] font-semibold text-white">{formatCount(status?.count)}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-2 text-zinc-500">
              <AlertCircle size={14} />
              <span className="text-[11px] uppercase tracking-[0.18em]">Rejected</span>
            </div>
            <p className="mt-3 text-[22px] font-semibold text-white">
              {formatCount(status?.rejectionCount)}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
