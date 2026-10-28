// Default settings shared by the background worker and the options page.
// Stored in chrome.storage.sync so they follow the user across devices.
// Settings never contain search queries, only decoys and timing.

import { GOOGLE_DOMAINS } from "./google-domains.js";

export const DEFAULT_SETTINGS = {
  // Which Google site the warm-up runs on, e.g. "www.google.co.uk".
  googleDomain: "www.google.com",

  // Harmless queries used for the warm-up steps. One is picked at random per step.
  decoyQueries: ["hi", "hello", "weather", "asdf", "time", "news", "maps", "asdfjkl;", "bro", "chess", "red", "why", "ok", "no"],

  // Pause before the extension starts typing on each results page (milliseconds).
  minPauseMs: 700,
  maxPauseMs: 1500,

  // Delay between simulated keystrokes (milliseconds).
  minKeystrokeMs: 40,
  maxKeystrokeMs: 120,
};

export async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const decoyQueries = (stored.decoyQueries || []).filter((query) => query.trim() !== "");

  // Never run with an empty decoy list; fall back to the defaults instead.
  if (decoyQueries.length === 0) {
    stored.decoyQueries = DEFAULT_SETTINGS.decoyQueries;
  } else {
    stored.decoyQueries = decoyQueries;
  }

  // Only allow domains the content script is registered on.
  if (!GOOGLE_DOMAINS.includes(stored.googleDomain)) {
    stored.googleDomain = DEFAULT_SETTINGS.googleDomain;
  }
  return stored;
}
