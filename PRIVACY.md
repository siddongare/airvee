# Airvee — Privacy Policy & Data Architecture

**Last Updated:** October 2026  
**Manifest Version:** Chrome MV3  
**License:** MIT  

---

## 1. Core Architectural Principle: 100% Local & Sovereign

Airvee was built from the ground up on a fundamental commitment: **your location, flight history, and personal preferences belong to you alone.**

Unlike traditional commercial flight tracking applications:
- **Zero Remote Servers:** Airvee has no backend server, proxy server, cloud database, or proprietary API gateway.
- **Zero Telemetry:** No analytics scripts (no Google Analytics, Mixpanel, Amplitude, Segment, PostHog, or Sentry).
- **Zero Ad Networks:** No tracking pixels, cookies, or monetization SDKs.
- **Zero Remotely Hosted Code:** Every script, stylesheet, sound asset, and library runs directly from the locally installed extension bundle on your machine.

---

## 2. Location Coordinates (GPS & Observer Station)

When you configure your observer location (either by typing latitude and longitude or clicking "Detect Location"):
- Coordinates are stored strictly within Chrome's local storage sandbox (`chrome.storage.local`).
- Coordinates **never** leave your machine except when passed directly from your browser to public flight data providers (such as Flightradar24) as standard geographic bounding box query parameters (`lat`, `lon`, `radiusKm`).
- When optical visibility hints are enabled, coordinates sent to Open-Meteo for cloud cover are rounded to 2 decimals (about 1 km) to protect your exact location, while local sun position calculations keep using full precision on-device.
- When aircraft photos are enabled, queries to Planespotters.net contain only the aircraft registration or type, never your location.
- Airvee never associates your coordinates with any identity, IP address logging service, or user account.

---

## 3. Flight Log History & Offline Database

All flights that pass overhead are recorded in a local IndexedDB database (`airvee_flight_db`) stored in your browser's persistent sandbox:
- **Deduplication:** Log entries are deduplicated locally using compound date keys (`${flightId}_${YYYY-MM-DD}`).
- **Data Export:** You can export your entire flight log history to standard CSV at any time.
- **One-Click Purge:** You can completely wipe the IndexedDB flight database at any time using the "Clear" button in the Log view.

---

## 4. Minimum Extension Permissions

Airvee declares only the strictly required browser capabilities permitted by Chrome Manifest V3:
- `storage`: Persisting user settings and flight logs locally.
- `alarms`: Scheduling background flight checks at user-configured polling intervals.
- `notifications`: Displaying native desktop alerts when aircraft are inbound.
- `offscreen`: Playing the airport chime audio cue in background without background window flashes.
- `unlimitedStorage`: Allowing your local flight pass log to expand safely without arbitrary browser quota caps.
- `host_permissions`: Accessing public flight data APIs (e.g. `*.flightradar24.com/*`, `*.adsb.lol/*`) directly from your browser client.

---

## 5. Security & Data Integrity

- All network requests use encrypted HTTPS (`https://`).
- Manifest V3 eliminates `unsafe-eval` and forbids remotely loaded scripts.
- No user data is ever sold, transmitted, rented, or synchronized to any third party.
