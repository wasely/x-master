"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clipboard,
  Database,
  ExternalLink,
  Loader2,
  Search,
  SlidersHorizontal,
  ThumbsDown,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import SystemStatus from "@/components/SystemStatus";
import { LENGTH_OPTIONS, TONE_OPTIONS } from "@/lib/content-options";

type ToneValue = (typeof TONE_OPTIONS)[number]["id"] | "auto";
type LengthValue = (typeof LENGTH_OPTIONS)[number]["id"] | "auto";

type TweetExample = {
  id: string;
  text: string;
  sourceType: "tweet_url" | "manual";
  sourceUrl?: string;
  authorName?: string;
  notes?: string;
  tags: string[];
  tone?: string;
  category?: string;
  length?: string;
  createdAt?: string;
};

type TweetsResponse = {
  examples?: TweetExample[];
  error?: string;
};

const ARTICLE_LENGTHS = new Set(["article"]);

function prettyMeta(value?: string) {
  if (!value) return "";
  return (
    LENGTH_OPTIONS.find((o) => o.id === value)?.label ??
    TONE_OPTIONS.find((o) => o.id === value)?.label ??
    value
  );
}

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function extractUsername(sourceUrl?: string) {
  if (!sourceUrl) return null;
  return sourceUrl.match(/(?:twitter|x)\.com\/([^/]+)\/status/i)?.[1] ?? null;
}

function avatarColor(name: string) {
  const palette = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#f97316"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function SelectField<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  selected: T;
  onChange: (value: T) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="section-label">{label}</span>
      <div className="field-shell mt-3 px-3">
        <select
          value={selected}
          onChange={(e) => onChange(e.target.value as T)}
          className="h-11 w-full bg-transparent text-[14px] text-zinc-100 outline-none"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id} className="bg-[#090909] text-zinc-100">
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function Avatar({ username, name, color }: { username: string | null; name: string; color: string }) {
  const [failed, setFailed] = useState(false);
  const initial = name[0]?.toUpperCase() ?? "?";

  if (username && !failed) {
    return (
      <img
        src={`https://unavatar.io/twitter/${username}`}
        alt={name}
        onError={() => setFailed(true)}
        className="mt-0.5 h-9 w-9 shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <div
      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
      style={{ background: color }}
    >
      {initial}
    </div>
  );
}

function TweetCard({
  example,
  onDelete,
  onCopy,
  copied,
}: {
  example: TweetExample;
  onDelete: (id: string) => void;
  onCopy: (id: string, text: string) => void;
  copied: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const username = extractUsername(example.sourceUrl);
  const name = example.authorName ?? username ?? "?";
  const color = avatarColor(name);
  const isLong = example.text.length > 220;
  const metaTags = [...new Set(
    [example.length, example.tone, example.category, ...example.tags].filter((t): t is string => !!t)
  )].slice(0, 5);

  return (
    <article className="py-5">
      <div className="flex gap-3">
        <Avatar username={username} name={name} color={color} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {example.authorName ? (
                <span className="text-[14px] font-semibold text-white">{example.authorName}</span>
              ) : null}
              {username ? (
                <span className="ml-1.5 text-[13px] text-zinc-500">@{username}</span>
              ) : null}
              {example.createdAt ? (
                <span className="ml-1.5 text-[12px] text-zinc-600">· {formatDate(example.createdAt)}</span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDelete(example.id)}
              className="shrink-0 rounded-full p-1.5 text-zinc-700 hover:text-red-400"
              aria-label="Delete"
            >
              <Trash2 size={15} />
            </button>
          </div>

          <p
            className={`mt-2 whitespace-pre-wrap text-[15px] leading-6 text-zinc-200 ${
              !expanded && isLong ? "line-clamp-4" : ""
            }`}
          >
            {example.text}
          </p>
          {isLong ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 flex items-center gap-1 text-[13px] text-zinc-500 hover:text-zinc-300"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}

          {example.notes ? (
            <p className="mt-2 text-[13px] leading-5 text-zinc-500">{example.notes}</p>
          ) : null}

          {metaTags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {metaTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/[0.06] px-2.5 py-1 text-[11px] uppercase tracking-[0.1em] text-zinc-500"
                >
                  {prettyMeta(tag)}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onCopy(example.id, example.text)}
              className="ghost-button"
            >
              {copied ? <Check size={14} /> : <Clipboard size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
            {example.sourceUrl ? (
              <Link href={example.sourceUrl} target="_blank" className="ghost-button">
                <ExternalLink size={14} />
                View on X
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-10 text-center">
      <p className="text-[14px] text-zinc-500">No {label} saved yet.</p>
    </div>
  );
}

function RejectionCard({
  example,
  onDelete,
  onCopy,
  copied,
}: {
  example: TweetExample;
  onDelete: (id: string) => void;
  onCopy: (id: string, text: string) => void;
  copied: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = example.text.length > 220;
  const metaTags = [example.length, example.tone].filter((t): t is string => !!t);

  return (
    <article className="py-4">
      <div className="flex gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-500/20 bg-red-500/[0.08]">
          <ThumbsDown size={13} className="text-red-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={`whitespace-pre-wrap text-[14px] leading-6 text-zinc-400 ${
              !expanded && isLong ? "line-clamp-3" : ""
            }`}
          >
            {example.text}
          </p>
          {isLong ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 flex items-center gap-1 text-[12px] text-zinc-600 hover:text-zinc-400"
            >
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
          {metaTags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {metaTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/[0.06] px-2 py-0.5 text-[11px] uppercase tracking-[0.1em] text-zinc-600"
                >
                  {prettyMeta(tag)}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onCopy(example.id, example.text)}
              className="ghost-button"
            >
              {copied ? <Check size={13} /> : <Clipboard size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => onDelete(example.id)}
              className="ghost-button text-zinc-600 hover:text-red-400"
            >
              <Trash2 size={13} />
              Remove
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function DatabasePage() {
  const [examples, setExamples] = useState<TweetExample[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [rejections, setRejections] = useState<TweetExample[]>([]);
  const [rejectionLoading, setRejectionLoading] = useState(false);
  const [rejectionError, setRejectionError] = useState("");

  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [rejectedCount, setRejectedCount] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"saved" | "rejected">("saved");

  const [input, setInput] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [tone, setTone] = useState<ToneValue>("auto");
  const [length, setLength] = useState<LengthValue>("auto");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const deferredSearch = useDeferredValue(search);
  const countRequestRef = useRef(0);

  const filterOptions = useMemo(() => {
    const values = new Set<string>();
    examples.forEach((ex) => {
      if (ex.length) values.add(ex.length);
      if (ex.tone) values.add(ex.tone);
      if (ex.category) values.add(ex.category);
      ex.tags.forEach((t) => values.add(t));
    });
    return ["All", ...Array.from(values).sort((a, b) => prettyMeta(a).localeCompare(prettyMeta(b)))];
  }, [examples]);

  const toneOptions = useMemo<{ id: ToneValue; label: string }[]>(
    () => [{ id: "auto", label: "Auto" }, ...TONE_OPTIONS],
    [],
  );
  const lengthOptions = useMemo<{ id: LengthValue; label: string }[]>(
    () => [{ id: "auto", label: "Auto" }, ...LENGTH_OPTIONS.map(({ id, label }) => ({ id, label }))],
    [],
  );

  const tweets = useMemo(
    () => examples.filter((ex) => !ARTICLE_LENGTHS.has(ex.length ?? "")),
    [examples],
  );
  const articles = useMemo(
    () => examples.filter((ex) => ARTICLE_LENGTHS.has(ex.length ?? "")),
    [examples],
  );

  const loadCounts = async () => {
    const requestId = ++countRequestRef.current;

    try {
      const response = await fetch("/api/chroma/health", { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as {
        count?: number;
        rejectionCount?: number;
      } | null;
      if (requestId !== countRequestRef.current) return;

      if (data) {
        setSavedCount(data.count ?? null);
        setRejectedCount(data.rejectionCount ?? null);
      }
    } catch {
      if (requestId !== countRequestRef.current) return;
    }
  };

  const loadExamples = async (query = deferredSearch, activeFilter = filter, silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      if (activeFilter !== "All") params.set("filter", activeFilter);
      params.set("limit", "50");
      const response = await fetch(`/api/tweets?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as TweetsResponse | null;
      if (!response.ok) throw new Error(data?.error ?? "Could not load saved tweets.");
      setExamples(data?.examples ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load saved tweets.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadRejections = async (silent = false) => {
    if (!silent) setRejectionLoading(true);
    setRejectionError("");
    try {
      const response = await fetch("/api/tweets?collection=rejections&limit=50", { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as TweetsResponse | null;
      if (!response.ok) throw new Error(data?.error ?? "Could not load rejected patterns.");
      setRejections(data?.examples ?? []);
    } catch (err) {
      setRejectionError(err instanceof Error ? err.message : "Could not load rejected patterns.");
    } finally {
      if (!silent) setRejectionLoading(false);
    }
  };

  useEffect(() => {
    void loadCounts();
    void loadRejections();
  }, []);

  useEffect(() => {
    void loadExamples(deferredSearch, filter);
  }, [deferredSearch, filter]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void loadExamples(deferredSearch, filter, true);
        void loadRejections(true);
        void loadCounts();
      }
    };
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 8000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
    };
  }, [deferredSearch, filter]);

  const handleSave = async () => {
    const cleanInput = input.trim();
    if (!cleanInput) { setSaveError("Paste a tweet link or text."); return; }
    setSaving(true); setSaved(false); setSaveError("");
    try {
      const response = await fetch("/api/tweets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: cleanInput,
          notes: notes.trim(),
          category: category.trim() || undefined,
          tags: tagsInput.trim() || undefined,
          tone: tone === "auto" ? undefined : tone,
          length: length === "auto" ? undefined : length,
        }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Could not save tweet.");
      setInput(""); setNotes(""); setCategory(""); setTagsInput("");
      setTone("auto"); setLength("auto");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
      setSearch(""); setFilter("All");
      setSavedCount((c) => c !== null ? c + 1 : null);
      setActiveTab("saved");
      await Promise.all([loadExamples("", "All"), loadCounts()]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save tweet.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this saved example?")) return;
    const previous = examples;
    setExamples((cur) => cur.filter((ex) => ex.id !== id));
    setSavedCount((c) => c !== null ? c - 1 : null);
    try {
      const response = await fetch(`/api/tweets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete tweet.");
      void loadCounts();
    } catch (err) {
      setExamples(previous);
      setSavedCount((c) => c !== null ? c + 1 : null);
      setError(err instanceof Error ? err.message : "Could not delete tweet.");
    }
  };

  const handleDeleteRejection = async (id: string) => {
    if (!window.confirm("Remove this rejected pattern? The generator will no longer avoid it.")) return;
    const previous = rejections;
    setRejections((cur) => cur.filter((r) => r.id !== id));
    setRejectedCount((c) => c !== null ? c - 1 : null);
    try {
      const response = await fetch(
        `/api/tweets?id=${encodeURIComponent(id)}&collection=rejections`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Could not remove rejection.");
      void loadCounts();
    } catch (err) {
      setRejections(previous);
      setRejectedCount((c) => c !== null ? c + 1 : null);
      setRejectionError(err instanceof Error ? err.message : "Could not remove rejection.");
    }
  };

  const handleCopy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(""), 1500);
  };

  const displaySavedCount = savedCount !== null ? savedCount : examples.length;
  const displayRejectedCount = rejectedCount !== null ? rejectedCount : rejections.length;

  return (
    <AppShell title="Database" statusSlot={<SystemStatus compact />}>
      {/* Clickable stats tabs */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setActiveTab("saved")}
          className={`rounded-2xl border p-3 text-left transition-colors ${
            activeTab === "saved"
              ? "border-emerald-500/30 bg-emerald-500/[0.06]"
              : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10]"
          }`}
        >
          <div className="flex items-center gap-2 text-zinc-500">
            <Database size={14} />
            <span className="text-[11px] uppercase tracking-[0.18em]">Saved</span>
          </div>
          <p className={`mt-3 text-[22px] font-semibold ${activeTab === "saved" ? "text-white" : "text-zinc-300"}`}>
            {displaySavedCount}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("rejected")}
          className={`rounded-2xl border p-3 text-left transition-colors ${
            activeTab === "rejected"
              ? "border-red-500/30 bg-red-500/[0.05]"
              : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10]"
          }`}
        >
          <div className="flex items-center gap-2 text-zinc-500">
            <ThumbsDown size={14} />
            <span className="text-[11px] uppercase tracking-[0.18em]">Rejected</span>
          </div>
          <p className={`mt-3 text-[22px] font-semibold ${activeTab === "rejected" ? "text-white" : "text-zinc-300"}`}>
            {displayRejectedCount}
          </p>
        </button>
      </div>

      {/* Save example */}
      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="section-label">Save example</p>
          <button type="button" onClick={() => setDetailsOpen((v) => !v)} className="ghost-button">
            <SlidersHorizontal size={14} />
            {detailsOpen ? "Hide details" : "Details"}
          </button>
        </div>

        <div className="field-shell mt-4 px-4 py-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={5}
            placeholder="Paste tweet link or text"
            className="min-h-28 w-full resize-none bg-transparent text-[15px] leading-7 text-zinc-100 outline-none placeholder:text-zinc-700"
          />
        </div>

        <div className="field-shell mt-3 px-4">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why it works"
            className="h-11 w-full bg-transparent text-[14px] text-zinc-100 outline-none placeholder:text-zinc-700"
          />
        </div>

        {detailsOpen ? (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Feeling" options={toneOptions} selected={tone} onChange={setTone} />
              <SelectField label="Length" options={lengthOptions} selected={length} onChange={setLength} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block min-w-0">
                <span className="section-label">Category</span>
                <div className="field-shell mt-3 px-4">
                  <input
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="ai, product, writing"
                    className="h-11 w-full bg-transparent text-[14px] text-zinc-100 outline-none placeholder:text-zinc-700"
                  />
                </div>
              </label>
              <label className="block min-w-0">
                <span className="section-label">Tags</span>
                <div className="field-shell mt-3 px-4">
                  <input
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="comma separated"
                    className="h-11 w-full bg-transparent text-[14px] text-zinc-100 outline-none placeholder:text-zinc-700"
                  />
                </div>
              </label>
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <button type="button" disabled={saving} onClick={handleSave} className="primary-button flex-1">
            {saving ? <Loader2 size={17} className="animate-spin" /> : saved ? <Check size={17} /> : null}
            {saving ? "Saving" : saved ? "Saved" : "Save to library"}
          </button>
          <span className="text-[11px] text-zinc-500">
            {detailsOpen ? "Manual metadata overrides auto-tagging." : "Auto-tags fill the gaps."}
          </span>
        </div>

        {saveError ? <p className="pt-3 text-[13px] leading-5 text-red-400">{saveError}</p> : null}
      </section>

      {/* Browse library — visible on Saved tab */}
      {activeTab === "saved" ? (
        <section className="surface-card p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="section-label">Browse library</p>
            <span className="text-[11px] tabular-nums text-zinc-500">
              {loading ? "Refreshing" : `${examples.length} shown`}
            </span>
          </div>

          <div className="field-shell mt-4 flex items-center gap-3 px-4">
            <Search size={16} className="text-zinc-600" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search saved tweets"
              className="h-11 w-full bg-transparent text-[14px] text-zinc-100 outline-none placeholder:text-zinc-700"
            />
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {filterOptions.map((option) => {
              const active = filter === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFilter(option)}
                  className={
                    active
                      ? "shrink-0 rounded-full border border-white/[0.14] bg-white/[0.08] px-3 py-2 text-[12px] font-medium text-white"
                      : "shrink-0 rounded-full border border-white/[0.06] bg-transparent px-3 py-2 text-[12px] text-zinc-500"
                  }
                >
                  {option === "All" ? "All" : prettyMeta(option)}
                </button>
              );
            })}
          </div>

          {error ? <p className="pt-4 text-[13px] leading-5 text-red-400">{error}</p> : null}

          {loading ? (
            <div className="flex items-center justify-center py-12 text-zinc-600">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : (
            <>
              {(tweets.length > 0 || articles.length === 0) ? (
                <div className="mt-4">
                  {articles.length > 0 ? (
                    <p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-zinc-600">
                      Tweets · {tweets.length}
                    </p>
                  ) : null}
                  <div className="divide-y divide-white/[0.06]">
                    {tweets.length ? (
                      tweets.map((ex) => (
                        <TweetCard
                          key={ex.id}
                          example={ex}
                          onDelete={handleDelete}
                          onCopy={handleCopy}
                          copied={copiedId === ex.id}
                        />
                      ))
                    ) : (
                      <EmptyState label="posts" />
                    )}
                  </div>
                </div>
              ) : null}

              {articles.length > 0 ? (
                <div className="mt-6">
                  <p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-zinc-600">
                    Articles · {articles.length}
                  </p>
                  <div className="divide-y divide-white/[0.06]">
                    {articles.map((ex) => (
                      <TweetCard
                        key={ex.id}
                        example={ex}
                        onDelete={handleDelete}
                        onCopy={handleCopy}
                        copied={copiedId === ex.id}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {/* Rejected patterns — visible on Rejected tab */}
      {activeTab === "rejected" ? (
        <section className="surface-card p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="section-label">Rejected patterns</p>
            <span className="text-[11px] tabular-nums text-zinc-500">
              {rejectionLoading ? "Refreshing" : `${rejections.length} patterns`}
            </span>
          </div>

          <p className="mt-3 text-[13px] leading-5 text-zinc-500">
            Patterns the generator actively avoids. Tap "Reject this style" on any generated post to add more.
          </p>

          {rejectionError ? (
            <p className="pt-4 text-[13px] leading-5 text-red-400">{rejectionError}</p>
          ) : null}

          {rejectionLoading ? (
            <div className="flex items-center justify-center py-10 text-zinc-600">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : rejections.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-[13px] text-zinc-600">No rejected patterns yet.</p>
              <p className="mt-1 text-[12px] text-zinc-700">
                Tap "Reject this style" on a generated post to teach the generator what to avoid.
              </p>
            </div>
          ) : (
            <div className="mt-2 divide-y divide-white/[0.06]">
              {rejections.map((r) => (
                <RejectionCard
                  key={r.id}
                  example={r}
                  onDelete={handleDeleteRejection}
                  onCopy={handleCopy}
                  copied={copiedId === r.id}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}
    </AppShell>
  );
}
