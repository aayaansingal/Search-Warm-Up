// Content script on Google results pages.
//
// On every results page it asks the background worker whether this tab is in
// the middle of a warm-up. If so, it types the query it is given into Google's
// own search box (the "lower" search field) and submits it, just as a person would.

(function runWarmupStep() {
  const SEARCH_BOX_SELECTOR = 'textarea[name="q"], input[name="q"]';

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getPageQuery() {
    return new URLSearchParams(window.location.search).get("q") || "";
  }

  // Google renders the search box after the page script runs, so poll briefly for it.
  async function findSearchBox() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const searchBox = document.querySelector(SEARCH_BOX_SELECTOR);
      if (searchBox && searchBox.form) {
        return searchBox;
      }
      await wait(100);
    }
    return null;
  }

  // Replace the box's contents one character at a time, firing the same input
  // events a real keystroke would, so Google's page script stays in sync.
  async function typeIntoSearchBox(searchBox, query, timing) {
    searchBox.focus();
    searchBox.value = "";
    searchBox.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));

    for (const character of query) {
      await wait(randomBetween(timing.minKeystrokeMs, timing.maxKeystrokeMs));
      searchBox.value += character;
      searchBox.dispatchEvent(new InputEvent("input", { bubbles: true, data: character, inputType: "insertText" }));
    }
  }

  function submitSearch(searchBox) {
    const searchForm = searchBox.form;
    // requestSubmit runs the form's own submit handlers and keeps its hidden fields.
    if (typeof searchForm.requestSubmit === "function") {
      searchForm.requestSubmit();
    } else {
      searchForm.submit();
    }
  }

  // The background only advances the sequence on "commitTask", which is sent
  // after everything that can fail has succeeded. If this page gives up early,
  // the step stays pending and reloading the page retries it.
  async function main() {
    const pageQuery = getPageQuery();

    // Make sure there is somewhere to type before claiming the task.
    const searchBox = await findSearchBox();
    if (!searchBox) {
      return;
    }

    const task = await chrome.runtime.sendMessage({ type: "peekTask", pageQuery: pageQuery });
    if (!task || task.action !== "type") {
      return;
    }

    await wait(randomBetween(task.timing.minPauseMs, task.timing.maxPauseMs));
    await typeIntoSearchBox(searchBox, task.query, task.timing);
    await wait(randomBetween(150, 400));

    // The warm-up may have been cancelled or timed out while we were typing.
    const commit = await chrome.runtime.sendMessage({ type: "commitTask", pageQuery: pageQuery, stage: task.stage });
    if (!commit || !commit.ok) {
      return;
    }
    submitSearch(searchBox);
  }

  main();
})();
