# Privacy

Airvee has no server, no accounts, no analytics and no advertising. Your location, settings and flight log are stored on your device only.

## What leaves your device
| Request | When | What is sent | To |
|---|---|---|---|
| Flight positions | While the extension is active | A search area: your location and radius | Flightradar24 (`data-cloud.flightradar24.com`) |
| Cloud cover | Only if the cloud-cover hint is enabled | Your latitude and longitude rounded to 2 decimals (about 1 km) | Open-Meteo |

The flight-data provider necessarily learns your approximate area, because that is how a "flights near me" query works. Every service you contact also sees your IP address, as with any website. Airvee itself never receives any of this data.

Clicking a notification opens `https://www.flightradar24.com/<callsign>` in a new tab. The URL contains only the aircraft callsign (for example UAE504). It never contains your location or coordinates.

## Stored on your device
- Settings and your observer location: chrome.storage.local.
- The flight log: IndexedDB in your browser. You can export it as CSV or clear it from the Log tab.
- Opt-in diagnostics: stored locally only in chrome.storage.local (capped at the last 200 poll cycles). Disabled by default, contains only relative observer metrics (no absolute latitude/longitude coordinates), and is never transmitted anywhere. You can export it as JSON or clear it from Settings.
- Uninstalling the extension removes all of it.

## Permissions
- `alarms`: schedules background checks for approaching aircraft.
- `notifications`: displays alerts when an aircraft is predicted to pass overhead.
- `storage`: saves settings and observer coordinates in `chrome.storage.local`.
- `unlimitedStorage`: allows storage for the IndexedDB flight log without browser quota limits.
- `offscreen`: plays the alert chime audio from an offscreen document because Manifest V3 service workers cannot access audio APIs directly.
- `https://data-cloud.flightradar24.com/*`: fetches live flight positions within your search area.
- `https://api.open-meteo.com/*`: fetches localized cloud cover for optical visibility classification.

## Remote code
None. All scripts, fonts and libraries are bundled in the extension.

## Questions
Open an issue on this repository. Report security problems privately through the Security tab.

Last updated: October 2026.
