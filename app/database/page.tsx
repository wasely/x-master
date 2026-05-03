"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Check,
  Clipboard,
  ExternalLink,
  Loader2,
  Search,
  SlidersHorizontal,
  Trash2,
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

function prettyMeta(value?: string) {
  if (!value) return "";

  return (
    LENGTH_OPTIONS.find((option) => option.id === value)?.label ??
    TONE_OPTIONS.find((option) => option.id === value)?.label ??
    value
  );
}

function formatDate(value?: string) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function MetadataLine({ example }: { example: TweetExample }) {
  const items = [
    prettyMeta(example.length),
    prettyMeta(example.tone),
    example.category,
    ...example.tags,
  ].filter(Boolean);

  if (!items.length) return null;

  return (
    <p className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.12em] text-zinc-600">
      {items.map((item) => (
        <span key={item} className="rounded-full border border-white/[0.06] px-3 py-1.5">
          {item}
        </span>
      ))}
    </p>
  );
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
          onChange={(event) => onChange(event.target.value as T)}
          className="h-11 w-full bg-transparent text-[14px] text-zinc-100 outline-none"
        >
          {options.map((option) => (
            <option key={option.id} value={option.id} className="bg-[#090909] text-zinc-100">
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

export default function DatabasePage() {
  const [examples, setExamples] = useState<TweetExample[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  const filterOptions = useMemo(() => {
    const values = new Set<string>();

    examples.forEach((example) => {
      if (example.length) values.add(example.length);
      if (example.tone) values.add(example.tone);
      if (example.category) values.add(example.category);
      example.tags.forEach((tag) => values.add(tag));
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

  const loadExamples = async (query = deferredSearch, activeFilter = filter) => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      if (activeFilter !== "All") params.set("filter", activeFilter);
      params.set("limit", "50");

      const response = await fetch(`/api/tweets?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as TweetsResponse | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Could not load saved tweets.");
      }

      setExamples(data?.examples ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load saved tweets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadExamples(deferredSearch, filter);
  }, [deferredSearch, filter]);

  const handleSave = async () => {
    const cleanInput = input.trim();

    if (!cleanInput) {
      setSaveError("Paste a tweet link or text.");
      return;
    }

    setSaving(true);
    setSaved(false);
    setSaveError("");

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

      if (!response.ok) {
        throw new Error(data?.error ?? "Could not save tweet.");
      }

      setInput("");
      setNotes("");
      setCategory("");
      setTagsInput("");
      setTone("auto");
      setLength("auto");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
      setSearch("");
      setFilter("All");
      await loadExamples("", "All");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save tweet.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this saved example?")) {
      return;
    }

    const previous = examples;
    setExamples((current) => current.filter((example) => example.id !== id));

    try {
      const response = await fetch(`/api/tweets?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Could not delete tweet.");
      }
    } catch (err) {
      setExamples(previous);
      setError(err instanceof Error ? err.message : "Could not delete tweet.");
    }
  };

  const handleCopy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(""), 1500);
  };

  return (
    <AppShell
      title="Database"
      description="Curate the examples the generator learns from. Better metadata here produces better output later."
      statusSlot={<SystemStatus compact />}
    >
      <SystemStatus showCounts />

      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="section-label">Save example</p>
          <button type="button" onClick={() => setDetailsOpen((current) => !current)} className="ghost-button">
            <SlidersHorizontal size={14} />
            {detailsOpen ? "Hide details" : "Details"}
          </button>
        </div>

        <div className="field-shell mt-4 px-4 py-4">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={5}
            placeholder="Paste tweet link or text"
            className="min-h-28 w-full resize-none bg-transparent text-[15px] leading-7 text-zinc-100 outline-none placeholder:text-zinc-700"
          />
        </div>

        <div className="field-shell mt-3 px-4">
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Why it works"
            className="h-11 w-full bg-transparent text-[14px] text-zinc-100 outline-none placeholder:text-zinc-700"
          />
        </div>

        {detailsOpen ? (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <SelectField
                label="Tone"
                options={toneOptions}
                selected={tone}
                onChange={(value) => setTone(value)}
              />
              <SelectField
                label="Length"
                options={lengthOptions}
                selected={length}
                onChange={(value) => setLength(value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block min-w-0">
                <span className="section-label">Category</span>
                <div className="field-shell mt-3 px-4">
                  <input
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
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
                    onChange={(event) => setTagsInput(event.target.value)}
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
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search saved tweets"
            className="h-11 w-full bg-transparent text-[14px] text-zinc-100 outline-none placeholder:text-zinc-700"
          />
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto">
          {filterOptions.map((option) => {
            const active = filter === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={
                  active
                    ? "rounded-full border border-white/[0.14] bg-white/[0.08] px-3 py-2 text-[12px] font-medium text-white"
                    : "rounded-full border border-white/[0.06] bg-transparent px-3 py-2 text-[12px] text-zinc-500"
                }
              >
                {option === "All" ? "All" : prettyMeta(option)}
              </button>
            );
          })}
        </div>

        {error ? <p className="pt-4 text-[13px] leading-5 text-red-400">{error}</p> : null}

        <div className="mt-4 divide-y divide-white/[0.06]">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-zinc-600">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : examples.length ? (
            examples.map((example) => (
              <article key={example.id} className="py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-zinc-600">
                      {example.authorName ? <span>{example.authorName}</span> : null}
                      {example.createdAt ? <span>{formatDate(example.createdAt)}</span> : null}
                      {example.sourceType === "tweet_url" ? <span>Link</span> : <span>Manual</span>}
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-[15px] leading-6 text-zinc-200">
                      {example.text}
                    </p>
                    {example.notes ? (
                      <p className="mt-3 text-[13px] leading-6 text-zinc-500">{example.notes}</p>
                    ) : null}
                    <MetadataLine example={example} />

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCopy(example.id, example.text)}
                        className="ghost-button"
                      >
                        {copiedId === example.id ? <Check size={14} /> : <Clipboard size={14} />}
                        {copiedId === example.id ? "Copied" : "Copy"}
                      </button>
                      {example.sourceUrl ? (
                        <Link href={example.sourceUrl} target="_blank" className="ghost-button">
                          <ExternalLink size={14} />
                          Open source
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleDelete(example.id)}
                    className="mt-0.5 rounded-full border border-white/[0.06] p-2 text-zinc-600 hover:border-white/[0.12] hover:text-red-300"
                    aria-label="Delete saved tweet"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="py-10 text-center">
              <p className="text-[15px] text-zinc-300">No saved examples yet.</p>
              <p className="mt-2 text-[13px] leading-6 text-zinc-500">
                Save a few strong posts with notes so the generator has a real taste profile to learn from.
              </p>
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}
