import { en, type TranslationKey } from "./en";
import { dictionaries } from "./index";
import { LOCALES, type Locale } from "./locales";
import { ARTICLE_IDS, resourceCopies } from "../content";

const scripts: Record<Exclude<Locale, "en">, RegExp> = {
  hi: /\p{Script=Devanagari}/u,
  mr: /\p{Script=Devanagari}/u,
  pa: /\p{Script=Gurmukhi}/u,
  bn: /\p{Script=Bengali}/u,
  as: /\p{Script=Bengali}/u,
  gu: /\p{Script=Gujarati}/u,
  ta: /\p{Script=Tamil}/u,
  te: /\p{Script=Telugu}/u,
  kn: /\p{Script=Kannada}/u,
  ml: /\p{Script=Malayalam}/u,
  or: /\p{Script=Oriya}/u,
  ur: /\p{Script=Arabic}/u,
};
const placeholders = (value: string) =>
  [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(",");
const allowIdentical = new Set<TranslationKey>(["graph.gsr"]);
const allowedLatin = new Set([
  "NeuroFront",
  "Web",
  "Bluetooth",
  "AD8232",
  "ECG",
  "EEG",
  "GSR",
  "PNG",
  "CSV",
  "AI",
  "Chrome",
  "Edge",
  "Google",
  "DELETE",
  "count",
  "name",
]);
const unexpectedLatin = (value: string) =>
  [...value.matchAll(/[A-Za-z][A-Za-z0-9]*/g)].some(
    (match) => !allowedLatin.has(match[0]),
  );
const damaged =
  /9017\d{4}|NFPLACEHOLDER|\uFFFD|\?{3,}|(?:NeuroFront|GSR|Bluetooth|ECG|EEG|AI|Google|Chrome|Edge|PNG|CSV|DELETE|\})0+\b/;

export function validateTranslations(): string[] {
  const errors: string[] = [];
  const keys = Object.keys(en) as TranslationKey[];
  for (const locale of LOCALES) {
    const dictionary = dictionaries[locale.code];
    if (!dictionary) {
      errors.push(`${locale.code}: dictionary not loaded`);
      continue;
    }
    const actual = Object.keys(dictionary);
    if (keys.length !== actual.length || actual.some((key) => !(key in en)))
      errors.push(`${locale.code}: key set differs from English`);
    for (const key of keys) {
      const value = dictionary[key];
      if (!value?.trim()) {
        errors.push(`${locale.code}.${key}: empty or missing`);
        continue;
      }
      if (placeholders(value) !== placeholders(en[key]))
        errors.push(`${locale.code}.${key}: interpolation fields differ`);
      if (damaged.test(value))
        errors.push(
          `${locale.code}.${key}: temporary token or damaged Unicode`,
        );
      if (locale.code !== "en" && !allowIdentical.has(key)) {
        if (value === en[key])
          errors.push(`${locale.code}.${key}: untranslated English`);
        if (!scripts[locale.code].test(value))
          errors.push(`${locale.code}.${key}: no native script`);
        if (unexpectedLatin(value))
          errors.push(
            `${locale.code}.${key}: unexpected English or malformed fragment`,
          );
      }
    }
    const resources = resourceCopies[locale.code];
    if (!resources) {
      errors.push(`${locale.code}: resources not loaded`);
      continue;
    }
    if (
      JSON.stringify(Object.keys(resources.articles).sort()) !==
      JSON.stringify([...ARTICLE_IDS].sort())
    )
      errors.push(`${locale.code}: article IDs differ`);
    const reference = resourceCopies.en!;
    const localized = [
      ...resources.headings,
      ...Object.values(resources.categories),
    ];
    const original = [
      ...reference.headings,
      ...Object.values(reference.categories),
    ];
    for (const id of ARTICLE_IDS) {
      const article = resources.articles[id];
      if (!article || article.length !== 4) {
        errors.push(`${locale.code}.${id}: incomplete article`);
        continue;
      }
      if (article[2].length < 50 || article[3].length < 50)
        errors.push(`${locale.code}.${id}: insufficient body`);
      localized.push(...article);
      original.push(...reference.articles[id]);
    }
    localized.forEach((value, index) => {
      if (!value?.trim())
        errors.push(`${locale.code}: empty resource field ${index}`);
      if (damaged.test(value))
        errors.push(`${locale.code}: damaged resource field ${index}`);
      if (
        locale.code !== "en" &&
        (value === original[index] || !scripts[locale.code].test(value))
      )
        errors.push(`${locale.code}: untranslated resource field ${index}`);
      if (locale.code !== "en" && unexpectedLatin(value))
        errors.push(
          `${locale.code}: unexpected English or malformed resource fragment ${index}`,
        );
    });
  }
  return errors;
}
