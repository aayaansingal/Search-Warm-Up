// Options page: edit decoy queries and timing.

import { DEFAULT_SETTINGS, loadSettings } from "./defaults.js";
import { GOOGLE_DOMAINS } from "./google-domains.js";

const googleDomainField = document.getElementById("google-domain");
const decoyQueriesField = document.getElementById("decoy-queries");
const minPauseField = document.getElementById("min-pause");
const maxPauseField = document.getElementById("max-pause");
const minKeystrokeField = document.getElementById("min-keystroke");
const maxKeystrokeField = document.getElementById("max-keystroke");
const statusText = document.getElementById("status");

// Fill the domain dropdown, with google.com first and the rest alphabetical.
function populateDomainOptions() {
  const sortedDomains = [...GOOGLE_DOMAINS].sort((first, second) => {
    if (first === DEFAULT_SETTINGS.googleDomain) return -1;
    if (second === DEFAULT_SETTINGS.googleDomain) return 1;
    return first.localeCompare(second);
  });

  for (const domain of sortedDomains) {
    const option = document.createElement("option");
    option.value = domain;
    option.textContent = domain.replace(/^www\./, "");
    googleDomainField.appendChild(option);
  }
}

function showSettings(settings) {
  googleDomainField.value = settings.googleDomain;
  decoyQueriesField.value = settings.decoyQueries.join("\n");
  minPauseField.value = settings.minPauseMs;
  maxPauseField.value = settings.maxPauseMs;
  minKeystrokeField.value = settings.minKeystrokeMs;
  maxKeystrokeField.value = settings.maxKeystrokeMs;
}

function readNonNegativeNumber(field, fallback) {
  const value = Number(field.value);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readSettingsFromForm() {
  const decoyQueries = decoyQueriesField.value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  let minPauseMs = readNonNegativeNumber(minPauseField, DEFAULT_SETTINGS.minPauseMs);
  let maxPauseMs = readNonNegativeNumber(maxPauseField, DEFAULT_SETTINGS.maxPauseMs);
  let minKeystrokeMs = readNonNegativeNumber(minKeystrokeField, DEFAULT_SETTINGS.minKeystrokeMs);
  let maxKeystrokeMs = readNonNegativeNumber(maxKeystrokeField, DEFAULT_SETTINGS.maxKeystrokeMs);

  // Keep each min <= max so the random delays stay within the chosen range.
  if (minPauseMs > maxPauseMs) {
    [minPauseMs, maxPauseMs] = [maxPauseMs, minPauseMs];
  }
  if (minKeystrokeMs > maxKeystrokeMs) {
    [minKeystrokeMs, maxKeystrokeMs] = [maxKeystrokeMs, minKeystrokeMs];
  }

  return {
    googleDomain: googleDomainField.value,
    decoyQueries: decoyQueries.length > 0 ? decoyQueries : DEFAULT_SETTINGS.decoyQueries,
    minPauseMs: minPauseMs,
    maxPauseMs: maxPauseMs,
    minKeystrokeMs: minKeystrokeMs,
    maxKeystrokeMs: maxKeystrokeMs,
  };
}

function flashStatus(message) {
  statusText.textContent = message;
  setTimeout(() => {
    statusText.textContent = "";
  }, 1500);
}

document.getElementById("save-button").addEventListener("click", async () => {
  const settings = readSettingsFromForm();
  await chrome.storage.sync.set(settings);
  showSettings(settings);
  flashStatus("Saved.");
});

document.getElementById("reset-button").addEventListener("click", async () => {
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  showSettings(DEFAULT_SETTINGS);
  flashStatus("Defaults restored.");
});

populateDomainOptions();
loadSettings().then(showSettings);
