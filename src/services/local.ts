import type {
  Baseline,
  GraphVisibility,
  Measurement,
  Preferences,
} from "../types";
import { DEFAULT_GRAPHS } from "../types";
const GUEST_KEY = "neurofront.guest.v2",
  PREF_KEY = "neurofront.preferences.v2";
export const defaultPreferences = (): Preferences => ({
  language: "en",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
  graphs: { ...DEFAULT_GRAPHS },
  saveChat: false,
});
export function guestPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    return {
      ...defaultPreferences(),
      ...saved,
      graphs: { ...DEFAULT_GRAPHS, ...saved.graphs },
    };
  } catch {
    return defaultPreferences();
  }
}
export function savePreferences(preferences: Preferences) {
  try {
    localStorage.setItem(
      PREF_KEY,
      JSON.stringify({ ...preferences, saveChat: false }),
    );
  } catch {
    /* Preferences are optional when storage is unavailable. */
  }
}
export type GuestSession = {
  baselines: Baseline[];
  measurements: Measurement[];
  activeBaselineId: string | null;
};
export function readGuest(): GuestSession {
  try {
    const value = JSON.parse(sessionStorage.getItem(GUEST_KEY) || "null");
    if (
      value &&
      Array.isArray(value.baselines) &&
      Array.isArray(value.measurements)
    )
      return value;
  } catch {
    /* A fresh tab remains usable. */
  }
  return { baselines: [], measurements: [], activeBaselineId: null };
}
export function saveGuest(data: GuestSession) {
  try {
    sessionStorage.setItem(GUEST_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
export function clearGuest() {
  sessionStorage.removeItem(GUEST_KEY);
}
export function sameGraphs(a: GraphVisibility, b: GraphVisibility) {
  return (Object.keys(a) as (keyof GraphVisibility)[]).every(
    (key) => a[key] === b[key],
  );
}
