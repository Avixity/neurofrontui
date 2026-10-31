import type { TranslationKey } from "./en";
export type Dictionary = Record<TranslationKey, string>;
export type TranslationParams = Record<string, string | number>;
export type Translator = (
  key: TranslationKey,
  params?: TranslationParams,
) => string;
