// Background service worker: owns the warm-up state for each tab.
//
// The warm-up sequence for one real query is:
//   1. Omnibox step   - the tab is sent to a Google results page for a decoy query
//                       instead of the real one.
//   2. Search-box step - on that page, a second decoy is typed into Google's own
//                       search box and submitted.
//   3. Real step      - on the second page, the real query is typed into the
//                       search box and submitted.
//
// Steps 2 and 3 use a two-phase handshake with the content script: it first
// "peeks" at the task (nothing changes), types it, then "commits" right before
// submitting. If anything fails before the commit, the state is untouched and
// reloading the page retries the same step.
//
// Privacy: the real query is held only in chrome.storage.session, which lives
// in memory (never written to disk), is unreadable by content scripts and web
// pages, and is cleared when the browser closes. It is deleted once the final
// step is committed, when the tab navigates away from the sequence, or by an
// alarm once the warm-up times out. It is never logged or sent anywhere except
// to Google.

import { loadSettings } from "./defaults.js";
import { GOOGLE_DOMAINS } from "./google-domains.js";

// A warm-up that has not progressed in this long is treated as abandoned.
const WARMUP_TIMEOUT_MINUTES = 2;
const WARMUP_TIMEOUT_MS = WARMUP_TIMEOUT_MINUTES * 60 * 1000;
const EXPIRY_ALARM_PREFIX = "warmup-expiry:";

const STAGE_SEARCHBOX_DECOY = "searchbox-decoy";
const STAGE_REAL_QUERY = "real-query";

// Hosts that serve Google's CAPTCHA ("sorry") page besides the search domains.
const EXTRA_CAPTCHA_HOSTS = ["ipv4.google.com", "ipv6.google.com"];

// Resolves once the most recent startWarmup call has saved its state, so
// navigation events and content-script requests never see a half-started warm-up.
let pendingStart = Promise.resolve();

// ---------------------------------------------------------------------------
// Warm-up state helpers
// ---------------------------------------------------------------------------
//
// State shape, per tab:
//   realQuery          the user's actual query
//   stage              which step the content script performs next
//   expectedPageQuery  the `q` of the results page that step must run on
//   previousPageQuery  the `q` of the page the last committed step ran on; the
//                      tab is still showing it until the next page commits
//   queryToType        what that step types (a decoy, or the real query)
//   isArmed            true once the tab has reached the first decoy page; only
//                      then do unrelated navigations cancel the warm-up
//   updatedAt          timestamp of the last change, for the timeout

function stateKey(tabId) {
  return `warmup:${tabId}`;
}

async function getWarmupState(tabId) {
  const key = stateKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] || null;
}

// Saving state also (re)schedules its expiry, so an abandoned warm-up's query
// is wiped on time rather than lingering until the tab or browser closes.
async function setWarmupState(tabId, warmupState) {
  await chrome.storage.session.set({ [stateKey(tabId)]: warmupState });
  await chrome.alarms.create(`${EXPIRY_ALARM_PREFIX}${tabId}`, { delayInMinutes: WARMUP_TIMEOUT_MINUTES });
}

async function clearWarmupState(tabId) {
  await chrome.storage.session.remove(stateKey(tabId));
  await chrome.alarms.clear(`${EXPIRY_ALARM_PREFIX}${tabId}`);
}

// Returns the tab's live warm-up state, clearing it first if it has timed out.
async function getActiveWarmupState(tabId) {
  await pendingStart;
  const warmupState = await getWarmupState(tabId);
  if (!warmupState) {
    return null;
  }

  const isExpired = Date.now() - warmupState.updatedAt > WARMUP_TIMEOUT_MS;
  if (isExpired) {
    await clearWarmupState(tabId);
    return null;
  }
  return warmupState;
}

function pickDecoy(decoyQueries, avoidQuery) {
  // Prefer a decoy different from the previous one, when the list allows it.
  const candidates = decoyQueries.filter((query) => query !== avoidQuery);
  const pool = candidates.length > 0 ? candidates : decoyQueries;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------------------------
// Step 1: start a warm-up from the omnibox or the popup
// ---------------------------------------------------------------------------

async function runStartWarmup(realQuery, tabId, openInNewTab) {
  const settings = await loadSettings();
  const omniboxDecoy = pickDecoy(settings.decoyQueries, null);
  const searchboxDecoy = pickDecoy(settings.decoyQueries, omniboxDecoy);
  const decoyUrl = `https://${settings.googleDomain}/search?q=${encodeURIComponent(omniboxDecoy)}`;

  let targetTabId = tabId;
  if (openInNewTab || targetTabId === undefined) {
    const newTab = await chrome.tabs.create({ url: "about:blank", active: true });
    targetTabId = newTab.id;
  }

  // Save state before navigating so the content script finds it on load.
  await setWarmupState(targetTabId, {
    realQuery: realQuery,
    stage: STAGE_SEARCHBOX_DECOY,
    expectedPageQuery: omniboxDecoy,
    previousPageQuery: null,
    queryToType: searchboxDecoy,
    isArmed: false,
    updatedAt: Date.now(),
  });

  return { targetTabId: targetTabId, decoyUrl: decoyUrl };
}

async function startWarmup(realQuery, tabId, openInNewTab) {
  const startPromise = runStartWarmup(realQuery, tabId, openInNewTab);
  pendingStart = startPromise.catch(() => {});

  const { targetTabId, decoyUrl } = await startPromise;
  await chrome.tabs.update(targetTabId, { url: decoyUrl });
}

chrome.omnibox.setDefaultSuggestion({
  description: "Search Google with CAPTCHA warm-up: %s",
});

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const realQuery = text.trim();
  if (realQuery === "") {
    return;
  }

  const openInNewTab = disposition !== "currentTab";
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await startWarmup(realQuery, activeTab ? activeTab.id : undefined, openInNewTab);
});

// ---------------------------------------------------------------------------
// Steps 2 and 3: peek / commit handshake with the content script
// ---------------------------------------------------------------------------

async function peekTask(tabId, pageQuery) {
  const warmupState = await getActiveWarmupState(tabId);
  if (!warmupState) {
    return { action: "none" };
  }

  // A results page for anything other than the expected query means the user
  // went their own way, so the warm-up is abandoned.
  if (pageQuery !== warmupState.expectedPageQuery) {
    await clearWarmupState(tabId);
    return { action: "none" };
  }

  if (!warmupState.isArmed) {
    await setWarmupState(tabId, { ...warmupState, isArmed: true });
  }

  const settings = await loadSettings();
  return {
    action: "type",
    stage: warmupState.stage,
    query: warmupState.queryToType,
    timing: {
      minPauseMs: settings.minPauseMs,
      maxPauseMs: settings.maxPauseMs,
      minKeystrokeMs: settings.minKeystrokeMs,
      maxKeystrokeMs: settings.maxKeystrokeMs,
    },
  };
}

// Called right before the content script submits. Advances the sequence only
// if the tab is still on the same step it peeked.
async function commitTask(tabId, pageQuery, stage) {
  const warmupState = await getActiveWarmupState(tabId);
  const isSameStep = warmupState !== null
    && warmupState.stage === stage
    && warmupState.expectedPageQuery === pageQuery;

  if (!isSameStep) {
    return { ok: false };
  }

  if (stage === STAGE_SEARCHBOX_DECOY) {
    await setWarmupState(tabId, {
      ...warmupState,
      stage: STAGE_REAL_QUERY,
      previousPageQuery: warmupState.expectedPageQuery,
      expectedPageQuery: warmupState.queryToType,
      queryToType: warmupState.realQuery,
      updatedAt: Date.now(),
    });
    return { ok: true };
  }

  // Final step: the real query is about to be submitted, so nothing is left to keep.
  await clearWarmupState(tabId);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "peekTask" && sender.tab) {
    peekTask(sender.tab.id, message.pageQuery).then(sendResponse);
    return true; // keep the channel open for the async response
  }

  if (message.type === "commitTask" && sender.tab) {
    commitTask(sender.tab.id, message.pageQuery, message.stage).then(sendResponse);
    return true;
  }

  if (message.type === "startWarmup") {
    startWarmup(message.query, message.tabId, message.openInNewTab).then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Cancelling abandoned warm-ups
// ---------------------------------------------------------------------------

// Sorts a URL the tab is on (or heading to) into one of:
//   "expected"  - the results page the current step should run on
//   "previous"  - the page the last committed step ran on; the tab legitimately
//                 reports it until the next page replaces it
//   "captcha"   - Google's CAPTCHA page, which redirects back once solved
//   "unrelated" - anything else
// A URL is only visible here for sites the extension has host access to
// (Google search and CAPTCHA pages); any other site arrives as undefined,
// which also counts as unrelated.
function classifyNavigation(url, warmupState) {
  if (!url) {
    return "unrelated";
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return "unrelated";
  }

  const isGoogleHost = GOOGLE_DOMAINS.includes(parsedUrl.hostname);
  const isCaptchaHost = isGoogleHost || EXTRA_CAPTCHA_HOSTS.includes(parsedUrl.hostname);

  if (isCaptchaHost && parsedUrl.pathname.startsWith("/sorry/")) {
    return "captcha";
  }
  if (isGoogleHost && parsedUrl.pathname === "/search") {
    const pageQuery = parsedUrl.searchParams.get("q") || "";
    if (pageQuery === warmupState.expectedPageQuery) {
      return "expected";
    }
    if (pageQuery === warmupState.previousPageQuery) {
      return "previous";
    }
  }
  return "unrelated";
}

// Picks the URL from a tabs.onUpdated event that can be trusted to describe
// where the tab is or is going, or returns { isKnown: false } when there is none.
//   - changeInfo.url is the new address whenever it changes (if visible).
//   - While loading, tab.pendingUrl is the destination (if visible).
//   - Once loading completes, tab.url is the page actually shown, and is
//     undefined for sites the extension cannot see.
// tab.url during "loading" is deliberately ignored: it can still be the
// previous page, which would make a valid warm-up look abandoned.
function getReliableUrl(changeInfo, tab) {
  if (changeInfo.url) {
    return { isKnown: true, url: changeInfo.url };
  }
  if (changeInfo.status === "loading" && tab.pendingUrl) {
    return { isKnown: true, url: tab.pendingUrl };
  }
  if (changeInfo.status === "complete") {
    return { isKnown: true, url: tab.url };
  }
  return { isKnown: false };
}

async function handleTabNavigation(tabId, url) {
  const warmupState = await getActiveWarmupState(tabId);
  if (!warmupState) {
    return;
  }

  const navigationKind = classifyNavigation(url, warmupState);

  if (navigationKind === "expected") {
    if (!warmupState.isArmed) {
      await setWarmupState(tabId, { ...warmupState, isArmed: true });
    }
    return;
  }

  // Before the first decoy page loads, the tab may still pass through blank or
  // new-tab pages, so only an armed warm-up is cancelled by unrelated pages.
  if (navigationKind === "unrelated" && warmupState.isArmed) {
    await clearWarmupState(tabId);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const reliableUrl = getReliableUrl(changeInfo, tab);
  if (reliableUrl.isKnown) {
    handleTabNavigation(tabId, reliableUrl.url);
  }
});

// Drop state for tabs that are closed mid-warm-up.
chrome.tabs.onRemoved.addListener((tabId) => {
  clearWarmupState(tabId);
});

// Wipe state for warm-ups that timed out.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(EXPIRY_ALARM_PREFIX)) {
    const tabId = Number(alarm.name.slice(EXPIRY_ALARM_PREFIX.length));
    clearWarmupState(tabId);
  }
});
