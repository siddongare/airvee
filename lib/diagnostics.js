// ============================================================
//  AIRVEE — Diagnostics Engine (Opt-in)
//  - Stores poll telemetry in IndexedDB ('diagnostics_polls' store)
//  - One record per poll keyed by timestamp, pruned to 200 polls
//  - Strictly records relative telemetry (distance, bearing, CPA)
//  - NEVER records or exports absolute latitude/longitude
// ============================================================

import { openDB, DIAGNOSTICS_STORE_NAME } from './db.js';

export const MAX_DIAGNOSTICS_POLLS = 200;
export const DIAGNOSTICS_STORAGE_KEY = 'diagnosticsRingBuffer'; // Legacy key for migration

// In-memory fallback store for Node.js test environments without native IndexedDB
const inMemoryFallbackStore = new Map();

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
  shown = true,
  hiddenBy = null,
  alertSuppressedBy = null,
  passClass = 'near',
  classificationResult,
  droppedReason = null,
  pollTimeMs = Date.now(),
  matchedRule = null,
  matchedRuleName = null,
  matchedRuleId = null,
  ruleAction = null,
  action = null
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

  const isShown = typeof shown === 'boolean' ? shown : (droppedReason === null);
  const resolvedHiddenBy = hiddenBy !== null ? hiddenBy : droppedReason;

  const resolvedMatchedRuleName = matchedRuleName || (matchedRule ? (typeof matchedRule === 'string' ? matchedRule : matchedRule.name) : null);
  const resolvedMatchedRuleId = matchedRuleId || (matchedRule && typeof matchedRule === 'object' ? matchedRule.id : null);
  const resolvedRuleAction = ruleAction || action || null;

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
    shown: isShown,
    hiddenBy: resolvedHiddenBy,
    alertSuppressedBy: alertSuppressedBy !== undefined ? alertSuppressedBy : null,
    passClass: passClass || 'near',
    dropped: !isShown,
    droppedFilter: resolvedHiddenBy,
    matchedRule: resolvedMatchedRuleName,
    matchedRuleId: resolvedMatchedRuleId,
    ruleAction: resolvedRuleAction,
    distanceKm: c.currentDistanceKm != null ? Math.round(c.currentDistanceKm * 10) / 10 : null,
    bearingDeg: c.currentBearing != null ? Math.round(c.currentBearing) : null,
    cpaDistanceKm: c.dCpa != null ? Math.round(c.dCpa * 10) / 10 : null,
    cpaTimeSeconds: c.tCpa != null ? Math.round(c.tCpa) : null,
    passClassification: passClass || 'near'
  };
}

/**
 * Legacy in-memory append helper (retained for backward compatibility).
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
 * Removes legacy 'diagnosticsRingBuffer' key from chrome.storage.local (one-time migration).
 */
export async function migrateDiagnosticsStorage() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      await chrome.storage.local.remove(DIAGNOSTICS_STORAGE_KEY);
    } catch (e) {}
  }
}

/**
 * Saves a single poll cycle snapshot to IndexedDB and prunes the store to MAX_DIAGNOSTICS_POLLS.
 * Does NOT rewrite the entire ring buffer.
 *
 * @param {object} pollSnapshot - Poll cycle snapshot
 * @returns {Promise<boolean>}
 */
export async function saveDiagnosticPoll(pollSnapshot) {
  await migrateDiagnosticsStorage();

  const isIdbAvailable = typeof indexedDB !== 'undefined';

  if (!isIdbAvailable) {
    // In-memory fallback for Node.js test environment
    inMemoryFallbackStore.set(pollSnapshot.pollTime, pollSnapshot);
    if (inMemoryFallbackStore.size > MAX_DIAGNOSTICS_POLLS) {
      const keys = Array.from(inMemoryFallbackStore.keys()).sort((a, b) => a - b);
      const excess = keys.length - MAX_DIAGNOSTICS_POLLS;
      for (let i = 0; i < excess; i++) {
        inMemoryFallbackStore.delete(keys[i]);
      }
    }
    return true;
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DIAGNOSTICS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(DIAGNOSTICS_STORE_NAME);

    store.put(pollSnapshot);

    // Prune oldest records if count exceeds MAX_DIAGNOSTICS_POLLS
    const countReq = store.count();
    countReq.onsuccess = () => {
      const count = countReq.result;
      if (count > MAX_DIAGNOSTICS_POLLS) {
        const excess = count - MAX_DIAGNOSTICS_POLLS;
        let deleted = 0;
        const cursorReq = store.openCursor(); // iterates ascending by pollTime
        cursorReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor && deleted < excess) {
            cursor.delete();
            deleted++;
            cursor.continue();
          }
        };
      }
    };

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieves all stored diagnostic poll snapshots sorted chronologically.
 *
 * @returns {Promise<Array<object>>}
 */
export async function getDiagnosticPolls() {
  const isIdbAvailable = typeof indexedDB !== 'undefined';

  if (!isIdbAvailable) {
    const polls = Array.from(inMemoryFallbackStore.values());
    polls.sort((a, b) => a.pollTime - b.pollTime);
    return polls;
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DIAGNOSTICS_STORE_NAME, 'readonly');
    const store = tx.objectStore(DIAGNOSTICS_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result || [];
      results.sort((a, b) => a.pollTime - b.pollTime);
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clears all diagnostic polls from storage.
 *
 * @returns {Promise<boolean>}
 */
export async function clearDiagnosticPolls() {
  await migrateDiagnosticsStorage();
  inMemoryFallbackStore.clear();

  if (typeof indexedDB === 'undefined') {
    return true;
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DIAGNOSTICS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(DIAGNOSTICS_STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
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
 * Calculate median and 90th percentile from an array of numbers.
 *
 * @param {Array<number>} numbers
 * @returns {{ median: number|null, p90: number|null }}
 */
export function calculateMedianAndP90(numbers) {
  if (!numbers || !numbers.length) {
    return { median: null, p90: null };
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10
    : sorted[mid];

  const p90Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9));
  const p90 = sorted[p90Idx];

  return { median, p90 };
}

/**
 * Computes an aggregate summary for diagnostics export payload.
 * Strictly avoids absolute coordinates.
 *
 * @param {Array<object>} polls - Array of poll cycle snapshots
 * @param {object} [options]
 * @param {number} [options.radiusKm=30] - Observer detection radius in km
 * @returns {object} Diagnostic summary statistics
 */
export function generateDiagnosticsSummary(polls = [], options = {}) {
  const summary = {
    flightTypeTotals: {
      domestic: 0,
      international: 0,
      unknown: 0
    },
    hiddenByTotals: {
      flightFilter: 0,
      altitudeFilter: 0,
      airlineFilter: 0,
      aircraftFilter: 0,
      altitudeBounds: 0,
      invalid_coordinates: 0,
      other: 0
    },
    alertSuppressedByTotals: {
      not_overhead: 0,
      minElevation: 0,
      eta_out_of_bounds: 0,
      no_eta: 0,
      watchlist_silent: 0,
      hidden: 0,
      other: 0
    },
    passClassTotals: {
      overhead: 0,
      near: 0
    },
    droppedFilterTotals: {
      flightFilter: 0,
      altitudeFilter: 0,
      minElevation: 0,
      alertRule: 0,
      other: 0
    },
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
    dataAgeUnavailable: 0,
    dataAgeMedian: null,
    dataAgeP90: null,
    distanceBuckets: {
      '0_5km': 0,
      '5_15km': 0,
      '15_30km': 0,
      '30_45km': 0,
      'over45km': 0,
      outsideRadiusTotal: 0,
      outsideRadiusPerPoll: 0
    },
    overheadWithoutAlert: {
      total: 0,
      reasons: {
        eta_out_of_bounds: 0,
        minElevation: 0,
        rule_log: 0,
        watchlist_silent: 0,
        no_eta: 0,
        hidden: 0,
        other: 0
      }
    },
    firstSeenTcpaBuckets: {
      under30s: 0,
      '30_90s': 0,
      '90_150s': 0,
      over150s: 0
    },
    topUnknownAirlines: []
  };

  const unknownAirlinesMap = {};
  const validDataAges = [];
  const overheadPassesMap = new Map();
  const pollList = Array.isArray(polls) ? polls : [];

  for (const poll of pollList) {
    if (!poll || !Array.isArray(poll.aircraft)) continue;
    const pollDetectionRadius = poll.detectionRadiusKm || options.radiusKm || 30;

    for (const ac of poll.aircraft) {
      // 1. Flight Type Totals
      if (ac.flightType === 'domestic') {
        summary.flightTypeTotals.domestic++;
      } else if (ac.flightType === 'international') {
        summary.flightTypeTotals.international++;
      } else {
        summary.flightTypeTotals.unknown++;
      }

      // 2. Hidden By & Dropped Filter Totals
      const hiddenReason = ac.hiddenBy !== undefined ? ac.hiddenBy : (ac.dropped ? ac.droppedFilter : null);
      if (hiddenReason) {
        if (summary.hiddenByTotals[hiddenReason] !== undefined) {
          summary.hiddenByTotals[hiddenReason]++;
        } else {
          summary.hiddenByTotals[hiddenReason] = 1;
        }

        if (summary.droppedFilterTotals[hiddenReason] !== undefined) {
          summary.droppedFilterTotals[hiddenReason]++;
        } else {
          summary.droppedFilterTotals[hiddenReason] = 1;
        }
      }

      // 3. Alert Suppressed By Totals
      if (ac.alertSuppressedBy) {
        if (summary.alertSuppressedByTotals[ac.alertSuppressedBy] !== undefined) {
          summary.alertSuppressedByTotals[ac.alertSuppressedBy]++;
        } else {
          summary.alertSuppressedByTotals[ac.alertSuppressedBy] = 1;
        }
      }

      // 4. Pass Class Totals & Overhead Pass Tracking
      const pClass = ac.passClass || ac.passClassification;
      if (pClass === 'overhead') {
        summary.passClassTotals.overhead++;

        const flightKey = (ac.callsign && ac.callsign !== '—')
          ? ac.callsign
          : (ac.flightNumber || ac.id || `${ac.airline}_${ac.altitude}_${ac.track}`);

        const tcpaVal = typeof ac.cpaTimeSeconds === 'number'
          ? ac.cpaTimeSeconds
          : (typeof ac.tCpa === 'number'
              ? Math.round(ac.tCpa)
              : (typeof ac.eta === 'number' ? ac.eta : null));

        const didAlert = ac.alertSuppressedBy === null && ac.shown !== false;

        if (!overheadPassesMap.has(flightKey)) {
          overheadPassesMap.set(flightKey, {
            firstSeenTcpa: tcpaVal,
            alerted: didAlert,
            suppressionReasons: ac.alertSuppressedBy ? [ac.alertSuppressedBy] : []
          });
        } else {
          const pass = overheadPassesMap.get(flightKey);
          if (didAlert) {
            pass.alerted = true;
          } else if (ac.alertSuppressedBy) {
            pass.suppressionReasons.push(ac.alertSuppressedBy);
          }
        }
      } else if (pClass === 'near') {
        summary.passClassTotals.near++;
      }

      // 3. Missing Fields
      if (!ac.origin || ac.origin === '—') {
        summary.missingFields.noOrigin++;
      }
      if (!ac.destination || ac.destination === '—') {
        summary.missingFields.noDestination++;
      }
      if (!ac.aircraftType || ac.aircraftType === '—') {
        summary.missingFields.noAircraftType++;
      }

      // 4. Data Age Metrics
      if (ac.dataAgeSeconds === null || ac.dataAgeSeconds === undefined) {
        summary.dataAgeUnavailable++;
      } else if (typeof ac.dataAgeSeconds === 'number') {
        validDataAges.push(ac.dataAgeSeconds);
        if (ac.dataAgeSeconds > 60) summary.dataAgeBuckets.over60s++;
        if (ac.dataAgeSeconds > 300) summary.dataAgeBuckets.over300s++;
        if (ac.dataAgeSeconds > 900) summary.dataAgeBuckets.over900s++;
      }

      // 5. Distance Buckets (relative distance only)
      if (typeof ac.distanceKm === 'number' && !isNaN(ac.distanceKm)) {
        const d = ac.distanceKm;
        if (d <= 5) summary.distanceBuckets['0_5km']++;
        else if (d <= 15) summary.distanceBuckets['5_15km']++;
        else if (d <= 30) summary.distanceBuckets['15_30km']++;
        else if (d <= 45) summary.distanceBuckets['30_45km']++;
        else summary.distanceBuckets['over45km']++;

        if (d > pollDetectionRadius) {
          summary.distanceBuckets.outsideRadiusTotal++;
        }
      }

      // 6. Top Unknown Airlines
      if (ac.flightType === 'unknown' && ac.airline && ac.airline !== '—') {
        unknownAirlinesMap[ac.airline] = (unknownAirlinesMap[ac.airline] || 0) + 1;
      }
    }
  }

  // Calculate Data Age Median & 90th percentile
  const { median, p90 } = calculateMedianAndP90(validDataAges);
  summary.dataAgeMedian = median;
  summary.dataAgeP90 = p90;

  // Calculate average outside radius per poll
  summary.distanceBuckets.outsideRadiusPerPoll = pollList.length > 0
    ? Math.round((summary.distanceBuckets.outsideRadiusTotal / pollList.length) * 10) / 10
    : 0;

  summary.topUnknownAirlines = Object.entries(unknownAirlinesMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([airline, count]) => ({ airline, count }));

  // Overhead pass statistics: firstSeenTcpaBuckets and overheadWithoutAlert
  for (const pass of overheadPassesMap.values()) {
    const t = pass.firstSeenTcpa;
    if (typeof t === 'number' && !isNaN(t)) {
      if (t < 30) {
        summary.firstSeenTcpaBuckets.under30s++;
      } else if (t < 90) {
        summary.firstSeenTcpaBuckets['30_90s']++;
      } else if (t <= 150) {
        summary.firstSeenTcpaBuckets['90_150s']++;
      } else {
        summary.firstSeenTcpaBuckets.over150s++;
      }
    }

    if (!pass.alerted) {
      summary.overheadWithoutAlert.total++;
      const reason = pass.suppressionReasons.length > 0
        ? pass.suppressionReasons[pass.suppressionReasons.length - 1]
        : 'other';
      if (summary.overheadWithoutAlert.reasons[reason] !== undefined) {
        summary.overheadWithoutAlert.reasons[reason]++;
      } else {
        summary.overheadWithoutAlert.reasons[reason] = 1;
      }
      summary.overheadWithoutAlert[reason] = (summary.overheadWithoutAlert[reason] || 0) + 1;
    }
  }

  return summary;
}

