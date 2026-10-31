export const ARTICLE_IDS = [
  "what-neurofront-measures",
  "personal-baseline",
  "preparing-a-measurement",
  "signal-quality",
  "sensor-channels",
  "experimental-score",
  "comparing-baseline",
  "reading-history",
  "troubleshooting",
] as const;
export type ArticleId = (typeof ARTICLE_IDS)[number];
export type ArticleCategory = "device" | "baseline" | "signals" | "results";
export type ArticleCopy = readonly [
  title: string,
  summary: string,
  idea: string,
  practice: string,
];
export type ResourceCopy = {
  headings: readonly [string, string];
  categories: Record<ArticleCategory, string>;
  articles: Record<ArticleId, ArticleCopy>;
};
export interface Article {
  id: ArticleId;
  category: ArticleCategory;
  categoryLabel: string;
  title: string;
  summary: string;
  readMinutes: number;
  sections: { heading: string; paragraphs: string[] }[];
  sources: { title: string; url: string }[];
}
