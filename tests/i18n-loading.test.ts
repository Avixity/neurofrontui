import { expect, it } from "vitest";
import { dictionaries, isLocaleLoaded, loadLocale, t } from "../src/i18n";
import { getArticles, resourceCopies } from "../src/content";

it("keeps unselected language packs unloaded and loads interface plus articles together", async () => {
  expect(Object.keys(dictionaries)).toEqual(["en"]);
  expect(Object.keys(resourceCopies)).toEqual(["en"]);
  expect(isLocaleLoaded("en")).toBe(true);
  expect(isLocaleLoaded("ta")).toBe(false);
  expect(() => t("ta", "nav.measure")).toThrow("Missing translation");
  expect(() => getArticles("ta")).toThrow("Article locale has not been loaded");
  await Promise.all([loadLocale("ta"), loadLocale("ta")]);
  expect(isLocaleLoaded("ta")).toBe(true);
  expect(t("ta", "nav.measure")).toBe("அளவிடு");
  expect(getArticles("ta")).toHaveLength(9);
  expect(isLocaleLoaded("ur")).toBe(false);
  expect(Object.keys(dictionaries).sort()).toEqual(["en", "ta"]);
});
