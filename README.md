<p align="center">
  <img src="docs/images/logo.png" width="96" height="96" alt="Airvee Logo" />
</p>

# Airvee

[![CI](https://github.com/siddongare/airvee/actions/workflows/ci.yml/badge.svg)](https://github.com/siddongare/airvee/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](LICENSE)

Know where to look when a plane passes overhead.

Airvee is a Chrome extension that watches the sky around a location you choose, predicts which flights will pass close to you, and tells you which way to look and how high, for example "Look NW, 23 degrees up".

<!-- TODO: add screenshots and a short demo GIF under docs/images/ and link them here -->

## Why I built this

I live in Central India, which sits under busy long-haul routes. A lot of Ethiopian, Qatar Airways and Emirates flights pass overhead, and I kept missing them. Flight-tracking apps show where a plane is, but I wanted something that taps me on the shoulder two minutes before it arrives and tells me which way to look. Airvee is that: a small extension that predicts the closest point of approach to my exact spot and turns it into a direction and an angle.

I built it with AI coding tools and then tested, reviewed and reshaped it myself. The geometry is documented in [docs/geometry.md](docs/geometry.md) so you can check the maths rather than take my word for it.

## What it does
- **Overhead vs. near-you separation.** From each aircraft's position, speed and heading, Airvee calculates its predicted closest point of approach (CPA). A flight is classified as **overhead** only when it is strictly inbound, passes within your overhead threshold (default 5 km), and achieves an elevation angle above the horizon (default ≥15°). Only overhead flights trigger notifications, chimes, live countdowns, and accent styling. All other aircraft inside your detection radius appear under **Near you** with neutral styling and status (e.g. "Closest 14 km east in 2:10" or "Moving away") without alerting.
- **Look direction.** The compass direction and elevation angle to look at, relative to the direction you face.
- **Radar view.** A canvas radar centred on you with range rings, plane trails and your facing direction.
- **Watchlist.** Alert rules by aircraft type, airline, registration, callsign prefix, or cargo and passenger flights, plus a "rare for me" rule based on your own log. Each rule can use its own alert style.
- **Log and statistics.** Every overhead pass is stored on your device. Includes a collection of airlines, aircraft types and registrations you have seen, an hour-by-weekday heatmap, and "likely today" suggestions from your own history.
- **Visibility hint.** Simple rules based on sun height and cloud cover to suggest looking conditions, for example "Night · look for strobe lights". Not a physical simulation.

## Install
1. Clone or download this repository.
2. Open chrome://extensions, turn on Developer mode, choose Load unpacked, and select the folder that contains manifest.json.
3. Open the popup, go to Settings, and enter your latitude, longitude and the direction you face.
To test without live flights, click the version tag in Settings 5 times to turn on simulated mock flights.

## Develop
- `npm test` runs the test suite (58 passing tests).
- `npm run check` runs a syntax check and the tests.

## Data and privacy
Flight positions come from the Flightradar24 provider registered in providers/index.js. The bundled Flightradar24 provider uses an unofficial, undocumented endpoint. That is fine for personal experiments but not for redistribution, and replacing it is the first item in docs/roadmap.md. See PRIVACY.md for exactly what is sent and to whom.

## Limitations
- Predictions assume constant speed and heading, so turning aircraft are predicted less accurately.
- ADS-B positions can be several seconds old, and coverage varies by region.
- ADS-B has no passenger counts. Seat numbers are estimates from aircraft type, and freighters show "Cargo".
- Elevation angle includes Earth curvature but not atmospheric refraction.

## Built with AI assistance
I built Airvee with AI coding tools and then tested, reviewed and reshaped it myself.

## More
[ARCHITECTURE](ARCHITECTURE.md) · [PRIVACY](PRIVACY.md) · [CONTRIBUTING](CONTRIBUTING.md) · [SECURITY](SECURITY.md) · [CHANGELOG](CHANGELOG.md)

## License
MIT. See LICENSE. Third-party components are listed in THIRD_PARTY_NOTICES.md.
