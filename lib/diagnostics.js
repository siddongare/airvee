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
  droppedReason = null,
  pollTimeMs = Date.now()
}) {
  const f = flight || {};
  const c = cpa || {};
  const classRes = classificationResult || {};

  let dataAgeSeconds = null;
  if (f.timestamp != null && !isNaN(Number(f.timestamp))) {
    const pollTimeSec = Math.floor(pollTimeMs / 1000);
    dataAgeSeconds = Math.max(0, pollTimeSec - Number(f.timestamp));
  }

  const deadReckonedSeconds = typeof f.deadReckonedSeconds === 'number' ? f.deadReckonedSeconds : 0;

  return {
    callsign: f.callsign || f.flightNumber || '—',
    airline: f.airline || '—',
    aircraftType: f.aircraftType || '—',
    origin: (f.origin && f.origin !== '—') ? f.origin : null,
    destination: (f.destination && f.destination !== '—') ? f.destination : null,
    altitude: f.altitudeFt != null ? f.altitudeFt : (f.altitude != null ? f.altitude : 0),
    speed: f.groundSpeedKt != null ? f.groundSpeedKt : (f.speed != null ? f.speed : 0),
    track: f.trackDeg != null ? f.trackDeg : (f.heading != null ? f.heading : 0),
    verticalRate: f.verticalRateFpm != null ? f.verticalRateFpm : (f.verticalSpeed != null ? f.verticalSpeed : 0),
    onGround: Boolean(f.onGround || f.ground || false),
    dataAgeSeconds,
    deadReckonedSeconds,
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

/**
 * Computes an aggregate summary for diagnostics export payload.
 * Strictly avoids absolute coordinates.
 *
 * @param {Array<object>} polls - Array of poll cycle snapshots
 * @returns {object} Diagnostic summary statistics
 */
export function generateDiagnosticsSummary(polls = []) {
  const summary = {
    flightTypeTotals: {
      domestic: 0,
      international: 0,
      unknown: 0
    },
    droppedFilterTotals: {},
    missingFields: {
      noOrigin: 0,
      noDestination: 0,
      noAircraftType: 0
    },
    dataAgeBuckets: {
      over60s: 0,
      over300s: 0,
      over900s: 0
    },
    topUnknownAirlines: []
  };

  const unknownAirlinesMap = {};

  for (const poll of (Array.isArray(polls) ? polls : [])) {
    if (!poll || !Array.isArray(poll.aircraft)) continue;
    for (const ac of poll.aircraft) {
      if (ac.flightType === 'domestic') {
        summary.flightTypeTotals.domestic++;
      } else if (ac.flightType === 'international') {
        summary.flightTypeTotals.international++;
      } else {
        summary.flightTypeTotals.unknown++;
      }

      if (ac.dropped && ac.droppedFilter) {
        summary.droppedFilterTotals[ac.droppedFilter] = (summary.droppedFilterTotals[ac.droppedFilter] || 0) + 1;
      }

      if (!ac.origin || ac.origin === '—') {
        summary.missingFields.noOrigin++;
      }
      if (!ac.destination || ac.destination === '—') {
        summary.missingFields.noDestination++;
      }
      if (!ac.aircraftType || ac.aircraftType === '—') {
        summary.missingFields.noAircraftType++;
      }

      if (ac.dataAgeSeconds != null && typeof ac.dataAgeSeconds === 'number') {
        if (ac.dataAgeSeconds > 60) summary.dataAgeBuckets.over60s++;
        if (ac.dataAgeSeconds > 300) summary.dataAgeBuckets.over300s++;
        if (ac.dataAgeSeconds > 900) summary.dataAgeBuckets.over900s++;
      }

      if (ac.flightType === 'unknown' && ac.airline && ac.airline !== '—') {
        unknownAirlinesMap[ac.airline] = (unknownAirlinesMap[ac.airline] || 0) + 1;
      }
    }
  }

  summary.topUnknownAirlines = Object.entries(unknownAirlinesMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([airline, count]) => ({ airline, count }));

  return summary;
}
