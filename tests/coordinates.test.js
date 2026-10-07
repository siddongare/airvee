// ============================================================
//  Unit Tests for Coordinates Precision & Persistence (Priority)
// ============================================================

import {
  parseCoordinate,
  parseCoordinatePair,
  formatCoordinateForDisplay,
  isValidCoordinate
} from '../lib/geo.js';

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

console.log('\n--- 1. Full Precision Storage (No Rounding or Truncation) ---');
const rawPasted = "48.8583701234567, 2.2944810234567";
const parsedPair = parseCoordinatePair(rawPasted);

assert(parsedPair !== null, 'Pasted coordinate pair parsed successfully');
assert(parsedPair.lat === 48.8583701234567, `Latitude stored with exact full precision (got ${parsedPair.lat})`);
assert(parsedPair.lon === 2.2944810234567, `Longitude stored with exact full precision (got ${parsedPair.lon})`);

// Ensure no Math.round was applied
assert(parsedPair.lat.toString() === '48.8583701234567', 'Exact string match for latitude float');
assert(parsedPair.lon.toString() === '2.2944810234567', 'Exact string match for longitude float');

console.log('\n--- 2. Display Formatting (Up to 7 decimals, trim trailing zeros) ---');
const latDisplay = formatCoordinateForDisplay(parsedPair.lat);
const lonDisplay = formatCoordinateForDisplay(parsedPair.lon);

assert(latDisplay === '48.8583701', `Latitude displays up to 7 decimals (got ${latDisplay})`);
assert(lonDisplay === '2.294481', `Longitude displays up to 7 decimals trimming zeros (got ${lonDisplay})`);

assert(formatCoordinateForDisplay(21.0) === '21', 'Whole number has trailing zeros trimmed');
assert(formatCoordinateForDisplay(21.5000000) === '21.5', 'Single decimal trailing zeros trimmed');
assert(formatCoordinateForDisplay(21.123456789) === '21.1234568', 'Capped at 7 decimal places for UI display');

console.log('\n--- 3. Comma Decimal & Delimiter Parsing ---');
const commaPair = parseCoordinatePair("48,8583701234567; 2,2944810234567");
assert(commaPair !== null, 'Comma decimals with semicolon parsed');
assert(commaPair.lat === 48.8583701234567, 'Comma decimal converted to float lat');
assert(commaPair.lon === 2.2944810234567, 'Comma decimal converted to float lon');

console.log('\n--- 4. Validation & Boundary Rejection ---');
assert(isValidCoordinate(48.85837, 2.29448) === true, 'Valid coordinates accepted');
assert(isValidCoordinate(90, 180) === true, 'Edge boundaries accepted');
assert(isValidCoordinate(-90, -180) === true, 'Negative edge boundaries accepted');
assert(isValidCoordinate(91, 50) === false, 'Latitude > 90 rejected');
assert(isValidCoordinate(-95, 50) === false, 'Latitude < -90 rejected');
assert(isValidCoordinate(50, 185) === false, 'Longitude > 180 rejected');
assert(isValidCoordinate(50, -185) === false, 'Longitude < -180 rejected');
assert(isValidCoordinate(NaN, 50) === false, 'NaN latitude rejected');

console.log('\n--- 5. Browser Restart / Storage Persistence Simulation ---');
// Simulate chrome.storage.local JSON serialization
const storageSimulation = JSON.stringify({
  settings: {
    latitude: parsedPair.lat,
    longitude: parsedPair.lon,
    radiusKm: 15
  }
});

// Restore after simulated restart
const restored = JSON.parse(storageSimulation);
assert(restored.settings.latitude === 48.8583701234567, 'Latitude survives browser restart 100% unchanged');
assert(restored.settings.longitude === 2.2944810234567, 'Longitude survives browser restart 100% unchanged');

console.log('\n========================================');
console.log(`COORDINATES TEST SUMMARY: ${passed} passed, ${failed} failed.`);
console.log('========================================\n');

if (failed > 0) process.exit(1);
