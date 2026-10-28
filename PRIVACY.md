# Privacy Policy

_Last updated: 2026-10-15_

Search Warm-Up does not collect, store, sell, or share your personal data. It has no servers, no analytics, and no tracking.

## Your search queries

- **Where your query goes:** your query is only ever sent to the Google site you chose in the settings (www.google.com by default). It goes there because that's the search you asked to run. The extension never sends it anywhere else.
- **How it's held:** while the warm-up runs (normally a few seconds), your query is kept in the browser's in-memory session storage (`chrome.storage.session`). That storage:
  - is never written to disk,
  - can't be read by websites or by the extension's page scripts,
  - is cleared when the browser closes.
- **When it's deleted:** your query is deleted from that storage as soon as it's submitted to Google in the final step. If the warm-up is abandoned, it's deleted right away when you close the tab or navigate somewhere else, and after two minutes at most otherwise.
- **No logs:** your query is never logged, saved to history by the extension, or synced to your account.

## Settings

Your settings are saved with `chrome.storage.sync` and synced by your browser if you have sync turned on. They contain only your decoy queries, your chosen Google site, and your timing preferences. They never contain your searches.

## Things outside the extension's control

- Google receives and processes your search the same way it would if you typed it yourself. Google's own privacy policy applies to that.
- Outside incognito, your browser saves the searches the extension runs (decoys and your real query) in your history, as it does for any page you visit.

## Permissions

- `storage`: holds your settings, and your in-progress query in memory as described above.
- `alarms`: deletes the in-progress query of an abandoned warm-up on time.
- Access to `https://www.google.<domain>/search` pages: needed to type into Google's search box. The extension does nothing on any other page, and nothing on Google pages unless you started a warm-up in that tab.
- Access to Google's CAPTCHA pages (`https://www.google.<domain>/sorry/...`): lets the extension recognise a CAPTCHA partway through a warm-up and resume once you solve it, instead of treating it as you leaving. The extension doesn't read or interact with these pages.
- The extension can't see the address of any other site you visit. While a warm-up is running, it notices only that the tab left Google, and uses that to cancel the warm-up and delete your query.

## Verifying this

The extension is open source. Its code (`manifest.json` and everything in `src/`) makes no network requests and loads no remote code, which you can check line by line in this repository. The only file that makes a network request is the developer tool in `scripts/`, which fetches Google's public domain list. It isn't part of the extension and never runs in your browser.

## Contact

Open an issue on this repository's GitHub page.
