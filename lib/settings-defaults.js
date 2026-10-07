// ============================================================
//  AIRVEE — Single Source of Truth for Default Settings
//  Shared across Background Service Worker, Popup UI, and Radar
// ============================================================

export const SCHEMA_VERSION = 5;

export const DEFAULTS = {
  schemaVersion: SCHEMA_VERSION,
  latitude: 21.1458,
  longitude: 79.0882,
  groundElevationM: 310,
  radiusKm: 30,                 // Single source of truth: 30 km
  overheadThresholdKm: 5,
  alertsEnabled: true,
  soundEnabled: true,
  flightFilter: 'all',          // Single source of truth: 'all'
  altitudeFilter: 'all',        // 'all', 'high', 'low'
  userFacing: '',              // Default: '' (not set)
  chimeVolume: 80,              // Volume percentage (0-100)
  quietHoursEnabled: false,     // Visual-only during quiet hours
  quietHoursStart: '23:00',     // Start time (24h)
  quietHoursEnd: '07:00',       // End time (24h)
  minElevationDeg: 15,          // Minimum elevation angle in degrees
  unitDistance: 'km',           // 'km' or 'mi'
  unitSpeed: 'kt',              // 'kt', 'kmh', 'mph'
  unitAltitude: 'ft',           // 'ft' or 'm'
  cardMode: 'expanded',         // 'compact' or 'expanded'
  airlineFilter: '',            // comma-separated ICAO airline codes
  aircraftFilter: '',           // comma-separated ICAO aircraft codes
  minAltitudeFt: 0,
  maxAltitudeFt: 60000,
  mockProviderEnabled: false,   // Hidden debug mock data provider
  diagnosticsEnabled: false,    // Opt-in real provider diagnostic telemetry
  rareSeenThreshold: 2,         // Number of times seen in log to count as rare
  watchlistRules: [],           // Array of watchlist rules
  showAircraftPhotos: false,    // Legacy key retained for schema migration stability
  radarOrientation: 'facing_up' // 'facing_up' (relative to user facing) or 'north_up'
};

/**
 * Pure migration function filling in defaults for missing keys
 * while strictly preserving all user-configured values.
 *
 * @param {object|null|undefined} rawSettings - User settings object from storage
 * @returns {object} Migrated settings object with all keys populated
 */
export function migrateSettings(rawSettings) {
  if (!rawSettings) return { ...DEFAULTS };
  const v = rawSettings.schemaVersion || 1;
  const migrated = { ...rawSettings };
  if (v < 2) {
    if (migrated.unitDistance === undefined) migrated.unitDistance = 'km';
    if (migrated.unitSpeed === undefined) migrated.unitSpeed = 'kt';
    if (migrated.unitAltitude === undefined) migrated.unitAltitude = 'ft';
    if (migrated.cardMode === undefined) migrated.cardMode = 'expanded';
    if (migrated.airlineFilter === undefined) migrated.airlineFilter = '';
    if (migrated.aircraftFilter === undefined) migrated.aircraftFilter = '';
    if (migrated.minAltitudeFt === undefined) migrated.minAltitudeFt = 0;
    if (migrated.maxAltitudeFt === undefined) migrated.maxAltitudeFt = 60000;
    if (migrated.groundElevationM === undefined) migrated.groundElevationM = 310;
  }
  if (v < 3) {
    if (migrated.overheadThresholdKm === undefined) migrated.overheadThresholdKm = 5;
  }
  if (v < 4) {
    if (migrated.rareSeenThreshold === undefined) migrated.rareSeenThreshold = 2;
    if (migrated.watchlistRules === undefined) migrated.watchlistRules = [];
  }
  if (v < 5) {
    if (migrated.showAircraftPhotos === undefined) migrated.showAircraftPhotos = false;
  }
  if (migrated.mockProviderEnabled === undefined) {
    migrated.mockProviderEnabled = false;
  }
  if (migrated.diagnosticsEnabled === undefined) {
    migrated.diagnosticsEnabled = false;
  }
  if (migrated.radarOrientation === undefined) {
    migrated.radarOrientation = 'facing_up';
  }
  migrated.schemaVersion = SCHEMA_VERSION;
  return { ...DEFAULTS, ...migrated };
}
