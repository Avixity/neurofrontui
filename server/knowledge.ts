import { en } from "../src/content/en";
import { ARTICLE_IDS } from "../src/content/types";

const navigation = [
  "Overview shows device state, the active baseline, recent sessions and a shortcut to start a measurement.",
  "Measure connects to the device, records a new resting baseline or selects a saved compatible baseline, then starts a capture. The tab must remain active during recording.",
  "Baseline choices include a fresh calibration and previously saved compatible baselines. Compatibility depends on the device/source, setup, protocol, units and calculation/acquisition versions. Settings lists baseline versions and can load older pages. A baseline used by a measurement cannot be removed until those measurements are removed.",
  "Graph settings select visible primary, temperature, GSR and baseline traces. They only change presentation; they never reconnect Bluetooth, start a recording, synthesize samples or alter the score.",
  "History shows captured data with its exact original baseline snapshot, timestamp, source, quality, notes and tags. Completed traces are stored readings, not a newly generated illustration. Users can review the overlay and export PNG or CSV.",
  "Learn contains the project guides listed below and account bookmarks. Refer to a guide by its title and article ID; do not invent a browser URL or claim to navigate for the user.",
  "The Assistant receives a measurement only when the user explicitly attaches it. Signed-in attachments must be saved measurements from that account. Guests may attach a bounded local summary. Saving chat is opt-in.",
  "Profile and Settings control display name, language, time zone, graph preferences, baselines, data export and deletion. Guest recordings stay in the current tab; signing in prompts an explicit transfer or discard decision and never uploads them automatically. Cloud save failures leave unsaved captures in memory for retry/export.",
];

export const projectKnowledge = JSON.stringify({
  navigation,
  articles: ARTICLE_IDS.slice(0, 12).map((id) => {
    const [title, summary, idea, practice] = en.articles[id];
    return {
      id,
      title: title.slice(0, 160),
      summary: summary.slice(0, 300),
      text: `${idea}\n${practice}`.slice(0, 1600),
    };
  }),
});
