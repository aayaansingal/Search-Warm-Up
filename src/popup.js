// Toolbar popup: an alternative to the omnibox keyword for starting a warm-up search.

const searchForm = document.getElementById("search-form");
const queryInput = document.getElementById("query-input");
const newTabCheckbox = document.getElementById("new-tab-checkbox");

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const realQuery = queryInput.value.trim();
  if (realQuery === "") {
    return;
  }

  // The popup belongs to the window it was opened from (including incognito),
  // so "currentWindow" gives the tab the user is looking at.
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  await chrome.runtime.sendMessage({
    type: "startWarmup",
    query: realQuery,
    tabId: activeTab ? activeTab.id : undefined,
    openInNewTab: newTabCheckbox.checked,
  });
  window.close();
});

document.getElementById("options-link").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});
