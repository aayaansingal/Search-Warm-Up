# bypassing-captchas

**Search Warm-Up** is a small Chromium extension that cuts down on Google's "unusual traffic" CAPTCHAs. These often show up for ordinary searches when you're in incognito, or behind a VPN or proxy.

It works in Chrome, Edge, Brave, Opera, Vivaldi, and any other Chromium-based browser.

## How it works

Doing these steps by hand usually gets a normal search through without a CAPTCHA:

1. Search for something harmless (e.g. `hi`) from the **address bar** instead of your real query.
2. Once the results load, search for another harmless query from **Google's own search box** on the results page.
3. Once that loads, type your **real query** into the same search box.

The extension does all three steps for you. You type your real query once, and it:

1. opens a Google results page for a random decoy query,
2. types a second decoy into the page's search box and submits it,
3. types your real query into the search box and submits it.

Typing is simulated keystroke by keystroke with short, randomized pauses, so it looks like a person using the page normally. Your real query is never sent from the address bar.

## Installation

The extension isn't in a web store yet, so you load it unpacked:

1. Download the latest `search-warm-up-v*.zip` from this repository's [**Releases**](../../releases/latest) page and unzip it. Keep the unzipped folder somewhere permanent: the browser runs the extension from it. You can also download the whole repository (**Code** → **Download ZIP**) or `git clone` it.
2. Open your browser's extensions page:
   - Chrome / Vivaldi: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
3. Turn on **Developer mode** (a toggle, usually in the top-right or the sidebar).
4. Click **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
5. **To use it in incognito/private windows:** click **Details** on the extension and turn on **Allow in Incognito** (called **Allow in Private** in Brave).

**Updating:** download the new release, replace the old folder's contents with it, and click the reload arrow on the extension's card. Your settings are kept.

## Usage

There are three ways to start a search:

- **Keyboard shortcut (works everywhere, including private/incognito windows):** press **Alt+Shift+G** (**Option+Shift+G** on Mac), type your query, and press Enter. To change the shortcut, go to `chrome://extensions/shortcuts` (or `brave://extensions/shortcuts`, `edge://extensions/shortcuts`).
- **Toolbar button:** click the extension icon, type your query, and press **Go**.
- **Address bar (normal windows):** type `g`, then a space, then your query, then Enter. A **Search Warm-Up** label appears in the address bar after `g` + space. If it doesn't, the browser is running a normal search. Some Chrome versions need **Tab** instead of space.

  ```
  g how to change a bike tire  ⏎
  ```

  > **Private/incognito windows:** some browsers, including Brave, don't support extension address-bar keywords in private windows. Use the keyboard shortcut or the toolbar button there.

The whole sequence normally takes a few seconds. Don't type in the page while it's running.

## Settings

Right-click the extension icon → **Options** (or use the **Settings** link in the popup) to change:

- **Google site:** which Google domain to search on (google.com, google.co.uk, google.de, …). All 187 official Google search domains are supported.
- **Decoy queries:** the harmless queries picked at random for the warm-up steps.
- **Pause before typing:** how long it waits on each results page before typing.
- **Delay between keystrokes:** how fast the simulated typing is.

## Notes and limitations

- **It's a heuristic, not a guarantee.** It lowers how often CAPTCHAs appear, but Google can still show one, especially from heavily used VPN exit nodes. If you get one mid-sequence, solve it. The extension picks up where it left off for up to two minutes.
- It only runs on Google search results pages (`https://www.google.<domain>/search`), and only in tabs where you started a warm-up. Normal Google searches are never touched.
- It doesn't solve CAPTCHAs or contact any third-party service. Everything runs locally in your browser.
- If Google changes its results-page layout, the search-box selector in `src/content.js` may need updating.

## Privacy

Your query only ever goes to Google. While the warm-up runs, it's kept in the browser's in-memory session storage, which is never written to disk and can't be read by websites. It's deleted as soon as it's typed into Google, or within two minutes if the warm-up is abandoned. The extension has no servers or analytics, and its code makes no network requests. See [PRIVACY.md](PRIVACY.md) for details.

## Project structure

```
manifest.json                      Extension manifest (Manifest V3)
src/background.js                  Service worker: starts warm-ups, tracks each tab's progress
src/content.js                     Runs on Google results pages; types and submits queries
src/defaults.js                    Default settings and settings loader
src/google-domains.js              Supported Google domains (generated, don't edit by hand)
src/popup.*                        Toolbar popup
src/options.*                      Settings page
icons/                             Extension icons
scripts/update-google-domains.mjs  Developer tool: refreshes the Google domain list (see below)
scripts/package-release.sh         Developer tool: builds the release zip (see below)
tests/background.test.mjs          Simulation tests for the warm-up logic (see Testing)
CHANGELOG.md                       What changed in each version
package.json                       Development only: lets Node run the tests (not part of the extension)
```

### Updating the Google domain list

Chrome can't match "any Google country domain" with a wildcard, so every domain is listed explicitly. To refresh the list from Google's official [supported domains](https://www.google.com/supported_domains) (requires Node 18+):

```
node scripts/update-google-domains.mjs
```

This rewrites `src/google-domains.js` and the content-script matches and host permissions in `manifest.json`.

### Making a release

1. Bump `version` in `manifest.json` and add an entry to `CHANGELOG.md`.
2. Run `scripts/package-release.sh` (macOS/Linux, needs Node). It builds `dist/search-warm-up-v<version>.zip`, containing only what the extension needs.
3. Create a GitHub release tagged `v<version>`, paste in the changelog entry, and attach the zip.

## Testing

**Automated (logic only):** requires [Node.js](https://nodejs.org) 18 or newer.

```
node tests/background.test.mjs
```

This replays warm-up scenarios against the real background code using a fake browser: the normal sequence, a CAPTCHA partway through, a step that fails, and abandoned warm-ups. It doesn't touch Google.

**Manual (the real thing):** load the extension (see [Installation](#installation)), connect to your VPN, open an incognito/private window, press **Alt+Shift+G**, and run a few searches. You should see two decoy searches, then your real one, without a CAPTCHA. If something goes wrong, open the extension's service worker console from `chrome://extensions` (click the **service worker** link on the extension's card) and look for errors.

## License

[MIT](LICENSE)
