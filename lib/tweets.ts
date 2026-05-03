export type TweetMetadata = {
  sourceType?: "tweet_url" | "manual";
  sourceUrl?: string;
  tweetId?: string;
  authorName?: string;
  notes?: string;
  tags?: string[] | string;
  tagCsv?: string;
  tone?: string;
  category?: string;
  length?: string;
  createdAt?: string;
};

export type TweetRecord = {
  id: string;
  text: string;
  sourceType: "tweet_url" | "manual";
  sourceUrl?: string;
  tweetId?: string;
  authorName?: string;
  notes?: string;
  tags: string[];
  tone?: string;
  category?: string;
  length?: string;
  createdAt?: string;
  distance?: number;
};

function splitTagString(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function normalizeTags(metadata?: TweetMetadata | null) {
  if (!metadata) return [];

  const tags = new Set<string>();

  if (Array.isArray(metadata.tags)) {
    metadata.tags.forEach((tag) => {
      const clean = tag.trim();
      if (clean) tags.add(clean);
    });
  }

  if (typeof metadata.tags === "string") {
    splitTagString(metadata.tags).forEach((tag) => tags.add(tag));
  }

  if (metadata.tagCsv) {
    splitTagString(metadata.tagCsv).forEach((tag) => tags.add(tag));
  }

  return Array.from(tags);
}

export function toTweetRecord(
  id: string,
  document: string | null,
  metadata: TweetMetadata | null,
  distance?: number,
): TweetRecord {
  return {
    id,
    text: document ?? "",
    sourceType: metadata?.sourceType ?? "manual",
    sourceUrl: metadata?.sourceUrl,
    tweetId: metadata?.tweetId,
    authorName: metadata?.authorName,
    notes: metadata?.notes,
    tags: normalizeTags(metadata),
    tone: metadata?.tone,
    category: metadata?.category,
    length: metadata?.length,
    createdAt: metadata?.createdAt,
    distance,
  };
}

export function matchesTweetFilter(example: TweetRecord, filter: string) {
  if (!filter) return true;

  const clean = filter.toLowerCase();
  return [
    example.tone,
    example.category,
    example.length,
    ...example.tags,
  ].some((value) => value?.toLowerCase() === clean);
}

export function buildTweetMetadata(input: {
  sourceType: "tweet_url" | "manual";
  createdAt: string;
  sourceUrl?: string;
  tweetId?: string;
  authorName?: string;
  notes?: string;
  tags?: string[];
  tone?: string;
  category?: string;
  length?: string;
}): TweetMetadata {
  const metadata: TweetMetadata = {
    sourceType: input.sourceType,
    createdAt: input.createdAt,
  };

  if (input.sourceUrl) metadata.sourceUrl = input.sourceUrl;
  if (input.tweetId) metadata.tweetId = input.tweetId;
  if (input.authorName) metadata.authorName = input.authorName;
  if (input.notes) metadata.notes = input.notes;
  if (input.tags?.length) metadata.tagCsv = input.tags.join(", ");
  if (input.tone) metadata.tone = input.tone;
  if (input.category) metadata.category = input.category;
  if (input.length) metadata.length = input.length;

  return metadata;
}
