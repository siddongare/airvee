// ============================================================
//  Unit Tests for Mock Flight Provider & Kinematics (Requirement 4)
// ============================================================

import { fetchMockFlightsNear } from '../providers/mock.js';
import { calculateCPA, calculateBearing, calculateElevationAngle, classifyPass } from '../lib/geo.js';

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

const obsLat = 21.1458;
const obsLon = 79.0882;
const thresholdRadiusKm = 15;

const flights = await fetchMockFlightsNear(obsLat, obsLon, thresholdRadiusKm);

console.log('\n--- 1. Mock Flights Generation & Isolation ---');
assert(flights.length === 3, `Generated 3 mock flights (got ${flights.length})`);
assert(flights.every(f => f.isMock === true && f.source === 'mock'), 'All mock flights have isMock: true and source: "mock"');

console.log('\n--- 2. Case A: Direct Overhead Pass at 37,000 ft (AIC101) ---');
const fA = flights.find(f => f.callsign === 'AIC101');
assert(fA !== undefined, 'Flight AIC101 exists');
assert(fA.altitudeFt === 37000, `Altitude is 37,000 ft (got ${fA.altitudeFt})`);

const cpaA = calculateCPA(
  fA.lat, fA.lon, fA.altitudeFt, fA.groundSpeedKt, fA.trackDeg, fA.verticalRateFpm,
  obsLat, obsLon, 0, thresholdRadiusKm
);

assert(cpaA.isInbound === true, 'Case A is inbound towards observer');
assert(Math.abs(cpaA.tCpa - 110) <= 2, `Case A ETA to CPA is ~110s (got ${cpaA.tCpa.toFixed(1)}s)`);
assert(cpaA.dCpa <= 0.1, `Case A CPA distance is ~0 km (got ${cpaA.dCpa.toFixed(3)} km)`);
assert(cpaA.passesOverhead === true, 'Case A classifies as passing overhead');
assert(Math.abs(cpaA.currentBearing - 180) <= 1, `Case A current bearing is South 180° (got ${cpaA.currentBearing.toFixed(1)}°)`);
assert(cpaA.elevationAtCpa >= 88.0, `Case A elevation at CPA is ~90° overhead (got ${cpaA.elevationAtCpa.toFixed(1)}°)`);

console.log('\n--- 3. Case B: Passing 20 km East of Observer (UAE504) ---');
const fB = flights.find(f => f.callsign === 'UAE504');
assert(fB !== undefined, 'Flight UAE504 exists');
assert(fB.altitudeFt === 33000, `Altitude is 33,000 ft (got ${fB.altitudeFt})`);
assert(fB.altitude === 33000, `Flight UAE504 has realistic altitude alias matching altitudeFt (got ${fB.altitude})`);
assert(fB.altitude > 0, 'Flight UAE504 altitude is positive realistic flight level, never 0 ft');
assert(flights.every(f => f.altitude > 0 && f.altitude === f.altitudeFt), 'All mock flights provide positive realistic altitude property (never 0 ft)');

const cpaB = calculateCPA(
  fB.lat, fB.lon, fB.altitudeFt, fB.groundSpeedKt, fB.trackDeg, fB.verticalRateFpm,
  obsLat, obsLon, 0, thresholdRadiusKm
);

assert(Math.abs(cpaB.dCpa - 20.0) <= 0.2, `Case B CPA distance is ~20 km (got ${cpaB.dCpa.toFixed(2)} km)`);
assert(cpaB.passesOverhead === false, 'Case B does NOT pass overhead (outside 15 km threshold)');
assert(Math.abs(cpaB.tCpa - 65) <= 2, `Case B ETA to CPA is ~65s (got ${cpaB.tCpa.toFixed(1)}s)`);
assert(Math.abs(cpaB.bearingAtCpa - 90) <= 1, `Case B bearing at CPA is Due East 90° (got ${cpaB.bearingAtCpa.toFixed(1)}°)`);
assert(Math.abs(cpaB.elevationAtCpa - 26.7) <= 1.0, `Case B elevation at CPA is ~26.7° (got ${cpaB.elevationAtCpa.toFixed(1)}°)`);

console.log('\n--- 4. Case C: Inbound from the Southwest (BAW143) ---');
const fC = flights.find(f => f.callsign === 'BAW143');
assert(fC !== undefined, 'Flight BAW143 exists');
assert(fC.altitudeFt === 35000, `Altitude is 35,000 ft (got ${fC.altitudeFt})`);
assert(fC.trackDeg === 45, `Track is heading NE 45° (got ${fC.trackDeg}°)`);

const cpaC = calculateCPA(
  fC.lat, fC.lon, fC.altitudeFt, fC.groundSpeedKt, fC.trackDeg, fC.verticalRateFpm,
  obsLat, obsLon, 0, thresholdRadiusKm
);

assert(cpaC.isInbound === true, 'Case C is inbound from southwest');
assert(Math.abs(cpaC.tCpa - 125) <= 2, `Case C ETA to CPA is ~125s (got ${cpaC.tCpa.toFixed(1)}s)`);
assert(cpaC.dCpa <= 0.2, `Case C CPA distance is ~0 km (got ${cpaC.dCpa.toFixed(3)} km)`);
assert(cpaC.passesOverhead === true, 'Case C classifies as passing overhead');
assert(cpaC.elevationAtCpa >= 88.0, `Case C elevation at CPA is ~90° overhead (got ${cpaC.elevationAtCpa.toFixed(1)}°)`);

console.log('\n--- 5. Pass Classification on Mock Flights (classifyPass) ---');
const defaultSettings = { overheadThresholdKm: 5, minElevationDeg: 15 };

const classA = classifyPass(cpaA, defaultSettings);
assert(classA === 'overhead', 'Mock flight A (direct pass) classifies as overhead');

const classB = classifyPass(cpaB, defaultSettings);
assert(classB === 'near', 'Mock flight B (20 km east) classifies as near');

const classC = classifyPass(cpaC, defaultSettings);
assert(classC === 'overhead', 'Mock flight C (inbound SW, CPA 0km) classifies as overhead');

// Two simultaneous overhead flights exist under default settings:
const overheadMockCount = [cpaA, cpaB, cpaC].filter(f => classifyPass(f, defaultSettings) === 'overhead').length;
assert(overheadMockCount === 2, `Default settings has 2 simultaneous overhead flights (A & C)`);

// Under a restrictive threshold (e.g. 0 km / no overhead passes), all flights are classified as near (no hero)
const strictSettings = { overheadThresholdKm: 0, minElevationDeg: 89.999 };
const strictOverheadCount = [cpaA, cpaB, cpaC].filter(f => classifyPass(f, strictSettings) === 'overhead').length;
assert(strictOverheadCount === 0, 'Restrictive settings results in 0 overhead flights (no hero, calm line)');
const strictNearCount = [cpaA, cpaB, cpaC].filter(f => classifyPass(f, strictSettings) === 'near').length;
assert(strictNearCount === 3, 'All 3 flights remain in near list when nothing is overhead');

console.log('\n========================================');
console.log(`MOCK PROVIDER TEST SUMMARY: ${passed} passed, ${failed} failed.`);
console.log('========================================\n');

if (failed > 0) process.exit(1);
