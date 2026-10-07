// ============================================================
//  AIRVEE — Diagnostics Engine (Opt-in)
//  - Keeps a ring buffer of the last 200 polls in chrome.storage.local
//  - Strictly records relative telemetry (distance, bearing, CPA)
//  - NEVER records or exports absolute latitude/longitude
// ============================================================

export const MAX_DIAGNOSTICS_POLLS = 200;
export const DIAGNOSTICS_STORAGE_KEY = 'diagnosticsRingBuffer';

/**
 * Creates a redacted diagnostic snapshot for an individual aircraft in a poll.
 * Strictly avoids absolute coordinates.
 *
 * @param {object} params
 * @returns {object} Redacted diagnostic entry
 */
export function buildAircraftDiagnosticRecord({
  flight,
  cpa,
  passClass,
  classificationResult,
  droppedReason = null
}) {
  const f = flight || {};
  const c = cpa || {};
  const classRes = classificationResult || {};

  return {
    callsign: f.callsign || f.flightNumber || '—',
    airline: f.airline || '—',
    aircraftType: f.aircraftType || '—',
    altitude: f.altitudeFt != null ? f.altitudeFt : (f.altitude != null ? f.altitude : 0),
    speed: f.groundSpeedKt != null ? f.groundSpeedKt : (f.speed != null ? f.speed : 0),
    track: f.trackDeg != null ? f.trackDeg : (f.heading != null ? f.heading : 0),
    verticalRate: f.verticalRateFpm != null ? f.verticalRateFpm : (f.verticalSpeed != null ? f.verticalSpeed : 0),
    onGround: Boolean(f.onGround || f.ground || false),
    dataAge: f.timestamp ? Math.max(0, Math.floor(Date.now() / 1000) - Number(f.timestamp)) : 0,
    flightType: classRes.flightType || 'unknown',
    classificationRule: classRes.rule || 'unknown',
    dropped: droppedReason !== null,
    droppedFilter: droppedReason,
    distanceKm: c.currentDistanceKm != null ? Math.round(c.currentDistanceKm * 10) / 10 : null,
    bearingDeg: c.currentBearing != null ? Math.round(c.currentBearing) : null,
    cpaDistanceKm: c.dCpa != null ? Math.round(c.dCpa * 10) / 10 : null,
    cpaTimeSeconds: c.tCpa != null ? Math.round(c.tCpa) : null,
    passClassification: passClass || 'near'
  };
}

/**
 * Appends a poll cycle snapshot to the ring buffer, capping at MAX_DIAGNOSTICS_POLLS.
 *
 * @param {Array<object>} existingBuffer - Current ring buffer array
 * @param {object} pollSnapshot - Poll snapshot containing poll metadata & aircraft diagnostics
 * @returns {Array<object>} Updated ring buffer
 */
export function appendPollToRingBuffer(existingBuffer = [], pollSnapshot) {
  const buffer = Array.isArray(existingBuffer) ? [...existingBuffer] : [];
  buffer.push(pollSnapshot);
  if (buffer.length > MAX_DIAGNOSTICS_POLLS) {
    buffer.splice(0, buffer.length - MAX_DIAGNOSTICS_POLLS);
  }
  return buffer;
}

/**
 * Validates that an export payload contains zero absolute geographic coordinates.
 * Recursively checks keys and string representations.
 *
 * @param {any} data
 * @returns {boolean} True if safe (no lat/lon coordinates found)
 */
export function verifyRedaction(data) {
  if (data === null || typeof data !== 'object') return true;

  const forbiddenKeys = [
    'lat', 'latitude', 'lon', 'longitude', 'acLat', 'acLon', 'obsLat', 'obsLon'
  ];

  if (Array.isArray(data)) {
    return data.every(verifyRedaction);
  }

  for (const [key, value] of Object.entries(data)) {
    if (forbiddenKeys.includes(key.toLowerCase())) {
      return false;
    }
    if (typeof value === 'object' && value !== null) {
      if (!verifyRedaction(value)) return false;
    }
  }

  return true;
}
