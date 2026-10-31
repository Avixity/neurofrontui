import { en, type TranslationKey } from "./en";
import { loadArticles, resourceCopies } from "../content";
import type { Locale } from "./locales";
import type { Dictionary, TranslationParams, Translator } from "./types";

export { LOCALES, isLocale, localeDirection } from "./locales";
export type { Locale } from "./locales";
export type { TranslationKey } from "./en";
export type { Dictionary, TranslationParams, Translator } from "./types";

export const dictionaries: Partial<Record<Locale, Dictionary>> = { en };
const loaders: Record<Exclude<Locale, "en">, () => Promise<Dictionary>> = {
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
export function isLocaleLoaded(locale: Locale): boolean {
  return Boolean(dictionaries[locale] && resourceCopies[locale]);
}
export async function loadLocale(locale: Locale): Promise<void> {
  if (isLocaleLoaded(locale)) return;
  const existing = pending.get(locale);
  if (existing) return existing;
  const loading = Promise.all([
    locale === "en" || dictionaries[locale]
      ? Promise.resolve()
      : loaders[locale]().then((dictionary) => {
          dictionaries[locale] = dictionary;
        }),
    loadArticles(locale),
  ])
    .then(() => undefined)
    .finally(() => {
      pending.delete(locale);
    });
  pending.set(locale, loading);
  return loading;
}
const numberFormats = new Map<Locale, Intl.NumberFormat>();

export function t(
  locale: Locale,
  key: TranslationKey,
  params: TranslationParams = {},
): string {
  const message = dictionaries[locale]?.[key];
  if (typeof message !== "string")
    throw new Error(`Missing translation: ${locale}.${key}`);
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name))
      throw new Error(`Missing translation parameter: ${key}.${name}`);
    const value = params[name];
    if (typeof value !== "number") return value;
    let format = numberFormats.get(locale);
    if (!format) {
      format = new Intl.NumberFormat(locale);
      numberFormats.set(locale, format);
    }
    return format.format(value);
  });
}

export function createTranslator(locale: Locale): Translator {
  return (key, params) => t(locale, key, params);
}
