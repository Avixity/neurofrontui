# Interface languages and educational content

The dashboard includes 13 complete language dictionaries: English, हिन्दी, ਪੰਜਾਬੀ, বাংলা, मराठी, ગુજરાતી, தமிழ், తెలుగు, ಕನ್ನಡ, മലയാളം, ଓଡ଼ିଆ, অসমীয়া and اردو. Each contains the same 265 typed interface keys. Urdu has `dir: 'rtl'`; all other locales use `ltr`. Language choices use native names.

There are nine guides in each language, for 117 article variants. Titles, summaries, section headings, categories and body paragraphs are localized. Source titles retain their original bibliographic names so readers can identify the linked publication or code file. Component names and protocol abbreviations such as NeuroFront, Bluetooth, AD8232 and GSR remain recognizable across languages.

## API and editing

`src/i18n/en.ts` defines the key catalog. Every other dictionary is a `Record<TranslationKey, string>`. Add a key to all 13 dictionaries in the same change. `createTranslator(locale)(key, params)` and `t(locale, key, params)` throw for missing keys or interpolation parameters; they do not silently substitute English. Number interpolation uses a cached `Intl.NumberFormat` for the selected locale. Set the document's language and direction from `LOCALES` / `localeDirection` when the selection changes.

English interface text and articles are available synchronously. All other language packs use dynamic imports. Before changing the active locale, await `loadLocale(locale)` from `src/i18n`; it loads both the dictionary and matching articles. `isLocaleLoaded(locale)` can guard startup with a saved preference or restored profile. Synchronous translation and article APIs require the pack to be loaded. Concurrent requests share a pending promise; a failed load is cleared so the user can retry. A language download never substitutes an English dictionary for the requested locale.

`getArticles(locale)` returns the nine guides in narrative order. `getArticle(locale, id)` returns a single guide, or `undefined` for an unknown ID. IDs and category codes are stable; `categoryLabel` and all reading content are localized. The reading-time label is an approximate one-minute guide length, not measured reading behavior.

The article IDs are `what-neurofront-measures`, `personal-baseline`, `preparing-a-measurement`, `signal-quality`, `sensor-channels`, `experimental-score`, `comparing-baseline`, `reading-history` and `troubleshooting`.

## Factual boundaries

Content follows the checked-in acquisition, calculation and device parser, rather than earlier project ambitions:

- The physical prototype uses a wired fabric headband and separate controller. AD8232 is an electrical-signal/ECG front end, not an EEG or thought-reading sensor.
- Calibration begins its 20-second window when recording is started. Samples use browser receipt timestamps. Capture lasts 15 seconds; elapsed time without usable samples does not create a valid recording.
- The current Bluetooth parser uses only the first numeric field. Temperature and GSR show that they are waiting for received data. They are not generated from the primary signal.
- Activity uses standard deviation, peak-to-peak range and mean absolute successive change, with weights 0.50, 0.35 and 0.15. The denominator is the larger of baseline activity and 1. The result is clamped to 0–100. Equal activity maps to 50 only when the denominator minimum has no effect; two constant signals can produce 12.
- The score is an experimental comparison. It is not a stress percentage, trained-model prediction, validated clinical threshold or diagnosis. A spike does not prove stress; a flat trace does not prove relaxation.
- Historical results retain their baseline snapshot and calculation version. Display controls do not change acquisition. Simulated input must remain distinguishable from physical measurements.

## Sources

Each guide links the supporting local implementation's public repository path, plus external primary/reference material where relevant. Source-file links refer to this revision's eventual published files; they are not a claim that unpublished changes are already on GitHub.

- [Analog Devices: AD8232](https://www.analog.com/en/products/ad8232.html) — front-end purpose, electrical signal conditioning, interference and motion context.
- [NHLBI: Heart Tests](https://www.nhlbi.nih.gov/health/heart-tests) — what an ECG records. This does not validate NeuroFront's placement or output as a clinical ECG.
- [Ho, Toska and Wesche, 2020](https://www.frontiersin.org/journals/neurology/articles/10.3389/fneur.2020.00051/full) — original research on skin conductance and cardiovascular responses to several stimuli. It does not establish a NeuroFront stress classifier or its accuracy.
- [MDN: Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API) — supported browser/platform and permission limitations.
- `src/core/acquisition.ts`, `src/core/calculation.ts`, `src/core/device.ts` and `src/types.ts` — actual timing, score formula, received channels and stored snapshots.

## Validation and limits

Run `npm run check:i18n` and `npx vitest run tests/i18n.test.ts tests/i18n-loading.test.ts`. The checks enforce exact key coverage, complete article IDs, nonempty native-script text, matching interpolation fields, no unexpected English fragments, no damaged temporary tokens, Urdu RTL metadata, source URL shape and preservation of important numeric limits. They also test explicit missing-key failure, substituted values and loading only the requested language's interface and articles.

The translation pass used machine-assisted drafts followed by targeted editorial correction of action labels, recording language, deletion confirmation, graph behavior, score mathematics and malformed Odia fragments. Only generic interface/project text was used in drafting; no account data or readings were involved. These checks do not certify idiomatic fluency. A native-speaker proofreading pass for every language remains advisable, particularly for regional terminology and longer explanatory paragraphs. No professional translation review, clinical review or browser layout validation is claimed by the language tests.
