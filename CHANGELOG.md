# Changelog

All notable changes to Airvee are documented here.

## [Unreleased]

### Changed
- Consolidated default settings into `lib/settings-defaults.js` as the single source of truth across service worker, popup UI, and radar.
- Set unified default detection radius to 30 km and default flight filter to 'all' across the entire extension.
- Defaulted observer facing direction to 'Not set' (`''`), providing compass-only guidance and north-up radar until configured, while preserving existing saved selections.
- Ensured migration strictly preserves existing user-configured settings.

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
