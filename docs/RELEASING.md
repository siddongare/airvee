# Releasing

## Before every release
1. `npm run check` is green locally and in CI.
2. `manifest.json` version matches `package.json` and the top entry in CHANGELOG.md (with today's date).
3. PRIVACY.md matches `host_permissions` in the manifest.
4. Search the repo for personal data: coordinates, emails, keys.
5. Load the repository root folder unpacked and run the mock provider through an alert, a log entry and a settings round-trip (close and reopen the browser).

## Tag and publish on GitHub
```
git tag vX.Y.Z
git push origin vX.Y.Z
```
The Release workflow builds the zip and attaches it to the GitHub Release.

## Building the zip by hand (Windows)
In the repository root folder, select the extension files (`manifest.json`, `background.js`, `popup.html`, `popup.js`, `radar.html`, `radar.js`, `offscreen.html`, `offscreen.js`, `icons`, `lib`, `providers`, `fonts`, `rare_aircraft.json`, `styles.css`), right-click, Send to, Compressed (zipped) folder. `manifest.json` must be at the top level of the zip, not inside a subfolder.

## Chrome Web Store
Use the text in docs/STORE_LISTING.md. Only submit with a data provider whose terms permit it.
