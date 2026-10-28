// Simulation tests for the background worker's warm-up logic.
//
// Usage: node tests/background.test.mjs   (requires Node 18+)
//
// Replaces the browser's `chrome` API with a small in-memory fake, loads the
// real src/background.js, and replays warm-up scenarios: the normal sequence,
// a CAPTCHA partway through, failed steps, abandoned warm-ups, and the
// out-of-order navigation events real browsers send.
// It does not test Google's real pages; see README "Testing" for the manual test.

// ---------------------------------------------------------------------------
// Fake browser
// ---------------------------------------------------------------------------

const sessionStorage = {};
const eventListeners = {};
const tabUrls = {};
let nextTabId = 100;

// When set, the next tabs.update navigation is held back so a test can send
// events that a real browser might deliver before it.
let holdNextNavigation = false;
let heldNavigation = null;

function fakeEvent(name) {
  return { addListener: (listener) => { eventListeners[name] = listener; } };
}

// The extension can only see URLs it has host access to: Google results and
// CAPTCHA pages. Everything else is reported as undefined, as in a real browser.
function visibleUrl(url) {
  const isVisible = /^https:\/\/(www\.google\.[a-z.]+|ipv[46]\.google\.com)\/(search|sorry\/)/.test(url || "");
  return isVisible ? url : undefined;
}

// Lets the background's async handlers finish before the next step.
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

async function fireTabUpdated(tabId, changeInfo, tabFields) {
  eventListeners.tabUpdated(tabId, changeInfo, { id: tabId, ...tabFields });
  await settle();
}

// Replays the events a browser sends for one navigation:
//   1. "loading" - tab.url may still be the OLD page; pendingUrl (if the browser
//      provides it) is the destination
//   2. URL change - changeInfo.url is the new page
//   3. "complete" - tab.url is the new page
async function navigateTab(tabId, newUrl, { providePendingUrl = true } = {}) {
  const oldUrl = tabUrls[tabId];
  await fireTabUpdated(tabId, { status: "loading" }, {
    url: visibleUrl(oldUrl),
    pendingUrl: providePendingUrl ? visibleUrl(newUrl) : undefined,
  });

  tabUrls[tabId] = newUrl;
  if (visibleUrl(newUrl)) {
    await fireTabUpdated(tabId, { url: newUrl }, { url: newUrl });
  }
  await fireTabUpdated(tabId, { status: "complete" }, { url: visibleUrl(newUrl) });
}

globalThis.chrome = {
  storage: {
    session: {
      get: async (key) => (key in sessionStorage ? { [key]: structuredClone(sessionStorage[key]) } : {}),
      set: async (entries) => { Object.assign(sessionStorage, structuredClone(entries)); },
      remove: async (key) => { delete sessionStorage[key]; },
    },
    sync: { get: async (defaults) => ({ ...defaults, decoyQueries: ["weather", "news"] }) },
  },
  alarms: { create: async () => {}, clear: async () => {}, onAlarm: fakeEvent("alarm") },
  omnibox: { setDefaultSuggestion() {}, onInputEntered: fakeEvent("omnibox") },
  tabs: {
    // A new tab starts on a blank page the extension cannot see.
    create: async () => {
      const tabId = nextTabId;
      nextTabId += 1;
      tabUrls[tabId] = "about:blank";
      fireTabUpdated(tabId, { status: "loading" }, {});
      return { id: tabId };
    },
    update: async (tabId, { url }) => {
      if (holdNextNavigation) {
        holdNextNavigation = false;
        heldNavigation = () => navigateTab(tabId, url);
        return;
      }
      await navigateTab(tabId, url);
    },
    query: async () => [],
    onUpdated: fakeEvent("tabUpdated"),
    onRemoved: fakeEvent("tabRemoved"),
  },
  runtime: { onMessage: fakeEvent("message") },
};

await import(new URL("../src/background.js", import.meta.url));

// ---------------------------------------------------------------------------
// Helpers for driving the extension
// ---------------------------------------------------------------------------

function sendMessage(message, sender) {
  return new Promise((resolve) => eventListeners.message(message, sender, resolve));
}

// Starts a warm-up in a new tab and returns that tab's id.
async function startWarmup(realQuery) {
  const tabId = nextTabId;
  await sendMessage({ type: "startWarmup", query: realQuery, openInNewTab: true }, {});
  await settle();
  return tabId;
}

function peekTask(tabId, pageQuery) {
  return sendMessage({ type: "peekTask", pageQuery: pageQuery }, { tab: { id: tabId } });
}

function commitTask(tabId, pageQuery, stage) {
  return sendMessage({ type: "commitTask", pageQuery: pageQuery, stage: stage }, { tab: { id: tabId } });
}

function warmupStateOf(tabId) {
  return sessionStorage[`warmup:${tabId}`];
}

function searchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

let failureCount = 0;
function check(label, condition) {
  if (!condition) {
    failureCount += 1;
  }
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

// A: full sequence, with a CAPTCHA between steps 2 and 3.
{
  const tabId = await startWarmup("secret query");
  const firstDecoy = warmupStateOf(tabId).expectedPageQuery;

  const firstTask = await peekTask(tabId, firstDecoy);
  check("A: peek returns the decoy step without consuming it", firstTask.action === "type" && warmupStateOf(tabId).stage === "searchbox-decoy");
  const repeatedTask = await peekTask(tabId, firstDecoy);
  check("A: peeking again (page reload) returns the same task", repeatedTask.query === firstTask.query);

  check("A: step 2 commits", (await commitTask(tabId, firstDecoy, firstTask.stage)).ok);
  await navigateTab(tabId, "https://www.google.com/sorry/index?continue=x");
  check("A: CAPTCHA page keeps the warm-up alive", Boolean(warmupStateOf(tabId)));
  await navigateTab(tabId, searchUrl(firstTask.query));

  const finalTask = await peekTask(tabId, firstTask.query);
  check("A: final step types the real query", finalTask.query === "secret query");
  check("A: final step commits", (await commitTask(tabId, firstTask.query, finalTask.stage)).ok);
  check("A: real query is deleted after the final commit", !warmupStateOf(tabId));
}

// B: the page gives up before committing, so a reload can retry the step.
{
  const tabId = await startWarmup("query b");
  const firstDecoy = warmupStateOf(tabId).expectedPageQuery;
  await peekTask(tabId, firstDecoy); // content script then fails, never commits
  const retriedTask = await peekTask(tabId, firstDecoy);
  check("B: after a failed attempt, a reload retries the same step", retriedTask.action === "type" && retriedTask.stage === "searchbox-decoy");
}

// C: abandoned warm-up, unrelated search, then a manual search for the decoy.
{
  const tabId = await startWarmup("query c");
  const firstDecoy = warmupStateOf(tabId).expectedPageQuery;
  await navigateTab(tabId, searchUrl("something else"));
  check("C: an unrelated Google search cancels the warm-up", !warmupStateOf(tabId));
  const laterTask = await peekTask(tabId, firstDecoy);
  check("C: a later search for the decoy doesn't bring the old query back", laterTask.action === "none");
}

// D: leaving for a site the extension can't see cancels the warm-up.
{
  const tabId = await startWarmup("query d");
  await navigateTab(tabId, "https://example.com/");
  check("D: navigating to another site cancels the warm-up", !warmupStateOf(tabId));
}

// E: the new tab's blank page, seen before the first decoy loads, is ignored.
{
  holdNextNavigation = true;
  const tabId = await startWarmup("query e");
  await fireTabUpdated(tabId, { status: "complete" }, { url: undefined });
  check("E: the blank page before the first decoy doesn't cancel", Boolean(warmupStateOf(tabId)));
  await heldNavigation();
  const task = await peekTask(tabId, warmupStateOf(tabId).expectedPageQuery);
  check("E: the warm-up then proceeds on the first decoy page", task.action === "type");
}

// F: a commit after the warm-up was cancelled is refused.
{
  const tabId = await startWarmup("query f");
  const firstDecoy = warmupStateOf(tabId).expectedPageQuery;
  const task = await peekTask(tabId, firstDecoy);
  await navigateTab(tabId, searchUrl("other"));
  check("F: a commit after cancellation is refused", !(await commitTask(tabId, firstDecoy, task.stage)).ok);
}

// G (Codex review 2): after step 2 commits, the "loading" event still shows the
// first decoy's URL and the new URL only arrives in a separate event.
{
  const tabId = await startWarmup("query g");
  const firstDecoy = warmupStateOf(tabId).expectedPageQuery;
  const task = await peekTask(tabId, firstDecoy);
  await commitTask(tabId, firstDecoy, task.stage);
  await navigateTab(tabId, searchUrl(task.query), { providePendingUrl: false });
  check("G: a stale URL in the loading event doesn't cancel the warm-up", Boolean(warmupStateOf(tabId)));
  const finalTask = await peekTask(tabId, task.query);
  check("G: the real query still runs on the second decoy page", finalTask.query === "query g");
}

// H: the first decoy page finishes loading only after step 2 has committed.
{
  const tabId = await startWarmup("query h");
  const firstDecoy = warmupStateOf(tabId).expectedPageQuery;
  const task = await peekTask(tabId, firstDecoy);
  await commitTask(tabId, firstDecoy, task.stage);
  await fireTabUpdated(tabId, { status: "complete" }, { url: searchUrl(firstDecoy) });
  check("H: a late 'complete' event for the previous page doesn't cancel", Boolean(warmupStateOf(tabId)));
}

console.log(failureCount === 0 ? "\nAll checks passed." : `\n${failureCount} check(s) failed.`);
process.exitCode = failureCount === 0 ? 0 : 1;
