export type LengthId =
  | "short"
  | "medium"
  | "long"
  | "thread"
  | "article"
  | "manifesto";

export type ToneId =
  | "funny"
  | "serious"
  | "impactful"
  | "motivational"
  | "educational"
  | "contrarian";

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
    id: "short",
    label: "Short",
    range: "7-15 words",
    minWords: 7,
    maxWords: 15,
    outputType: "one tight X post",
  },
  {
    id: "medium",
    label: "Medium",
    range: "15-30 words",
    minWords: 15,
    maxWords: 30,
    outputType: "one X post",
  },
  {
    id: "long",
    label: "Long",
    range: "30-75 words",
    minWords: 30,
    maxWords: 75,
    outputType: "one X post",
  },
  {
    id: "thread",
    label: "Thread",
    range: "8-12 tweets",
    minWords: 151,
    maxWords: 300,
    outputType: "one complete numbered X thread",
  },
  {
    id: "article",
    label: "Article",
    range: "301-1000 words",
    minWords: 301,
    maxWords: 1000,
    outputType: "one article",
  },
  {
    id: "manifesto",
    label: "Manifesto",
    range: "1001-2000 words",
    minWords: 1001,
    maxWords: 2000,
    outputType: "one manifesto",
  },
];

export const TONE_OPTIONS: ToneOption[] = [
  { id: "funny", label: "Funny" },
  { id: "serious", label: "Serious" },
  { id: "impactful", label: "Impactful" },
  { id: "motivational", label: "Motivational" },
  { id: "educational", label: "Educational" },
  { id: "contrarian", label: "Contrarian" },
];

export function getLengthOption(id: unknown) {
  return LENGTH_OPTIONS.find((option) => option.id === id) ?? LENGTH_OPTIONS[2];
}

export function getToneOption(id: unknown) {
  return TONE_OPTIONS.find((option) => option.id === id) ?? TONE_OPTIONS[2];
}

export function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
