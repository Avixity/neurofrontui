import type { Locale } from "../i18n/locales";
import {
  ARTICLE_IDS,
  type Article,
  type ArticleCategory,
  type ArticleId,
  type ResourceCopy,
} from "./types";
import { en } from "./en";

export { ARTICLE_IDS } from "./types";
export type { Article, ArticleCategory, ArticleId } from "./types";
export const resourceCopies: Partial<Record<Locale, ResourceCopy>> = { en };
const loaders: Record<Exclude<Locale, "en">, () => Promise<ResourceCopy>> = {
  hi: () => import("./hi").then((module) => module.hi),
  pa: () => import("./pa").then((module) => module.pa),
  bn: () => import("./bn").then((module) => module.bn),
  mr: () => import("./mr").then((module) => module.mr),
  gu: () => import("./gu").then((module) => module.gu),
  ta: () => import("./ta").then((module) => module.ta),
  te: () => import("./te").then((module) => module.te),
  kn: () => import("./kn").then((module) => module.kn),
  ml: () => import("./ml").then((module) => module.ml),
  or: () => import("./or").then((module) => module.or),
  as: () => import("./as").then((module) => module.as),
  ur: () => import("./ur").then((module) => module.ur),
};
const pending = new Map<Locale, Promise<void>>();
export async function loadArticles(locale: Locale): Promise<void> {
  if (resourceCopies[locale] || locale === "en") return;
  const existing = pending.get(locale);
  if (existing) return existing;
  const loading = loaders[locale]()
    .then((copy) => {
      resourceCopies[locale] = copy;
    })
    .finally(() => {
      pending.delete(locale);
    });
  pending.set(locale, loading);
  return loading;
}

const sources = {
  project: {
    title: "NeuroFront dashboard source",
    url: "https://github.com/Avixity/neurofrontui",
  },
  acquisition: {
    title: "NeuroFront: acquisition.ts",
    url: "https://github.com/Avixity/neurofrontui/blob/main/src/core/acquisition.ts",
  },
  calculation: {
    title: "NeuroFront: calculation.ts",
    url: "https://github.com/Avixity/neurofrontui/blob/main/src/core/calculation.ts",
  },
  protocol: {
    title: "NeuroFront: device.ts",
    url: "https://github.com/Avixity/neurofrontui/blob/main/src/core/device.ts",
  },
  schema: {
    title: "NeuroFront: types.ts",
    url: "https://github.com/Avixity/neurofrontui/blob/main/src/types.ts",
  },
  ad8232: {
    title: "Analog Devices: AD8232",
    url: "https://www.analog.com/en/products/ad8232.html",
  },
  ecg: {
    title: "NHLBI: Heart Tests",
    url: "https://www.nhlbi.nih.gov/health/heart-tests",
  },
  eda: {
    title: "Ho, Toska & Wesche (2020): Sweat and cardiovascular responses",
    url: "https://www.frontiersin.org/journals/neurology/articles/10.3389/fneur.2020.00051/full",
  },
  bluetooth: {
    title: "MDN: Web Bluetooth API",
    url: "https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API",
  },
};
const metadata: Record<
  ArticleId,
  { category: ArticleCategory; sources: (keyof typeof sources)[] }
> = {
  "what-neurofront-measures": {
    category: "device",
    sources: ["protocol", "ad8232", "ecg"],
  },
  "personal-baseline": { category: "baseline", sources: ["acquisition"] },
  "preparing-a-measurement": {
    category: "device",
    sources: ["acquisition", "ad8232"],
  },
  "signal-quality": { category: "signals", sources: ["ad8232", "acquisition"] },
  "sensor-channels": { category: "signals", sources: ["protocol", "eda"] },
  "experimental-score": { category: "results", sources: ["calculation"] },
  "comparing-baseline": {
    category: "baseline",
    sources: ["acquisition", "schema"],
  },
  "reading-history": { category: "results", sources: ["schema", "project"] },
  troubleshooting: { category: "device", sources: ["protocol", "bluetooth"] },
};

export function getArticle(locale: Locale, id: string): Article | undefined {
  if (!ARTICLE_IDS.includes(id as ArticleId)) return undefined;
  const articleId = id as ArticleId;
  const copy = resourceCopies[locale];
  if (!copy) throw new Error(`Article locale has not been loaded: ${locale}`);
  const [title, summary, idea, practice] = copy.articles[articleId];
  const details = metadata[articleId];
  return {
    id: articleId,
    category: details.category,
    categoryLabel: copy.categories[details.category],
    title,
    summary,
    readMinutes: 1,
    sections: [
      { heading: copy.headings[0], paragraphs: [idea] },
      { heading: copy.headings[1], paragraphs: [practice] },
    ],
    sources: details.sources.map((source) => ({ ...sources[source] })),
  };
}

export function getArticles(locale: Locale): Article[] {
  return ARTICLE_IDS.map((id) => getArticle(locale, id)!);
}
