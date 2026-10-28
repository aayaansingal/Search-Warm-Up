# Changelog

## 1.0.0 — 2026-10-28

First release.

- Runs a three-step warm-up before your real Google search (a decoy search, then a decoy typed into Google's search box, then your real query) to cut down on CAPTCHAs when browsing over a VPN, a proxy, or in incognito/private windows.
- Three ways to start a search:
  - the keyboard shortcut **Alt+Shift+G** (**Option+Shift+G** on Mac), which works in private windows,
  - the toolbar button,
  - `g` + space in the address bar (normal windows).
- Supports all 187 Google country domains, such as google.co.uk and google.de.
- Settings for the Google site, the decoy queries, and the typing speed.
- Privacy: your query is held only in memory, sent only to Google, and deleted as soon as the search is done or abandoned. No servers, no analytics. See [PRIVACY.md](PRIVACY.md).
- Works in Chrome, Brave, Edge, and other Chromium-based browsers.
