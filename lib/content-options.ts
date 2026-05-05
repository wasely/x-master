export type LengthId =
  | "one_liner"
  | "short_post"
  | "regular_post"
  | "thread"
  | "article";

export type ToneId =
  | "persuasive"
  | "funny"
  | "calm"
  | "relax"
  | "just_typing";

export type ContentMode = "tiktok" | "topic";

export type LengthOption = {
  id: LengthId;
  label: string;
  range: string;
  minWords: number;
  maxWords: number;
  outputType: string;
};

export type ToneOption = {
  id: ToneId;
  label: string;
};

export const LENGTH_OPTIONS: LengthOption[] = [
  {
    id: "one_liner",
    label: "One-liner",
    range: "4-12 words",
    minWords: 4,
    maxWords: 12,
    outputType: "one short one-liner X post",
  },
  {
    id: "short_post",
    label: "Short post",
    range: "12-30 words",
    minWords: 12,
    maxWords: 30,
    outputType: "one short X post",
  },
  {
    id: "regular_post",
    label: "Regular post",
    range: "30-90 words",
    minWords: 30,
    maxWords: 90,
    outputType: "one regular X post",
  },
  {
    id: "thread",
    label: "Thread",
    range: "5-10 tweets",
    minWords: 120,
    maxWords: 320,
    outputType: "one complete numbered X thread",
  },
  {
    id: "article",
    label: "Article",
    range: "350-1600 words",
    minWords: 350,
    maxWords: 1600,
    outputType: "one article",
  },
];

export const TONE_OPTIONS: ToneOption[] = [
  { id: "persuasive", label: "Persuasive" },
  { id: "funny", label: "Funny" },
  { id: "calm", label: "Calm" },
  { id: "relax", label: "Relax" },
  { id: "just_typing", label: "Just like typing" },
];

const LENGTH_ALIASES: Record<string, LengthId> = {
  "one_liner": "one_liner",
  "one-liner": "one_liner",
  "one liner": "one_liner",
  "short one-liner": "one_liner",
  "short": "one_liner",
  "short_post": "short_post",
  "short-post": "short_post",
  "short post": "short_post",
  "medium": "short_post",
  "regular_post": "regular_post",
  "regular-post": "regular_post",
  "regular post": "regular_post",
  "regular": "regular_post",
  "post": "regular_post",
  "long": "regular_post",
  "thread": "thread",
  "article": "article",
  "manifesto": "article",
};

const TONE_ALIASES: Record<string, ToneId> = {
  "persuasive": "persuasive",
  "impactful": "persuasive",
  "motivational": "persuasive",
  "contrarian": "persuasive",
  "serious": "persuasive",
  "funny": "funny",
  "calm": "calm",
  "educational": "calm",
  "relax": "relax",
  "relaxed": "relax",
  "just_typing": "just_typing",
  "just-typing": "just_typing",
  "just typing": "just_typing",
  "typing": "just_typing",
};

export function normalizeLengthId(id: unknown) {
  if (typeof id !== "string") return undefined;
  return LENGTH_ALIASES[id.trim().toLowerCase()];
}

export function normalizeToneId(id: unknown) {
  if (typeof id !== "string") return undefined;
  return TONE_ALIASES[id.trim().toLowerCase()];
}

export function getLengthOption(id: unknown) {
  const normalizedId = normalizeLengthId(id) ?? "regular_post";
  return LENGTH_OPTIONS.find((option) => option.id === normalizedId) ?? LENGTH_OPTIONS[2];
}

export function getToneOption(id: unknown) {
  const normalizedId = normalizeToneId(id) ?? "persuasive";
  return TONE_OPTIONS.find((option) => option.id === normalizedId) ?? TONE_OPTIONS[0];
}

export function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
