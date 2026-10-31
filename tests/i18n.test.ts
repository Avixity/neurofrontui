import { beforeAll, describe, expect, it } from "vitest";
import {
  createTranslator,
  dictionaries,
  isLocale,
  isLocaleLoaded,
  loadLocale,
  localeDirection,
  LOCALES,
  t,
  type TranslationKey,
} from "../src/i18n";
import { validateTranslations } from "../src/i18n/validate";
import { ARTICLE_IDS, getArticle, getArticles } from "../src/content";

describe("localized interface and resources", () => {
  beforeAll(async () => {
    await Promise.all(LOCALES.map((locale) => loadLocale(locale.code)));
  });
  it("loads both interface and guide content before a language switch", async () => {
    await Promise.all([loadLocale("ur"), loadLocale("ur")]);
    expect(isLocaleLoaded("ur")).toBe(true);
    expect(createTranslator("ur")("nav.learn")).toBeTruthy();
    expect(getArticles("ur")).toHaveLength(9);
  });
  it("provides every key and complete article in all 13 languages", () => {
    expect(LOCALES).toHaveLength(13);
    expect(validateTranslations()).toEqual([]);
  });
  it("preserves interpolation fields and substitutes actual values", () => {
    for (const { code } of LOCALES) {
      expect(
        createTranslator(code)("overview.greeting", { name: "Asha" }),
      ).toContain("Asha");
      const remaining = t(code, "measure.remaining", { count: 15 });
      expect(remaining).not.toContain("{count}");
      expect(remaining).toContain(new Intl.NumberFormat(code).format(15));
    }
  });
  it("fails explicitly for missing keys or arguments instead of falling back to English", () => {
    expect(() => t("hi", "unknown.key" as TranslationKey)).toThrow(
      "Missing translation",
    );
    expect(() => t("ur", "overview.greeting")).toThrow(
      "Missing translation parameter",
    );
  });
  it("uses Urdu right-to-left and preserves language codes", () => {
    expect(localeDirection("ur")).toBe("rtl");
    expect(
      LOCALES.filter((locale) => locale.dir === "rtl").map(
        (locale) => locale.code,
      ),
    ).toEqual(["ur"]);
    expect(isLocale("or")).toBe(true);
    expect(isLocale("odia")).toBe(false);
  });
  it("returns all nine distinct localized articles with working citation shapes", () => {
    for (const { code } of LOCALES) {
      const articles = getArticles(code);
      expect(articles.map((article) => article.id)).toEqual(ARTICLE_IDS);
      expect(new Set(articles.map((article) => article.title)).size).toBe(9);
      for (const article of articles) {
        expect(article.sections).toHaveLength(2);
        expect(article.sources.length).toBeGreaterThan(0);
        article.sources.forEach((source) =>
          expect(new URL(source.url).protocol).toBe("https:"),
        );
      }
    }
    expect(getArticle("en", "not-an-article")).toBeUndefined();
  });
  it("preserves numeric limits and the activity-floor explanation", () => {
    for (const { code } of LOCALES) {
      expect(dictionaries[code]!["measure.bufferLimit"]).toMatch(
        /20[,.\s]?000/,
      );
      const score = getArticle(code, "experimental-score")!;
      const content = score.sections
        .flatMap((section) => section.paragraphs)
        .join(" ");
      expect(content).toContain("12");
      expect(content).toContain("50");
      expect(content).toContain("0.35");
      expect(content).toContain("0.15");
    }
  });
});
