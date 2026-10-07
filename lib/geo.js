// ============================================================
//  AIRVEE — Precision Geodesic & Flight Kinematics Engine
//  - Great-circle Haversine ground distance
//  - True North Azimuth / Initial Bearing
//  - Atmospheric & Earth-curvature corrected elevation angles
//  - Local flat East/North tangent projection
//  - Closest Point of Approach (CPA): time, distance, azimuth & elevation
//  - Kinematic Dead-Reckoning (speed + track extrapolation)
//  - Human-centric Look Directions (Compass words & relative orientation)
// ============================================================

export const EARTH_RADIUS_KM = 6371.0088; // WGS-84 mean radius in km
export const KM_PER_NM = 1.852;
export const METERS_PER_FOOT = 0.3048;

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Convert degrees to radians
 */
export function toRad(deg) {
  return deg * DEG_TO_RAD;
}

/**
 * Convert radians to degrees
 */
export function toDeg(rad) {
  return rad * RAD_TO_DEG;
}

/**
 * Calculate Great-Circle Distance between two coordinates in kilometers (Haversine formula).
 *
 * @param {number} lat1 - Latitude 1 in decimal degrees
 * @param {number} lon1 - Longitude 1 in decimal degrees
 * @param {number} lat2 - Latitude 2 in decimal degrees
 * @param {number} lon2 - Longitude 2 in decimal degrees
 * @returns {number} Distance in kilometers
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * (Math.sin(dLon / 2) ** 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_KM * c;
}

/**
 * Calculate Initial Bearing (azimuth) from observer to aircraft (0° - 360° True North).
 *
 * @param {number} lat1 - Observer latitude
 * @param {number} lon1 - Observer longitude
 * @param {number} lat2 - Aircraft latitude
 * @param {number} lon2 - Aircraft longitude
 * @returns {number} Bearing in degrees [0, 360)
 */
export function calculateBearing(lat1, lon1, lat2, lon2) {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLambda = toRad(lon2 - lon1);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  return (toDeg(theta) + 360) % 360;
}

/**
 * Calculate the elevation angle (degrees above horizon) from an observer to an aircraft,
 * accounting for earth curvature drop over long distances.
 *
 * @param {number} groundDistanceKm - Distance on ground in km
 * @param {number} altitudeFt - Aircraft altitude in feet above sea level
 * @param {number} [observerElevationM=0] - Ground elevation of observer in meters
 * @returns {number} Elevation angle in degrees (-90 to +90)
 */
export function calculateElevationAngle(groundDistanceKm, altitudeFt, observerElevationM = 0) {
  const distM = Math.max(1, groundDistanceKm * 1000);
  const planeAltM = (altitudeFt || 0) * METERS_PER_FOOT;
  const relAltM = planeAltM - observerElevationM;

  // Earth curvature drop: h_drop ≈ d² / (2 * R)
  const earthRadiusM = EARTH_RADIUS_KM * 1000;
  const curvatureDropM = (distM * distM) / (2 * earthRadiusM);

  const apparentHeightM = relAltM - curvatureDropM;
  const angleRad = Math.atan2(apparentHeightM, distM);
  return toDeg(angleRad);
}

/**
 * Project a geographic position into a local flat tangent plane (East/North)
 * centered on the observer.
 *
 * @param {number} targetLat - Target latitude
 * @param {number} targetLon - Target longitude
 * @param {number} originLat - Origin (observer) latitude
 * @param {number} originLon - Origin (observer) longitude
 * @returns {{ eastKm: number, northKm: number }}
 */
export function projectToEastNorth(targetLat, targetLon, originLat, originLon) {
  const dLatRad = toRad(targetLat - originLat);
  const dLonRad = toRad(targetLon - originLon);
  const meanLatRad = toRad(originLat);

  const northKm = dLatRad * EARTH_RADIUS_KM;
  const eastKm = dLonRad * EARTH_RADIUS_KM * Math.cos(meanLatRad);

  return { eastKm, northKm };
}

/**
 * Compute Closest Point of Approach (CPA) for an aircraft relative to an observer.
 *
 * @param {number} acLat - Aircraft latitude
 * @param {number} acLon - Aircraft longitude
 * @param {number} acAltitudeFt - Aircraft altitude in feet
 * @param {number} groundSpeedKt - Groundspeed in knots
 * @param {number} trackDeg - Track / heading degrees (0-360)
 * @param {number} verticalRateFpm - Climb / descent rate in feet per minute
 * @param {number} obsLat - Observer latitude
 * @param {number} obsLon - Observer longitude
 * @param {number} [obsElevationM=0] - Observer elevation in meters
 * @param {number} [overheadThresholdKm=15] - Maximum CPA distance to classify as overhead
 * @returns {{
 *   isInbound: boolean,
 *   tCpa: number,            // seconds to CPA (negative if passed)
 *   dCpa: number,            // distance at CPA in km
 *   bearingAtCpa: number,    // azimuth from observer to plane at CPA (0-360)
 *   elevationAtCpa: number,  // elevation angle above horizon at CPA in degrees
 *   altAtCpaFt: number,      // projected altitude at CPA in feet
 *   passesOverhead: boolean, // true if inbound and dCpa <= overheadThresholdKm
 *   currentDistanceKm: number,
 *   currentBearing: number,
 *   currentElevation: number
 * }}
 */
export function calculateCPA(
  acLat,
  acLon,
  acAltitudeFt,
  groundSpeedKt,
  trackDeg,
  verticalRateFpm = 0,
  obsLat,
  obsLon,
  obsElevationM = 0,
  overheadThresholdKm = 15
) {
  // Current instantaneous metrics
  const currentDistanceKm = haversineDistance(obsLat, obsLon, acLat, acLon);
  const currentBearing = calculateBearing(obsLat, obsLon, acLat, acLon);
  const currentElevation = calculateElevationAngle(currentDistanceKm, acAltitudeFt, obsElevationM);

  // If groundspeed is negligible, CPA is current position
  if (!groundSpeedKt || groundSpeedKt < 5) {
    return {
      isInbound: false,
      tCpa: 0,
      dCpa: currentDistanceKm,
      bearingAtCpa: currentBearing,
      elevationAtCpa: currentElevation,
      altAtCpaFt: acAltitudeFt,
      passesOverhead: currentDistanceKm <= overheadThresholdKm,
      currentDistanceKm,
      currentBearing,
      currentElevation
    };
  }

  // Project aircraft position to observer's local East/North plane (in km)
  const { eastKm, northKm } = projectToEastNorth(acLat, acLon, obsLat, obsLon);

  // Velocity components in km/s (x = East, y = North)
  const speedKmS = (groundSpeedKt * KM_PER_NM) / 3600;
  const trackRad = toRad(trackDeg);
  const vx = speedKmS * Math.sin(trackRad);
  const vy = speedKmS * Math.cos(trackRad);
  const vSq = vx * vx + vy * vy;

  // Plane position as a function of time: P(t) = (eastKm + vx*t, northKm + vy*t)
  // Distance squared: |P(t)|² = (eastKm + vx*t)² + (northKm + vy*t)²
  // Minimize by setting d/dt = 0: 2(vx)(eastKm + vx*t) + 2(vy)(northKm + vy*t) = 0
  // tCpa = -(eastKm * vx + northKm * vy) / vSq
  const dot = eastKm * vx + northKm * vy;
  const tCpa = -dot / vSq;

  // Closest coordinates relative to observer
  const eastCpa = eastKm + vx * tCpa;
  const northCpa = northKm + vy * tCpa;
  const dCpa = Math.sqrt(eastCpa * eastCpa + northCpa * northCpa);

  // Azimuth from observer to aircraft at CPA (0-360)
  const bearingAtCpa = (toDeg(Math.atan2(eastCpa, northCpa)) + 360) % 360;

  // Projected altitude at CPA
  const altAtCpaFt = Math.max(0, acAltitudeFt + ((verticalRateFpm || 0) / 60) * tCpa);
  const elevationAtCpa = calculateElevationAngle(dCpa, altAtCpaFt, obsElevationM);

  const isInbound = tCpa > 0;
  const passesOverhead = isInbound && dCpa <= overheadThresholdKm;

  return {
    isInbound,
    tCpa,
    dCpa,
    bearingAtCpa,
    elevationAtCpa,
    altAtCpaFt,
    passesOverhead,
    currentDistanceKm,
    currentBearing,
    currentElevation
  };
}

/**
 * Dead-reckon an aircraft's position forward by elapsedSeconds using its speed and track.
 *
 * @param {object} flight - Aircraft object with lat, lon, altitudeFt, groundSpeedKt, trackDeg, verticalRateFpm
 * @param {number} elapsedSeconds - Seconds elapsed since flight telemetry timestamp
 * @param {number} obsLat - Observer latitude
 * @param {number} obsLon - Observer longitude
 * @param {number} [obsElevationM=0] - Observer elevation in meters
 * @param {number} [overheadThresholdKm=15] - Overhead threshold
 * @returns {object} Extrapolated flight metrics
 */
export function deadReckonPosition(flight, elapsedSeconds, obsLat, obsLon, obsElevationM = 0, overheadThresholdKm = 15) {
  const dt = Math.max(0, elapsedSeconds);
  const lat = flight.lat != null ? flight.lat : flight.latitude;
  const lon = flight.lon != null ? flight.lon : flight.longitude;
  const alt = flight.altitudeFt != null ? flight.altitudeFt : (flight.altitude || 0);
  const speed = flight.groundSpeedKt != null ? flight.groundSpeedKt : (flight.speed || 0);
  const track = flight.trackDeg != null ? flight.trackDeg : (flight.heading || 0);
  const vspeed = flight.verticalRateFpm != null ? flight.verticalRateFpm : (flight.verticalSpeed || 0);

  if (dt === 0 || !speed || speed < 5) {
    const cpa = calculateCPA(lat, lon, alt, speed, track, vspeed, obsLat, obsLon, obsElevationM, overheadThresholdKm);
    return {
      lat,
      lon,
      altitudeFt: alt,
      groundSpeedKt: speed,
      trackDeg: track,
      distanceKm: cpa.currentDistanceKm,
      bearing: cpa.currentBearing,
      elevation: cpa.currentElevation,
      tCpa: cpa.tCpa,
      dCpa: cpa.dCpa,
      passesOverhead: cpa.passesOverhead
    };
  }

  // Displacement in km
  const speedKmS = (speed * KM_PER_NM) / 3600;
  const trackRad = toRad(track);
  const dNorthKm = speedKmS * dt * Math.cos(trackRad);
  const dEastKm = speedKmS * dt * Math.sin(trackRad);

  // Convert km back to delta degrees
  const dLatDeg = toDeg(dNorthKm / EARTH_RADIUS_KM);
  const meanLatRad = toRad(lat);
  const dLonDeg = toDeg(dEastKm / (EARTH_RADIUS_KM * Math.cos(meanLatRad)));

  const newLat = lat + dLatDeg;
  const newLon = lon + dLonDeg;
  const newAlt = Math.max(0, alt + (vspeed / 60) * dt);

  const cpa = calculateCPA(newLat, newLon, newAlt, speed, track, vspeed, obsLat, obsLon, obsElevationM, overheadThresholdKm);

  return {
    lat: newLat,
    lon: newLon,
    altitudeFt: newAlt,
    groundSpeedKt: speed,
    trackDeg: track,
    distanceKm: cpa.currentDistanceKm,
    bearing: cpa.currentBearing,
    elevation: cpa.currentElevation,
    tCpa: cpa.tCpa,
    dCpa: cpa.dCpa,
    passesOverhead: cpa.passesOverhead
  };
}

/**
 * 16-point compass roses
 */
const COMPASS_POINTS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
];

/**
 * 8-point compass directions for clean glanceable reading
 */
const COMPASS_POINTS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Convert bearing (0-360) to human compass word (e.g. "SW", "ENE").
 *
 * @param {number} bearingDeg - Bearing in degrees
 * @param {boolean} [use16Point=false] - Use 16-point instead of 8-point
 * @returns {string} Compass word
 */
export function bearingToCompass(bearingDeg, use16Point = false) {
  const normalized = ((bearingDeg % 360) + 360) % 360;
  if (use16Point) {
    const idx = Math.round(normalized / 22.5) % 16;
    return COMPASS_POINTS_16[idx];
  }
  const idx = Math.round(normalized / 45) % 8;
  return COMPASS_POINTS_8[idx];
}

/**
 * Map facing direction shorthand / name to degrees
 */
export function parseFacingDirection(facing) {
  if (typeof facing === 'number' && !isNaN(facing)) {
    return ((facing % 360) + 360) % 360;
  }
  if (!facing || typeof facing !== 'string') return null;

  const upper = facing.trim().toUpperCase();
  const map = {
    N: 0, NORTH: 0,
    NNE: 22.5,
    NE: 45, NORTHEAST: 45,
    ENE: 67.5,
    E: 90, EAST: 90,
    ESE: 112.5,
    SE: 135, SOUTHEAST: 135,
    SSE: 157.5,
    S: 180, SOUTH: 180,
    SSW: 202.5,
    SW: 225, SOUTHWEST: 225,
    WSW: 247.5,
    W: 270, WEST: 270,
    WNW: 292.5,
    NW: 315, NORTHWEST: 315,
    NNW: 337.5
  };

  return map[upper] !== undefined ? map[upper] : null;
}

/**
 * Convert bearing to relative direction based on observer's facing orientation.
 * (e.g. "front-left", "right", "directly behind")
 *
 * @param {number} bearingDeg - True azimuth from observer to plane (0-360)
 * @param {number|string} facingDirection - Observer facing direction ('N', 'SW', or degrees 0-360)
 * @returns {string|null} Relative direction string
 */
export function getRelativeDirection(bearingDeg, facingDirection) {
  const facingDeg = parseFacingDirection(facingDirection);
  if (facingDeg === null) return null;

  const relAngle = ((bearingDeg - facingDeg) + 360) % 360;

  if (relAngle >= 337.5 || relAngle < 22.5) return 'straight ahead';
  if (relAngle >= 22.5 && relAngle < 67.5) return 'front-right';
  if (relAngle >= 67.5 && relAngle < 112.5) return 'to your right';
  if (relAngle >= 112.5 && relAngle < 157.5) return 'back-right';
  if (relAngle >= 157.5 && relAngle < 202.5) return 'behind you';
  if (relAngle >= 202.5 && relAngle < 247.5) return 'back-left';
  if (relAngle >= 247.5 && relAngle < 292.5) return 'to your left';
  return 'front-left';
}

/**
 * Format complete, human-friendly look direction string.
 * Example outputs:
 *   - "Look SW, 40° up"
 *   - "Look SW (front-left), 40° up" (when user facing direction is configured)
 *
 * @param {number} bearingDeg - Azimuth from observer to target (0-360)
 * @param {number} elevationDeg - Elevation angle above horizon
 * @param {number|string|null} [userFacing=null] - Observer facing direction
 * @returns {string} Formatted look instruction
 */
export function formatLookDirection(bearingDeg, elevationDeg, userFacing = null) {
  const compass = bearingToCompass(bearingDeg, false);
  const elevRounded = Math.max(0, Math.round(elevationDeg));
  const relative = getRelativeDirection(bearingDeg, userFacing);

  if (relative) {
    return `Look ${compass} (${relative}), ${elevRounded}° up`;
  }
  return `Look ${compass}, ${elevRounded}° up`;
}

/**
 * Parse a raw string or number into a coordinate float.
 * Transparently supports comma decimal (e.g. "48,8584") and dot decimal.
 * Never rounds or truncates the input value.
 *
 * @param {string|number} raw
 * @returns {number} float or NaN
 */
export function parseCoordinate(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return NaN;
  const str = String(raw).trim().replace(',', '.');
  return parseFloat(str);
}

/**
 * Automatically detects and parses pasted coordinate pairs.
 * Supports "lat, lon", "lat / lon", "lat; lon", with either comma or dot decimals.
 * Examples:
 *   - "48.8584, 2.2945"
 *   - "48,8584; 2,2945"
 *
 * @param {string} raw
 * @returns {{ lat: number, lon: number } | null}
 */
export function parseCoordinatePair(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  
  // Delimited coordinate pair: e.g. "48.8584, 2.2945" or "48,8584; 2,2945"
  const match = str.match(/^([+-]?\d+(?:[.,]\d+)?)\s*[,;\/\s]+\s*([+-]?\d+(?:[.,]\d+)?)$/);
  if (match) {
    const lat = parseCoordinate(match[1]);
    const lon = parseCoordinate(match[2]);
    if (!isNaN(lat) && lat >= -90 && lat <= 90 && !isNaN(lon) && lon >= -180 && lon <= 180) {
      return { lat, lon };
    }
  }
  return null;
}

/**
 * Format a coordinate for display in input fields and UI.
 * Shows up to 7 decimal places, trimming trailing zeros.
 * Leaves the underlying stored float 100% untouched.
 *
 * @param {number|string} val
 * @returns {string}
 */
export function formatCoordinateForDisplay(val) {
  if (val == null || val === '') return '';
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
  if (isNaN(num)) return '';
  const fixed = num.toFixed(7);
  return fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

/**
 * Validate latitude and longitude bounds.
 *
 * @param {number} lat -90 to 90
 * @param {number} lon -180 to 180
 * @returns {boolean}
 */
export function isValidCoordinate(lat, lon) {
  return typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90 &&
         typeof lon === 'number' && !isNaN(lon) && lon >= -180 && lon <= 180;
}

/**
 * Classify a flight pass as "overhead" or "near".
 *
 * overhead:
 *   - inbound (time to CPA greater than 0)
 *   - CPA distance <= overheadThresholdKm
 *   - elevation at CPA >= minimum elevation setting
 *
 * everything else inside detection radius = near (moving away, already past,
 * stationary/ground, no valid ETA).
 *
 * @param {object} flight - Aircraft object with CPA / kinematics metrics
 * @param {object} [settings] - Settings object containing overheadThresholdKm and minElevationDeg
 * @returns {'overhead' | 'near'}
 */
export function classifyPass(flight, settings = {}) {
  if (!flight) return 'near';

  const overheadThresholdKm = (settings && settings.overheadThresholdKm != null)
    ? Number(settings.overheadThresholdKm)
    : 5;
  const minElevationDeg = (settings && settings.minElevationDeg != null)
    ? Number(settings.minElevationDeg)
    : 15;

  // tCpa / eta check: must be strictly inbound (time to CPA greater than 0)
  const tCpa = flight.tCpa != null ? Number(flight.tCpa) : (flight.eta != null ? Number(flight.eta) : null);
  if (tCpa === null || isNaN(tCpa) || tCpa <= 0) {
    return 'near';
  }

  // isInbound check (if explicitly provided as false)
  if (flight.isInbound === false) {
    return 'near';
  }

  // CPA distance check: must be <= overheadThresholdKm
  const dCpa = flight.dCpa != null ? Number(flight.dCpa) : (flight.minDist != null ? Number(flight.minDist) : null);
  if (dCpa === null || isNaN(dCpa) || dCpa > overheadThresholdKm) {
    return 'near';
  }

  // Elevation angle at CPA check: must be >= minElevationDeg
  const elevationAtCpa = flight.elevationAtCpa != null
    ? Number(flight.elevationAtCpa)
    : (flight.elevation != null ? Number(flight.elevation) : null);
  if (elevationAtCpa === null || isNaN(elevationAtCpa) || elevationAtCpa < minElevationDeg) {
    return 'near';
  }

  return 'overhead';
}

/**
 * Format the sub-line for an OVERHEAD flight row:
 * "<aircraft type> · now <distance> <compass direction>" using current distance and bearing,
 * plus "passes within <CPA distance>" only when CPA is greater than 1 km.
 * Never prints a direction next to a distance below 1 km; prints "overhead" instead.
 *
 * @param {object} flight - Flight object
 * @returns {string} Formatted subline string
 */
export function formatOverheadRowSubline(flight) {
  if (!flight) return '';
  const acType = (flight.aircraftType || 'Aircraft').trim();
  const currentDist = flight.distance != null ? Number(flight.distance) : 0;
  const currentBearing = flight.currentBearing != null
    ? Number(flight.currentBearing)
    : (flight.bearingAtCpa != null ? Number(flight.bearingAtCpa) : 0);

  let currentPosStr = '';
  if (currentDist < 1.0) {
    currentPosStr = 'now overhead';
  } else {
    const roundedDist = Math.round(currentDist);
    const compass = bearingToCompass(currentBearing, false);
    currentPosStr = `now ${roundedDist} km ${compass}`;
  }

  const dCpa = flight.dCpa != null ? Number(flight.dCpa) : (flight.minDist != null ? Number(flight.minDist) : null);
  let cpaSuffix = '';
  if (dCpa !== null && dCpa > 1.0) {
    const roundedCpa = Math.round(dCpa);
    cpaSuffix = ` · passes within ${roundedCpa} km`;
  }

  return `${acType} · ${currentPosStr}${cpaSuffix}`;
}


