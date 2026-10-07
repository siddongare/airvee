# Chrome Web Store listing (draft)

Name: Airvee: Overhead Flight Alerts

Short description (max 132 characters):
Get alerted when a plane is about to pass overhead, with the compass direction and angle to look.

Single purpose:
Notify the user when aircraft are predicted to pass near their location and show where to look.

Detailed description:
Airvee watches the sky around a location you choose and predicts which flights will pass close to you. When one is about to arrive, it plays a short chime, shows a notification, and tells you where to look, for example "Look NW, 23 degrees up", adjusted for the direction your window faces.

What you get:
- Overhead alerts based on each aircraft's predicted closest point of approach, not just distance
- A radar view centred on you
- A local log of every pass, with statistics and a collection of airlines, aircraft types and registrations
- Watchlist rules, for example only alert for an A380 or a specific airline
- Optional cloud-cover hint and optional aircraft photos (both can be turned off)

Privacy: your location, settings and flight log stay on your device. The extension sends your approximate area to the flight-data provider to find nearby aircraft, and, only if you enable them, your location (rounded to about 1 km) to Open-Meteo for cloud cover and an aircraft registration to Planespotters for photos. No analytics, no accounts, no tracking. Full details in the privacy policy.

Limitations: predictions depend on ADS-B data quality and coverage in your region. Passenger counts are not available; seat numbers are estimates from aircraft type.

Privacy policy URL: https://github.com/siddongare/airvee/blob/main/PRIVACY.md

Permission justifications:
- alarms: schedules the background checks for nearby aircraft
- notifications: shows the overhead alert when a plane is approaching
- storage: saves user settings and configuration preferences locally
- unlimitedStorage: saves the local flight log database without browser quota limits
- offscreen: plays the alert chime because service workers cannot play audio directly
- https://data-cloud.flightradar24.com/*: fetches live ADS-B flight data within the observer bounding box
- https://api.open-meteo.com/*: fetches localized cloud cover for optical visibility hints
- https://api.planespotters.net/*: opt-in lookup of aircraft photos by registration
- https://*.plnspttrs.net/*: loads aircraft thumbnail images from Planespotters image CDN

Remote code: none. All scripts, fonts and libraries are bundled in the extension.

Screenshots required: TODO, real screenshots 1280x800 or 640x400.
