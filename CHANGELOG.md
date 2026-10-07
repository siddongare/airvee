# Changelog

All notable changes to Airvee are documented here.

## [1.0.0] - 2026-10-06

### Initial Release
- Separation of overhead and near-you flights: strict pass classification requiring inbound trajectory, CPA within threshold, and minimum elevation angle.
- Overhead alert engine using kinematic CPA (closest point of approach) trajectory projection with single chime per cycle.
- Polar canvas radar scope with relative "Facing Up" orientation and accent color for overhead targets.
- Watchlist and rare aircraft detection engine with customizable rules.
- Local flight pass log with deduplication and CSV export via IndexedDB.
- Collection (Life List) tracking unique airlines, aircraft types, and registrations.
- Learned schedule clustering and 24h x 7-day traffic density heatmap with heartbeat gap tracking.
- Local solar position calculation (NOAA algorithm) and optical sky visibility hints.
- Dark theme interface with prefers-reduced-motion support.
- Fully local architecture with no remote servers and no telemetry.
