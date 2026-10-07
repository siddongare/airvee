// ============================================================
//  Unit Tests for Settings Migration & Persistence
// ============================================================

// Mock chrome API for Node.js test environment
globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => ({})
    }
  },
  alarms: {
    get: async () => null,
    create: async () => {},
    onAlarm: { addListener: () => {} }
  },
  runtime: {
    onMessage: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    sendMessage: async () => {}
  },
  notifications: {
    create: async () => {},
    clear: async () => {},
    onClicked: { addListener: () => {} }
  },
  offscreen: {
    hasDocument: async () => false,
    createDocument: async () => {},
    closeDocument: async () => {}
  }
};

const { migrateSettings, calculatePeakTraffic } = await import('../background.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  ✓ ${message}`);
    passed++;
  }
}

console.log('\n--- 1. Settings Migration from Schema v1 to v2 ---');

const legacySettingsV1 = {
  latitude: 28.5562,
  longitude: 77.1000,
  radiusKm: 20,
  alertsEnabled: true,
  soundEnabled: false,
  flightFilter: 'all',
  userFacing: 'SW',
  chimeVolume: 90,
  minElevationDeg: 20,
  quietHoursEnabled: true,
  quietHoursStart: '22:00',
  quietHoursEnd: '06:00'
};

const migrated = migrateSettings(legacySettingsV1);

assert(migrated.schemaVersion === 5, 'Schema version migrated to 5');
assert(migrated.latitude === 28.5562, 'User custom latitude preserved');
assert(migrated.longitude === 77.1000, 'User custom longitude preserved');
assert(migrated.radiusKm === 20, 'User radius preserved');
assert(migrated.soundEnabled === false, 'User preference preserved');
assert(migrated.unitDistance === 'km', 'Default unitDistance initialized');
assert(migrated.unitSpeed === 'kt', 'Default unitSpeed initialized');
assert(migrated.unitAltitude === 'ft', 'Default unitAltitude initialized');
assert(migrated.cardMode === 'expanded', 'Default cardMode initialized');
assert(migrated.minAltitudeFt === 0, 'Default minAltitudeFt initialized');
assert(migrated.maxAltitudeFt === 60000, 'Default maxAltitudeFt initialized');
assert(migrated.mockProviderEnabled === false, 'Default mockProviderEnabled initialized to false');
assert(migrated.overheadThresholdKm === 5, 'Default overheadThresholdKm initialized');
assert(migrated.rareSeenThreshold === 2, 'Default rareSeenThreshold initialized');
assert(Array.isArray(migrated.watchlistRules), 'Default watchlistRules array initialized');
assert(migrated.showAircraftPhotos === false, 'Default showAircraftPhotos initialized to false');
assert(migrated.radarOrientation === 'facing_up', 'Default radarOrientation initialized to facing_up');

console.log('\n--- 2. Settings Migration Handles Null/Undefined ---');
const emptyMigrated = migrateSettings(null);
assert(emptyMigrated.schemaVersion === 5, 'Null raw settings returns schema v5 defaults');
assert(emptyMigrated.showAircraftPhotos === false, 'Default showAircraftPhotos is false on null');
assert(emptyMigrated.radarOrientation === 'facing_up', 'Default radarOrientation is facing_up on null');
assert(emptyMigrated.latitude === 21.1458, 'Default latitude returned');

console.log('\n--- 3. Peak Simultaneous Traffic Stat ---');
const testFlights = [
  { id: 'f1', distance: 8.5 },
  { id: 'f2', distance: 14.0 },
  { id: 'f3', distance: 22.0 } // Outside 15 km user radius
];

// Mock flights must never update peak
const mockPeak = calculatePeakTraffic(testFlights, 15, 0, true, 1700000000000);
assert(mockPeak === null, 'Mock flights never update peak simultaneous stat');

// Count only within user radiusKm (not 1.5x fetch radius)
const realPeak = calculatePeakTraffic(testFlights, 15, 0, false, 1700000000000);
assert(realPeak !== null && realPeak.maxSimultaneousPlanes === 2, 'Counts only aircraft inside detection radius (2 inside, 1 outside)');
assert(realPeak.maxSimultaneousAt === 1700000000000, 'Records timestamp when peak was updated');

// Does not overwrite when current count is lower than or equal to existing peak
const lowerPeak = calculatePeakTraffic(testFlights, 15, 3, false, 1700000000000);
assert(lowerPeak === null, 'Does not update peak when count is less than existing peak');


console.log('\n========================================');
console.log(`SETTINGS TEST SUMMARY: ${passed} passed, ${failed} failed.`);
console.log('========================================\n');

if (failed > 0) process.exit(1);
