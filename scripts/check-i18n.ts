import { validateTranslations } from "../src/i18n/validate";
import { loadLocale, LOCALES } from "../src/i18n";
import { en } from "../src/i18n/en";
import { ARTICLE_IDS } from "../src/content";

await Promise.all(LOCALES.map((locale) => loadLocale(locale.code)));
const errors = validateTranslations();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `${LOCALES.length} locales × ${Object.keys(en).length} interface keys and ${ARTICLE_IDS.length} articles: complete; placeholders and native scripts checked.`,
  );
}
