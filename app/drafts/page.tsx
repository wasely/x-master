"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Clipboard, ExternalLink, Loader2, PenLine, Trash2 } from "lucide-react";
import AppShell from "@/components/AppShell";

type Draft = {
  id: string;
  text: string;
  sourceUrl?: string;
  authorName?: string;
  myDraft: string;
  createdAt: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function DraftCard({
  draft,
  onSave,
  onDelete,
}: {
  draft: Draft;
  onSave: (id: string, myDraft: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [myDraft, setMyDraft] = useState(draft.myDraft);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const dirty = myDraft !== draft.myDraft;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    autoResize();
  }, [myDraft]);

  async function handleSave() {
    setSaving(true);
    await onSave(draft.id, myDraft);
    setSaving(false);
  }

  async function handleDelete() {
    setDeleting(true);
    await onDelete(draft.id);
  }

  async function handleCopy() {
    const text = myDraft.trim() || draft.text;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="surface-card space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {draft.authorName && (
            <span className="text-xs font-medium text-zinc-400">@{draft.authorName}</span>
          )}
          <span className="text-[10px] text-zinc-600">{formatDate(draft.createdAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          {draft.sourceUrl && (
            <a
              href={draft.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-600 hover:text-zinc-400"
            >
              <ExternalLink size={13} />
            </a>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-zinc-600 hover:text-red-400 disabled:opacity-40"
          >
            {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          </button>
        </div>
      </div>

      <p className="rounded-xl bg-white/[0.03] px-3 py-2.5 text-xs leading-relaxed text-zinc-500">
        {draft.text}
      </p>

      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          <PenLine size={10} />
          My draft
        </label>
        <textarea
          ref={textareaRef}
          value={myDraft}
          onChange={(e) => {
            setMyDraft(e.target.value);
          }}
          placeholder="Write your version here…"
          className="w-full resize-none rounded-xl bg-white/[0.05] px-3 py-2.5 text-sm leading-relaxed text-white placeholder-zinc-700 outline-none focus:ring-1 focus:ring-white/10"
          rows={3}
          style={{ minHeight: "4.5rem" }}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-zinc-700">{myDraft.length} chars</span>
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-xl bg-white/[0.07] px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.1] disabled:opacity-40"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : null}
              Save
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-zinc-200"
          >
            {copied ? <Check size={12} /> : <Clipboard size={12} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/drafts");
    if (res.ok) {
      const data = await res.json();
      setDrafts(data.drafts ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(id: string, myDraft: string) {
    const res = await fetch("/api/drafts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, myDraft }),
    });
    if (res.ok) {
      const data = await res.json();
      setDrafts((prev) => prev.map((d) => (d.id === id ? data.draft : d)));
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/drafts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    }
  }

  return (
    <AppShell
      title="Drafts"
      statusSlot={
        !loading && drafts.length > 0 ? (
          <span className="status-pill">
            <span className="text-[11px] font-medium text-zinc-200">
              {drafts.length} {drafts.length === 1 ? "draft" : "drafts"}
            </span>
          </span>
        ) : undefined
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin text-zinc-600" />
        </div>
      ) : drafts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <PenLine size={28} className="text-zinc-700" />
          <p className="text-sm text-zinc-500">No drafts yet.</p>
          <p className="text-xs text-zinc-700">
            Save generated posts from the TikTok or Generate tabs,
            or right-click any tweet on X and choose{" "}
            <span className="text-zinc-500">Save as my draft</span>.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}
