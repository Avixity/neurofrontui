export const LOCALES = [
  { code: "en", nativeName: "English", englishName: "English", dir: "ltr" },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi", dir: "ltr" },
  { code: "pa", nativeName: "ਪੰਜਾਬੀ", englishName: "Punjabi", dir: "ltr" },
  { code: "bn", nativeName: "বাংলা", englishName: "Bengali", dir: "ltr" },
  { code: "mr", nativeName: "मराठी", englishName: "Marathi", dir: "ltr" },
  { code: "gu", nativeName: "ગુજરાતી", englishName: "Gujarati", dir: "ltr" },
  { code: "ta", nativeName: "தமிழ்", englishName: "Tamil", dir: "ltr" },
  { code: "te", nativeName: "తెలుగు", englishName: "Telugu", dir: "ltr" },
  { code: "kn", nativeName: "ಕನ್ನಡ", englishName: "Kannada", dir: "ltr" },
  { code: "ml", nativeName: "മലയാളം", englishName: "Malayalam", dir: "ltr" },
  { code: "or", nativeName: "ଓଡ଼ିଆ", englishName: "Odia", dir: "ltr" },
  { code: "as", nativeName: "অসমীয়া", englishName: "Assamese", dir: "ltr" },
  { code: "ur", nativeName: "اردو", englishName: "Urdu", dir: "rtl" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];
export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && LOCALES.some((locale) => locale.code === value)
  );
}
export function localeDirection(locale: Locale): "ltr" | "rtl" {
  return locale === "ur" ? "rtl" : "ltr";
}
