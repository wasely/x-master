"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Clipboard,
  ClipboardPaste,
  Loader2,
  PenLine,
  RotateCcw,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import SystemStatus from "@/components/SystemStatus";
import {
  ContentMode,
  LENGTH_OPTIONS,
  LengthId,
  TONE_OPTIONS,
  ToneId,
  getLengthOption,
  getToneOption,
  wordCount,
} from "@/lib/content-options";

type LoadingState = "idle" | "extracting" | "generating";

type GeneratedVariant = {
  id: string;
  content: string;
};

type GenerateResponse = {
  content?: string;
  generations?: GeneratedVariant[];
  referencesUsed?: number;
  avoidReferencesUsed?: number;
  error?: string;
};

type StoredComposerState = {
  input?: string;
  lengthId?: LengthId;
  toneId?: ToneId;
  generations?: GeneratedVariant[];
  activeVariantId?: string;
  referencesUsed?: number;
  avoidReferencesUsed?: number;
};

type FeedbackAction = "like" | "dislike";

const VARIANT_COUNT = 5;

function isUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function storageKeyForMode(mode: ContentMode) {
  return `x-master:${mode}:composer`;
}

function buildShareUrl(text: string) {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

function SelectField<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { id: T; label: string; range?: string }[];
  selected: T;
  onChange: (value: T) => void;
}) {
  const selectedOption = options.find((option) => option.id === selected);

  return (
    <label className="block min-w-0">
      <span className="section-label">{label}</span>
      <div className="field-shell mt-3 px-3">
        <select
          value={selected}
          onChange={(event) => onChange(event.target.value as T)}
          className="h-12 w-full bg-transparent text-[14px] text-zinc-100 outline-none"
        >
          {options.map((option) => (
            <option key={option.id} value={option.id} className="bg-[#090909] text-zinc-100">
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {selectedOption?.range ? (
        <span className="mt-3 block text-[11px] tabular-nums text-zinc-500">
          {selectedOption.range}
        </span>
      ) : null}
    </label>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button type="button" onClick={handleCopy} className="secondary-button flex-1">
      {copied ? <Check size={16} /> : <Clipboard size={16} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function GenerationComposer({ mode }: { mode: ContentMode }) {
  const [input, setInput] = useState("");
  const [lengthId, setLengthId] = useState<LengthId>("regular_post");
  const [toneId, setToneId] = useState<ToneId>("persuasive");
  const [variants, setVariants] = useState<GeneratedVariant[]>([]);
  const [activeVariantId, setActiveVariantId] = useState("");
  const [referencesUsed, setReferencesUsed] = useState(0);
  const [avoidReferencesUsed, setAvoidReferencesUsed] = useState(0);
  const [draftSavedId, setDraftSavedId] = useState("");
  const [draftSaving, setDraftSaving] = useState(false);
  const [feedbackByVariantId, setFeedbackByVariantId] = useState<Record<string, FeedbackAction>>({});
  const [feedbackBusyId, setFeedbackBusyId] = useState("");
  const [error, setError] = useState("");
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const abortControllerRef = useRef<AbortController | null>(null);
  const extractedSourceCacheRef = useRef(new Map<string, string>());

  const storageKey = useMemo(() => storageKeyForMode(mode), [mode]);
  const loading = loadingState !== "idle";
  const activeVariant = useMemo(
    () => variants.find((variant) => variant.id === activeVariantId) ?? variants[0] ?? null,
    [activeVariantId, variants],
  );
  const title = mode === "tiktok" ? "TikTok to X" : "Generate";
  const placeholder =
    mode === "tiktok"
      ? "Paste a TikTok URL or transcript"
      : "What do you want to write about?";
  const inputLabel = mode === "tiktok" ? "Source" : "Topic";
  const buttonText =
    loadingState === "extracting"
      ? "Reading TikTok"
      : loadingState === "generating"
        ? `Generating ${VARIANT_COUNT} posts`
        : mode === "tiktok"
          ? "Generate from TikTok"
          : "Generate";

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;

      const stored = JSON.parse(raw) as StoredComposerState;
      if (typeof stored.input === "string") setInput(stored.input);
      if (stored.lengthId) setLengthId(getLengthOption(stored.lengthId).id);
      if (stored.toneId) setToneId(getToneOption(stored.toneId).id);
      if (Array.isArray(stored.generations)) {
        const cleanGenerations = stored.generations.filter(
          (generation): generation is GeneratedVariant =>
            Boolean(generation?.id) && typeof generation?.content === "string",
        );
        setVariants(cleanGenerations);
        setActiveVariantId(stored.activeVariantId ?? cleanGenerations[0]?.id ?? "");
      }
      if (typeof stored.referencesUsed === "number") {
        setReferencesUsed(stored.referencesUsed);
      }
      if (typeof stored.avoidReferencesUsed === "number") {
        setAvoidReferencesUsed(stored.avoidReferencesUsed);
      }
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    const payload: StoredComposerState = {
      input,
      lengthId,
      toneId,
      generations: variants,
      activeVariantId,
      referencesUsed,
      avoidReferencesUsed,
    };

    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [activeVariantId, avoidReferencesUsed, input, lengthId, referencesUsed, storageKey, toneId, variants]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleGenerate = async () => {
    const source = input.trim();

    if (!source) {
      setError(mode === "tiktok" ? "Paste a TikTok URL or transcript." : "Enter a topic.");
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setError("");

    try {
      setDraftSavedId("");
      let sourceForGeneration = source;

      if (mode === "tiktok" && isUrl(source)) {
        const cachedCaptions = extractedSourceCacheRef.current.get(source);

        if (cachedCaptions) {
          sourceForGeneration = cachedCaptions;
        } else {
          setLoadingState("extracting");
          const captionsResponse = await fetch("/api/extract-captions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: source }),
            signal: controller.signal,
          });
          const captionsData = (await captionsResponse.json().catch(() => null)) as
            | { captions?: string; error?: string }
            | null;

          if (!captionsResponse.ok || !captionsData?.captions) {
            throw new Error(captionsData?.error ?? "Could not read this TikTok. Paste the transcript instead.");
          }

          extractedSourceCacheRef.current.set(source, captionsData.captions);
          sourceForGeneration = captionsData.captions;
        }
      }

      setLoadingState("generating");
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: sourceForGeneration,
          mode,
          toneId,
          lengthId,
          useLibrary: true,
          count: VARIANT_COUNT,
        }),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => null)) as GenerateResponse | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Could not generate.");
      }

      const nextVariants =
        data?.generations?.filter((variant) => variant.content.trim()) ??
        (data?.content ? [{ id: "1", content: data.content }] : []);

      if (!nextVariants.length) {
        throw new Error("The generator did not return any usable options.");
      }

      setVariants(nextVariants);
      setActiveVariantId(nextVariants[0]?.id ?? "");
      setReferencesUsed(data?.referencesUsed ?? 0);
      setAvoidReferencesUsed(data?.avoidReferencesUsed ?? 0);
      setFeedbackByVariantId({});
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Generation stopped.");
      } else {
        setError(err instanceof Error ? err.message : "Could not generate.");
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setLoadingState("idle");
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const handlePaste = async () => {
    const clipboard = await navigator.clipboard.readText().catch(() => "");

    if (!clipboard.trim()) {
      setError("Clipboard is empty.");
      return;
    }

    setError("");
    setInput((current) => (current.trim() ? `${current.trim()}\n\n${clipboard.trim()}` : clipboard.trim()));
  };

  const handleClear = () => {
    setInput("");
    setVariants([]);
    setActiveVariantId("");
    setReferencesUsed(0);
    setAvoidReferencesUsed(0);
    setDraftSavedId("");
    setFeedbackByVariantId({});
    setError("");
  };

  const handleShare = () => {
    if (!activeVariant?.content) return;
    window.open(buildShareUrl(activeVariant.content), "_blank", "noopener,noreferrer");
  };

  const handleFeedback = async (action: FeedbackAction) => {
    if (!activeVariant) return;

    setFeedbackBusyId(activeVariant.id);

    try {
      const response = await fetch("/api/generate/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          text: activeVariant.content,
          mode,
          toneId,
          lengthId,
          source: input.trim(),
        }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Could not save feedback.");
      }

      setFeedbackByVariantId((current) => ({
        ...current,
        [activeVariant.id]: action,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save feedback.");
    } finally {
      setFeedbackBusyId("");
    }
  };

  const handleSaveDraft = async () => {
    if (!activeVariant?.content || draftSaving) return;
    setDraftSaving(true);
    try {
      const response = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: activeVariant.content,
          myDraft: activeVariant.content,
        }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Could not save draft.");
      setDraftSavedId(activeVariant.id);
      window.setTimeout(() => setDraftSavedId(""), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save draft.");
    } finally {
      setDraftSaving(false);
    }
  };

  return (
    <AppShell title={title} statusSlot={<SystemStatus compact />}>
      <section className="surface-card p-4">
        <p className="section-label">{inputLabel}</p>

        <div className="field-shell mt-3 px-4 py-4">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={placeholder}
            rows={6}
            className="min-h-36 w-full resize-none bg-transparent text-[15px] leading-7 text-zinc-100 outline-none placeholder:text-zinc-700"
          />
        </div>

        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => void handlePaste()} className="ghost-button">
            <ClipboardPaste size={14} />
            Paste
          </button>
          {(input || variants.length) ? (
            <button type="button" onClick={handleClear} className="ghost-button">
              <Trash2 size={14} />
              Clear
            </button>
          ) : null}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="surface-card p-4">
          <SelectField label="Length" options={LENGTH_OPTIONS} selected={lengthId} onChange={setLengthId} />
        </div>
        <div className="surface-card p-4">
          <SelectField label="Feeling" options={TONE_OPTIONS} selected={toneId} onChange={setToneId} />
        </div>
      </section>

      <section className="surface-card p-4">
        <div className="flex gap-3">
          <button type="button" disabled={loading} onClick={handleGenerate} className="primary-button flex-[1.4]">
            {loading ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}
            {buttonText}
          </button>
          {loading ? (
            <button type="button" onClick={handleStop} className="secondary-button w-[7.25rem]">
              <Square size={14} />
              Stop
            </button>
          ) : null}
        </div>
        {error ? <p className="pt-3 text-[13px] leading-5 text-red-400">{error}</p> : null}
      </section>

      {activeVariant ? (
        <section className="surface-card p-4">
          {feedbackByVariantId[activeVariant.id] ? (
            <div className="mb-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-[12px] text-zinc-400">
              {feedbackByVariantId[activeVariant.id] === "like"
                ? "Saved as a positive style reference."
                : "Saved as a rejected style pattern."}
            </div>
          ) : null}

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-label">Output</p>
              <p className="mt-3 text-[18px] font-medium text-white">
                {variants.length} refined {variants.length === 1 ? "post" : "posts"}
              </p>
            </div>
            <div className="text-right text-[11px] tabular-nums text-zinc-500">
              <div>{wordCount(activeVariant.content)} words</div>
              <div>{activeVariant.content.length} chars</div>
            </div>
          </div>

          {variants.length > 1 ? (
            <div className="mt-4 flex gap-2 overflow-x-auto">
              {variants.map((variant, index) => {
                const active = variant.id === activeVariant.id;

                return (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => setActiveVariantId(variant.id)}
                    className={
                      active
                        ? "rounded-full border border-white/[0.16] bg-white/[0.08] px-3 py-2 text-[12px] font-medium text-white"
                        : "rounded-full border border-white/[0.06] bg-transparent px-3 py-2 text-[12px] text-zinc-500"
                    }
                  >
                    Post {index + 1}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="mt-4 rounded-[1.35rem] border border-white/[0.06] bg-black/20 p-4">
            <p className="whitespace-pre-wrap text-[15px] leading-7 text-zinc-100">
              {activeVariant.content}
            </p>
          </div>

          {referencesUsed > 0 ? (
            <p className="mt-2 text-[11px] text-zinc-600">
              {referencesUsed} style {referencesUsed === 1 ? "example" : "examples"} used
              {avoidReferencesUsed > 0 ? ` · ${avoidReferencesUsed} rejected ${avoidReferencesUsed === 1 ? "pattern" : "patterns"} avoided` : ""}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleFeedback("like")}
              disabled={feedbackBusyId === activeVariant.id}
              className="ghost-button"
            >
              <ThumbsUp size={14} />
              {feedbackByVariantId[activeVariant.id] === "like"
                ? "Saved to library"
                : feedbackBusyId === activeVariant.id
                  ? "Saving"
                  : "Keep this style"}
            </button>
            <button
              type="button"
              onClick={() => void handleFeedback("dislike")}
              disabled={feedbackBusyId === activeVariant.id}
              className="ghost-button"
            >
              <ThumbsDown size={14} />
              {feedbackByVariantId[activeVariant.id] === "dislike"
                ? "Marked as reject"
                : feedbackBusyId === activeVariant.id
                  ? "Saving"
                  : "Reject this style"}
            </button>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleSaveDraft()}
              disabled={draftSaving || draftSavedId === activeVariant.id}
              className="secondary-button flex-1"
            >
              {draftSavedId === activeVariant.id ? (
                <Check size={16} />
              ) : draftSaving ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <PenLine size={16} />
              )}
              {draftSavedId === activeVariant.id ? "Saved!" : "Draft"}
            </button>
            <CopyButton text={activeVariant.content} />
            <button type="button" onClick={handleShare} className="secondary-button flex-1">
              <ArrowUpRight size={16} />
              Post to X
            </button>
            <button type="button" onClick={handleGenerate} disabled={loading} className="secondary-button flex-1">
              <RotateCcw size={16} />
              Again
            </button>
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
