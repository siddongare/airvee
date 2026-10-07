# Roadmap and open issues

Drafts for GitHub issues. Create each as an issue and label it.

1. **Replace the default data provider** (label: enhancement, priority)
   The bundled FR24 provider uses an unofficial endpoint and should not ship in a public release. Add a provider with terms that permit redistribution (candidates: adsb.lol, airplanes.live, adsb.fi, OpenSky), test coverage around central India, and make it the default. See docs/providers.md.
2. **Improve prediction for turning aircraft** (enhancement)
   CPA assumes constant velocity, so arrivals, departures and holding patterns are predicted less accurately. Explore using recent track history to detect turn rate.
3. **Slant-range CPA** (enhancement, good first issue)
   CPA is currently computed on the ground track only. Include altitude to compute true 3D closest approach and compare against current behaviour with tests.
4. **Atmospheric refraction in elevation angle** (enhancement, good first issue)
   Elevation uses Earth-curvature correction only. Evaluate whether a refraction term changes results noticeably for typical distances.
5. **Field-test results and calibration** (documentation)
   Fill in docs/field-test.md with at least 10 real passes and document typical errors.
6. **Real screenshots and demo GIF** (documentation, good first issue)
   Add docs/images/live.png, radar.png, log.png, stats.png and demo.gif and reference them in the README.
7. **Accessibility pass** (enhancement)
   Keyboard navigation, focus order, screen-reader labels on the radar and countdown, contrast audit.
8. **Web Store release** (release)
   Submit once the provider issue is resolved. See docs/STORE_LISTING.md and docs/RELEASING.md.
