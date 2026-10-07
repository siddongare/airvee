// ============================================================
//  AIRVEE — Precision Geodesic Engine Unit Tests
//  Run via: node tests/geo.test.js
// ============================================================

import {
  haversineDistance,
  calculateBearing,
  calculateElevationAngle,
  projectToEastNorth,
  calculateCPA,
  deadReckonPosition,
  bearingToCompass,
  parseFacingDirection,
  getRelativeDirection,
  formatLookDirection,
  classifyPass,
  formatOverheadRowSubline
} from '../lib/geo.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertClose(actual, expected, tolerance = 0.01, message = '') {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, `${message} (expected ~${expected}, got ${actual}, diff ${diff.toFixed(4)})`);
}

console.log('\n--- 1. Haversine Distance ---');
{
  // Nagpur center to a point exactly ~11.13 km North (0.1 deg lat)
  const dNorth = haversineDistance(21.1458, 79.0882, 21.2458, 79.0882);
  assertClose(dNorth, 11.12, 0.15, '0.1 deg north is ~11.12 km');

  // Same coordinates should have 0 distance
  const dZero = haversineDistance(21.1458, 79.0882, 21.1458, 79.0882);
  assertClose(dZero, 0, 0.0001, 'Identical coordinates have distance 0');

  // London (51.5074, -0.1278) to Paris (48.8566, 2.3522) is ~343.5 km
  const dLonPar = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522);
  assertClose(dLonPar, 343.5, 3.0, 'London to Paris great circle distance ~343.5 km');
}

console.log('\n--- 2. Initial Bearing / Azimuth ---');
{
  // Due North
  const bNorth = calculateBearing(21.0, 79.0, 22.0, 79.0);
  assertClose(bNorth, 0, 0.1, 'Due North bearing is ~0°');

  // Due East
  const bEast = calculateBearing(0.0, 79.0, 0.0, 80.0);
  assertClose(bEast, 90, 0.1, 'Due East on Equator is 90°');

  // Due South
  const bSouth = calculateBearing(22.0, 79.0, 21.0, 79.0);
  assertClose(bSouth, 180, 0.1, 'Due South bearing is 180°');

  // Due West
  const bWest = calculateBearing(0.0, 80.0, 0.0, 79.0);
  assertClose(bWest, 270, 0.1, 'Due West on Equator is 270°');
}

console.log('\n--- 3. Elevation Angle with Earth Curvature ---');
{
  // Plane directly overhead at 30,000 ft (9.144 km alt, 0 km ground distance)
  // At 0.001 km ground dist, angle is ~90°
  const elevOverhead = calculateElevationAngle(0.001, 30000, 0);
  assertClose(elevOverhead, 89.99, 0.1, 'Directly overhead elevation is ~90°');

  // Plane at 30,000 ft (9.144 km) at 9.144 km ground distance
  // Without curvature, atan2(9.144, 9.144) = 45°. With curvature drop (~0.006 km), angle is ~44.97°
  const elev45 = calculateElevationAngle(9.144, 30000, 0);
  assertClose(elev45, 45, 0.2, 'Plane at 30,000ft at 9.14km ground dist is ~45°');

  // Far plane: 100 km away at 35,000 ft (10.668 km alt).
  // Earth curvature drop for 100 km is d^2 / (2R) = 10,000 / 12742 = 0.784 km (784 m drop)
  // Apparent altitude: 10.668 - 0.784 = 9.884 km. Angle = atan2(9.884, 100) = 5.64°
  const elevFar = calculateElevationAngle(100, 35000, 0);
  assertClose(elevFar, 5.64, 0.25, 'Far target at 100 km includes ~784m curvature drop');
}

console.log('\n--- 4. Local Flat Tangent Plane Projection ---');
{
  const obs = { lat: 21.0, lon: 79.0 };
  const { eastKm, northKm } = projectToEastNorth(21.1, 79.1, obs.lat, obs.lon);
  assert(northKm > 10.5 && northKm < 11.5, `North displacement ~11.1 km (got ${northKm.toFixed(2)})`);
  assert(eastKm > 9.5 && eastKm < 11.0, `East displacement ~10.3 km (got ${eastKm.toFixed(2)})`);
}

console.log('\n--- 5. Closest Point of Approach (CPA) Engine ---');
{
  const obsLat = 21.0;
  const obsLon = 79.0;

  // Case A: Plane 20 km due South heading North (track 0°) directly at observer at 450 knots (~231.5 m/s or 0.2315 km/s)
  // Plane is at (21.0 - 20/111.195, 79.0) = (20.82, 79.0)
  const planeALat = 20.82;
  const planeALon = 79.0;
  const cpaA = calculateCPA(
    planeALat, planeALon, 35000, 450, 0, 0,
    obsLat, obsLon, 0, 15
  );

  assert(cpaA.isInbound === true, 'Inbound plane has isInbound === true');
  assert(cpaA.tCpa > 0, `tCpa is positive (${cpaA.tCpa.toFixed(1)}s)`);
  assertClose(cpaA.dCpa, 0, 0.2, 'Direct pass has dCpa ~0 km');
  assert(cpaA.passesOverhead === true, 'Direct pass classifies as passesOverhead === true');
  assertClose(cpaA.elevationAtCpa, 90, 1.0, 'Direct pass elevation at CPA is ~90°');

  // Case B: Plane passing 5 km to the East
  // Plane heading North (track 0°), starting 20 km South and 5 km East
  // dCpa should be ~5 km.
  const dLon5Km = 5 / (111.195 * Math.cos(21 * Math.PI / 180));
  const planeBLat = 20.82;
  const planeBLon = 79.0 + dLon5Km;
  const cpaB = calculateCPA(
    planeBLat, planeBLon, 30000, 450, 0, 0,
    obsLat, obsLon, 0, 15
  );
  assert(cpaB.isInbound === true, 'Plane B is inbound');
  assertClose(cpaB.dCpa, 5.0, 0.3, 'Plane B dCpa is ~5.0 km');
  assert(cpaB.passesOverhead === true, 'Plane B passing at 5 km with 15 km threshold is overhead');

  // Case C: Plane passing 25 km away (outside 15 km threshold)
  const dLon25Km = 25 / (111.195 * Math.cos(21 * Math.PI / 180));
  const planeCLon = 79.0 + dLon25Km;
  const cpaC = calculateCPA(
    planeBLat, planeCLon, 30000, 450, 0, 0,
    obsLat, obsLon, 0, 15
  );
  assert(cpaC.passesOverhead === false, 'Plane C at 25 km CPA does NOT pass overhead');

  // Case D: Plane already flying AWAY from observer
  // Plane is 10 km North, flying North (track 0°) away from observer
  const planeDLat = 21.0 + (10 / 111.195);
  const cpaD = calculateCPA(
    planeDLat, obsLon, 30000, 450, 0, 0,
    obsLat, obsLon, 0, 15
  );
  assert(cpaD.isInbound === false, 'Plane flying away has isInbound === false');
  assert(cpaD.tCpa <= 0, 'Plane flying away has tCpa <= 0');
  assert(cpaD.passesOverhead === false, 'Plane flying away does not pass overhead in future');
}

console.log('\n--- 6. Kinematic Dead-Reckoning ---');
{
  const obsLat = 21.0;
  const obsLon = 79.0;
  const flight = {
    lat: 20.85,
    lon: 79.0,
    altitudeFt: 30000,
    groundSpeedKt: 450, // ~0.2315 km/s -> ~13.89 km in 60s
    trackDeg: 0,        // North
    verticalRateFpm: -1000 // descending at 1000 fpm
  };

  const dr30 = deadReckonPosition(flight, 30, obsLat, obsLon, 0, 15);
  assert(dr30.lat > flight.lat, 'Dead reckoning moved aircraft north');
  assertClose(dr30.lon, flight.lon, 0.001, 'No east-west drift on heading 0°');
  assertClose(dr30.altitudeFt, 29500, 10, 'Descending 1000 fpm for 30s drops ~500 ft');
  assert(dr30.tCpa < calculateCPA(flight.lat, flight.lon, flight.altitudeFt, flight.groundSpeedKt, flight.trackDeg, flight.verticalRateFpm, obsLat, obsLon).tCpa, 'tCpa decreased by ~30s');
}

console.log('\n--- 7. Compass & Look Direction Helpers ---');
{
  assert(bearingToCompass(0) === 'N', '0° is N');
  assert(bearingToCompass(45) === 'NE', '45° is NE');
  assert(bearingToCompass(90) === 'E', '90° is E');
  assert(bearingToCompass(135) === 'SE', '135° is SE');
  assert(bearingToCompass(180) === 'S', '180° is S');
  assert(bearingToCompass(225) === 'SW', '225° is SW');
  assert(bearingToCompass(270) === 'W', '270° is W');
  assert(bearingToCompass(315) === 'NW', '315° is NW');

  // Relative direction with observer facing
  // If observer faces North (0°):
  // Target at 315° (NW) is to observer's front-left
  assert(getRelativeDirection(315, 'N') === 'front-left', 'Facing North, target at NW is front-left');
  // Target at 90° (E) is to observer's right
  assert(getRelativeDirection(90, 'N') === 'to your right', 'Facing North, target at E is to your right');
  // Target at 180° (S) is behind observer
  assert(getRelativeDirection(180, 'N') === 'behind you', 'Facing North, target at S is behind you');

  // If observer faces East (90°):
  // Target at 90° is straight ahead
  assert(getRelativeDirection(90, 'E') === 'straight ahead', 'Facing East, target at 90° is straight ahead');
  // Target at 0° (North) is to observer's left
  assert(getRelativeDirection(0, 'E') === 'to your left', 'Facing East, target at 0° is to your left');

  // Look Direction formatting
  const fmtNoFacing = formatLookDirection(225, 39.6);
  assert(fmtNoFacing === 'Look SW, 40° up', `Format without facing: "${fmtNoFacing}"`);

  const fmtFacing = formatLookDirection(225, 39.6, 'N');
  assert(fmtFacing === 'Look SW (back-left), 40° up', `Format with North facing: "${fmtFacing}"`);

  const fmtAhead = formatLookDirection(0, 52.2, 'N');
  assert(fmtAhead === 'Look N (straight ahead), 52° up', `Format ahead: "${fmtAhead}"`);
}

console.log('\n--- 8. Pass Classification (Overhead vs Near) ---');
{
  const defaultSettings = { overheadThresholdKm: 5, minElevationDeg: 15 };

  // 1. Direct overhead: inbound, CPA 0.5 km, high elevation 75°
  const directOverheadFlight = {
    isInbound: true,
    tCpa: 90,
    dCpa: 0.5,
    elevationAtCpa: 75
  };
  assert(classifyPass(directOverheadFlight, defaultSettings) === 'overhead', 'Direct overhead flight classified as overhead');

  // 2. CPA 20 km: inbound, but CPA 20 km > threshold 5 km
  const farPassFlight = {
    isInbound: true,
    tCpa: 80,
    dCpa: 20,
    elevationAtCpa: 25
  };
  assert(classifyPass(farPassFlight, defaultSettings) === 'near', 'CPA 20 km classified as near');

  // 3. CPA 4.9 km but elevation below minimum (12° < 15°)
  const lowElevationFlight = {
    isInbound: true,
    tCpa: 100,
    dCpa: 4.9,
    elevationAtCpa: 12
  };
  assert(classifyPass(lowElevationFlight, defaultSettings) === 'near', 'CPA 4.9 km with elevation 12° (<15°) classified as near');

  // 4. Moving away (outbound / past CPA: tCpa <= 0 or isInbound false)
  const outboundFlight = {
    isInbound: false,
    tCpa: -30,
    dCpa: 1.2,
    elevationAtCpa: 60
  };
  assert(classifyPass(outboundFlight, defaultSettings) === 'near', 'Outbound / past flight classified as near');

  // 5. Stationary / on ground (tCpa 0 or groundspeed < 5)
  const stationaryFlight = {
    isInbound: false,
    tCpa: 0,
    dCpa: 0.1,
    elevationAtCpa: 85
  };
  assert(classifyPass(stationaryFlight, defaultSettings) === 'near', 'Stationary flight classified as near');

  // 6. Missing speed / missing ETA
  const missingSpeedFlight = {
    dCpa: 1.0,
    elevationAtCpa: 50,
    eta: null,
    tCpa: null
  };
  assert(classifyPass(missingSpeedFlight, defaultSettings) === 'near', 'Flight with missing speed/ETA classified as near');
}

console.log('\n--- 9. Overhead Row Subline Formatter ---');
{
  // 1. Current distance < 1 km prints "now overhead", not a compass direction
  const overheadNowFlight = {
    aircraftType: 'B789',
    distance: 0.4,
    currentBearing: 315,
    dCpa: 0.1,
    bearingAtCpa: 315
  };
  const subline1 = formatOverheadRowSubline(overheadNowFlight);
  assert(subline1 === 'B789 · now overhead', `Subline for distance < 1 km: got "${subline1}"`);
  assert(!subline1.includes('NW') && !subline1.includes('northwest'), 'Does not print compass direction when distance < 1 km');

  // 2. Zero distance prints "now overhead"
  const zeroDistFlight = {
    aircraftType: 'A388',
    distance: 0,
    currentBearing: 180,
    dCpa: 0
  };
  const subline2 = formatOverheadRowSubline(zeroDistFlight);
  assert(subline2 === 'A388 · now overhead', `Subline for 0 km distance: got "${subline2}"`);

  // 3. Current distance > 1 km prints current distance and compass direction
  const inboundApproaching = {
    aircraftType: 'A359',
    distance: 14.2,
    currentBearing: 225, // SW
    dCpa: 0.5
  };
  const subline3 = formatOverheadRowSubline(inboundApproaching);
  assert(subline3 === 'A359 · now 14 km SW', `Subline with CPA <= 1 km: got "${subline3}"`);
  assert(!subline3.includes('passes within'), 'Does not print "passes within" when CPA <= 1 km');

  // 4. CPA > 1 km prints "passes within <CPA distance>"
  const cpaOverOne = {
    aircraftType: 'B77W',
    distance: 12.0,
    currentBearing: 90, // E
    dCpa: 3.8
  };
  const subline4 = formatOverheadRowSubline(cpaOverOne);
  assert(subline4 === 'B77W · now 12 km E · passes within 4 km', `Subline with CPA > 1 km: got "${subline4}"`);

  // 5. Aircraft type fallback to 'Aircraft' if missing
  const noTypeFlight = {
    aircraftType: '',
    distance: 0.8,
    dCpa: 0.2
  };
  const subline5 = formatOverheadRowSubline(noTypeFlight);
  assert(subline5 === 'Aircraft · now overhead', `Subline with empty aircraft type: got "${subline5}"`);
}

console.log(`\n========================================`);
console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed.`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}
