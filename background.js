// ============================================================
//  AIRVEE — Background Service Worker
//  Core flight tracking engine with notification system
// ============================================================

import { fetchFlightsNear, getProviderStatus } from './providers/index.js';
import {
  haversineDistance,
  calculateBearing,
  calculateElevationAngle,
  calculateCPA,
  deadReckonPosition,
  formatLookDirection,
  classifyPass
} from './lib/geo.js';
import { isQuietHours, getCalendarDayKey } from './lib/audio.js';
import { logFlightPass, cacheCallsignRoute, resolveRouteFromCache, getSightingCounts, checkIsFirstTimeSeen, openDB } from './lib/db.js';
import { evaluateFlightWatchlist, isInherentlyRare, isMilitaryAircraft, isCargoAircraft, DEFAULT_INHERENTLY_RARE_TYPES } from './lib/watchlist.js';
import { recordHeartbeat } from './lib/schedule.js';
import { calculateSunElevation, fetchCloudCover, classifyVisibility } from './lib/visibility.js';
import { formatNotificationAirline } from './lib/airline-logos.js';
import {
  buildAircraftDiagnosticRecord,
  saveDiagnosticPoll,
  migrateDiagnosticsStorage
} from './lib/diagnostics.js';
import {
  evaluateAircraft,
  classifyFlightWithRule,
  classifyFlight,
  INDIAN_AIRPORTS,
  ALERT_LEAD_MIN_S,
  ALERT_LEAD_MAX_S,
  ETA_MIN_S,
  ETA_MAX_S
} from './lib/filter.js';

import {
  DEFAULTS,
  migrateSettings,
  SCHEMA_VERSION
} from './lib/settings-defaults.js';

export {
  classifyFlightWithRule,
  classifyFlight,
  evaluateAircraft,
  DEFAULTS,
  migrateSettings,
  SCHEMA_VERSION,
  ALERT_LEAD_MIN_S,
  ALERT_LEAD_MAX_S,
  formatETA,
  formatNotificationTitle
};

/**
 * Format ETA in seconds to mm:ss matching popup.js formatETA.
 */
function formatETA(seconds) {
  if (seconds == null || isNaN(seconds) || seconds < 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format notification title with airline, flight ID, and lead time in mm:ss.
 */
function formatNotificationTitle(flight, alertTag = '') {
  const etaStr = formatETA(flight?.eta);
  const airlineName = formatNotificationAirline(flight);
  const flightId = flight ? (flight.flightNumber || flight.callsign) : '';
  const flightIdSuffix = (flightId && !airlineName.includes(flightId)) ? ` ${flightId}` : '';

  let titlePrefix = 'AIRVEE';
  if (alertTag && flight?.isNew) {
    titlePrefix = `AIRVEE [${alertTag} · NEW]`;
  } else if (alertTag) {
    titlePrefix = `AIRVEE [${alertTag}]`;
  } else if (flight?.isNew) {
    titlePrefix = `AIRVEE [NEW]`;
  }
  return `${titlePrefix} · ${airlineName}${flightIdSuffix} · overhead in ${etaStr}`;
}

/**
 * Pure helper to compute updated peak simultaneous flights inside user detection radius.
 * Returns null if not updated, or { maxSimultaneousPlanes, maxSimultaneousAt } if new peak reached.
 */
export function calculatePeakTraffic(processedFlights, radiusKm, currentPeak = 0, isMock = false, timestamp = Date.now()) {
  if (isMock) return null;
  const insideRadiusCount = (processedFlights || []).filter(f => (f.distance != null ? f.distance : 0) <= radiusKm).length;
  if (insideRadiusCount > currentPeak) {
    return {
      maxSimultaneousPlanes: insideRadiusCount,
      maxSimultaneousAt: timestamp
    };
  }
  return null;
}


const POLL_ALARM_NAME = 'airvee-poll';
const POLL_INTERVAL_MIN = 0.5;
const NOTIFICATION_COOLDOWN_MS = 20 * 60 * 1000;

// ---- Adaptive Polling State ----
let fastPollTimeout = null;
let isFastPolling = false;
let fastPollCycles = 0;
const MAX_FAST_POLL_CYCLES = 60; // Max ~5 mins of continuous 5-10s fast loop

/**
 * Try to resolve an airline name from a callsign or ICAO airline code.
 */
function resolveAirline(callsign, airlineIcao) {
  if (airlineIcao && AIRLINES[airlineIcao.toUpperCase()]) {
    return AIRLINES[airlineIcao.toUpperCase()];
  }
  if (callsign && callsign.length >= 3) {
    const prefix = callsign.slice(0, 3).toUpperCase();
    if (AIRLINES[prefix]) return AIRLINES[prefix];
  }
  return '';
}


// ============================================================
//  Settings & Storage Helpers
// ============================================================

async function getSettings() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    const migrated = migrateSettings(settings);
    if (!settings || settings.schemaVersion !== migrated.schemaVersion) {
      await chrome.storage.local.set({ settings: migrated });
    }
    return migrated;
  } catch (e) {
    console.warn('Airvee: Settings load failed, using defaults:', e.message);
    return { ...DEFAULTS };
  }
}

// ============================================================
//  Notification Deduplication (Max 1 Alert Per Flight Per Calendar Day)
// ============================================================

async function hasBeenNotifiedToday(flightId) {
  try {
    const dayKey = getCalendarDayKey();
    const storageKey = `${flightId}_${dayKey}`;
    const { notifiedDayHistory = {} } = await chrome.storage.local.get('notifiedDayHistory');
    return Boolean(notifiedDayHistory[storageKey]);
  } catch {
    return false;
  }
}

async function markNotifiedToday(flightId) {
  try {
    const dayKey = getCalendarDayKey();
    const storageKey = `${flightId}_${dayKey}`;
    const { notifiedDayHistory = {} } = await chrome.storage.local.get('notifiedDayHistory');
    notifiedDayHistory[storageKey] = Date.now();

    // Clean up history older than 48 hours to preserve lean storage
    const cutoff = Date.now() - (48 * 60 * 60 * 1000);
    for (const [k, ts] of Object.entries(notifiedDayHistory)) {
      if (ts < cutoff) delete notifiedDayHistory[k];
    }

    await chrome.storage.local.set({ notifiedDayHistory });
  } catch (e) {
    console.warn('Airvee: Failed to mark notification history:', e.message);
  }
}

// ============================================================
//  Sound Playback via On-Demand Offscreen Document
//  - Created dynamically when audio is triggered
//  - Auto-closed after 30 seconds of silence to conserve resources
// ============================================================

let creatingOffscreenPromise = null;
let offscreenIdleTimer = null;
const OFFSCREEN_IDLE_TIMEOUT_MS = 30000; // 30s auto-close

async function ensureOffscreenDocument() {
  try {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) return;
  } catch (e) {
    // hasDocument may throw if uninitialized
  }

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  creatingOffscreenPromise = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play notification chime for overhead flight alerts'
      });
      // Small pause to guarantee offscreen scripts complete initial evaluation
      await new Promise(r => setTimeout(r, 80));
    } catch (err) {
      if (!err.message.includes('Only a single offscreen document may be created')) {
        console.warn('Airvee: Offscreen creation error:', err.message);
      }
    } finally {
      creatingOffscreenPromise = null;
    }
  })();

  await creatingOffscreenPromise;
}

function resetOffscreenIdleTimer() {
  if (offscreenIdleTimer) {
    clearTimeout(offscreenIdleTimer);
  }
  offscreenIdleTimer = setTimeout(async () => {
    try {
      const hasDoc = await chrome.offscreen.hasDocument();
      if (hasDoc) {
        await chrome.offscreen.closeDocument();
        console.log('Airvee: Offscreen audio document closed after 30s of silence.');
      }
    } catch (e) {
      // Ignore errors when document already closed
    }
  }, OFFSCREEN_IDLE_TIMEOUT_MS);
}

async function playChime(volume = 80, style = 'normal') {
  try {
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({ type: 'PLAY_CHIME', volume, style });
    resetOffscreenIdleTimer();
  } catch (e) {
    console.warn('Airvee: Chime playback error:', e.message);
  }
}


// ============================================================
//  Core Flight Polling & Notification Engine
// ============================================================

async function pollFlights() {
  recordHeartbeat().catch(() => {});
  const settings = await getSettings();

  if (!settings.alertsEnabled) {
    await chrome.storage.local.set({
      nearbyFlights: [],
      lastPollTime: Date.now(),
      lastPollStatus: 'paused'
    });
    return;
  }

  const { latitude, longitude, radiusKm, flightFilter, altitudeFilter = 'all' } = settings;

  let rawFlights = [];
  try {
    rawFlights = await fetchFlightsNear(latitude, longitude, radiusKm * 1.5);
  } catch (err) {
    console.error('Airvee: Flight provider fetch error:', err.message);
    const providerStatus = getProviderStatus(Boolean(settings.mockProviderEnabled));
    await chrome.storage.local.set({
      lastPollTime: Date.now(),
      lastPollStatus: 'error',
      providerStatus
    });
    return;
  }

  const providerStatus = getProviderStatus(Boolean(settings.mockProviderEnabled));



  // Solar calculation (pure math) & Cloud Cover (cached 30 min from Open-Meteo)
  const sunElevation = calculateSunElevation(latitude, longitude, new Date());
  let cloudData = null;
  try {
    cloudData = await fetchCloudCover(latitude, longitude);
  } catch (e) {}

  // ---- Process & Enrich Each Flight ----
  const processed = [];

  for (const f of rawFlights) {
    const flightLat = f.lat != null ? f.lat : f.latitude;
    const flightLon = f.lon != null ? f.lon : f.longitude;
    if (flightLat == null || flightLon == null) continue;
    if (isNaN(flightLat) || isNaN(flightLon)) continue;

    const altitude = f.altitudeFt != null ? f.altitudeFt : f.altitude;
    const speed = f.groundSpeedKt != null ? f.groundSpeedKt : f.speed;
    const heading = f.trackDeg != null ? f.trackDeg : f.heading;
    const vspeed = f.verticalRateFpm != null ? f.verticalRateFpm : (f.verticalSpeed || 0);

    // Route resolution: use provider route if present, or cached callsign route (marked as likely)
    let origin = f.origin || '';
    let destination = f.destination || '';
    let isRouteLikely = false;

    if (origin && destination) {
      cacheCallsignRoute(f.callsign || f.flightNumber, origin, destination).catch(() => {});
    } else {
      const cached = await resolveRouteFromCache(f.callsign || f.flightNumber);
      if (cached) {
        origin = cached.origin;
        destination = cached.destination;
        isRouteLikely = true;
      }
    }

    // Calculate Closest Point of Approach (CPA) with precision kinematics
    const cpa = calculateCPA(
      flightLat,
      flightLon,
      altitude,
      speed,
      heading,
      vspeed,
      latitude,
      longitude,
      settings.groundElevationM || 0, // Observer ground elevation
      radiusKm
    );

    const flightType = classifyFlight(origin, destination);
    const enrichedFlight = {
      ...f,
      flightLat,
      flightLon,
      altitude,
      speed,
      heading,
      vspeed,
      origin,
      destination,
      flightType
    };

    const evaluation = evaluateAircraft(enrichedFlight, settings, cpa);
    if (!evaluation.shown) continue;

    const airline = f.airline || resolveAirline(f.callsign || f.airlineIcao, f.airlineIcao);
    const displayName = f.flightNumber || f.callsign || f.icao || f.id;

    // Calculate LOOK DIRECTION: compass word + elevation (e.g., "Look SW, 40° up" or relative)
    const lookDirection = formatLookDirection(
      cpa.bearingAtCpa,
      cpa.elevationAtCpa,
      settings.userFacing
    );

    // Calculate visibility hint (sun angle + cloud cover + aircraft geometry)
    const visibility = classifyVisibility({
      altitudeFt: altitude,
      elevationAtCpa: cpa.elevationAtCpa,
      currentElevation: cpa.currentElevation,
      distance: cpa.currentDistanceKm
    }, {
      sunElevation,
      cloudData
    });

    processed.push({
      id: f.id,
      callsign: displayName,
      flightNumber: f.flightNumber || displayName,
      airline,
      airlineIcao: f.airlineIcao || '',
      origin,
      destination,
      isRouteLikely,
      lat: flightLat,
      lon: flightLon,
      altitudeFt: altitude,
      groundSpeedKt: speed,
      trackDeg: heading,
      verticalRateFpm: vspeed,
      source: f.source || providerStatus.activeProvider || 'fr24',
      // backward-compat aliases for existing UI code:
      latitude: flightLat,
      longitude: flightLon,
      altitude,
      speed,
      heading,
      verticalSpeed: vspeed,
      distance: Math.round(cpa.currentDistanceKm * 10) / 10,
      eta: cpa.isInbound && cpa.tCpa > 0 ? Math.round(cpa.tCpa) : null,
      minDist: Math.round(cpa.dCpa * 10) / 10,
      tCpa: Math.round(cpa.tCpa),
      dCpa: Math.round(cpa.dCpa * 10) / 10,
      bearingAtCpa: Math.round(cpa.bearingAtCpa),
      elevationAtCpa: Math.round(cpa.elevationAtCpa),
      currentBearing: Math.round(cpa.currentBearing),
      currentElevation: Math.round(cpa.currentElevation),
      passesOverhead: cpa.passesOverhead,
      isInbound: cpa.isInbound,
      passClassification: evaluation.passClass,
      evaluation,
      lookDirection,
      visibilityHint: visibility.hint,
      visibilityRegime: visibility.regime,
      visibilityContrast: visibility.contrast,
      flightType,
      isMilitary: isMilitaryAircraft(f),
      isCargo: isCargoAircraft(f),
      aircraftType: f.aircraftType || '',
      registration: f.registration || '—',
      squawk: f.squawk || '—',
      icao: f.icao || '—',
      lastSeen: Date.now()
    });
  }

  // ---- Check First-Time Seen (Life List & "NEW" Badge Detection) ----
  if (!settings.mockProviderEnabled) {
    try {
      const db = await openDB();
      const historyRecords = await new Promise((res) => {
        const tx = db.transaction('flight_passes', 'readonly');
        const store = tx.objectStore('flight_passes');
        const req = store.getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      });

      for (const flight of processed) {
        if (!flight.isMock && flight.source !== 'mock') {
          const check = checkIsFirstTimeSeen(flight, { records: historyRecords });
          if (check.isNew) {
            flight.isNew = true;
            flight.newLabel = check.label;
          }
        }
      }
    } catch (e) {
      // Non-blocking fallback
    }
  }

  // Sort: approaching flights first (by ETA), then by distance
  processed.sort((a, b) => {
    if (a.eta !== null && b.eta !== null) return a.eta - b.eta;
    if (a.eta !== null) return -1;
    if (b.eta !== null) return 1;
    return a.distance - b.distance;
  });

  // Adaptive polling: fast mode (5-10s) while aircraft inbound within 2x radius; slow (30-60s) otherwise
  const hasInboundTarget = processed.some(
    p => p.isInbound && p.tCpa > 0 && p.tCpa <= 360 && p.dCpa <= (radiusKm * 2)
  );
  updateAdaptivePolling(hasInboundTarget);

  // ---- Update Max Simultaneous Traffic (real flights inside detection radius only) ----
  if (!settings.mockProviderEnabled) {
    try {
      const { maxSimultaneousPlanes = 0 } = await chrome.storage.local.get('maxSimultaneousPlanes');
      const peakUpdate = calculatePeakTraffic(processed, radiusKm, maxSimultaneousPlanes, false);
      if (peakUpdate) {
        await chrome.storage.local.set(peakUpdate);
      }
    } catch (e) {}
  }

  // ---- Opt-in Diagnostics Recording (active ONLY for real provider traffic when diagnosticsEnabled is true) ----
  if (settings.diagnosticsEnabled && !settings.mockProviderEnabled) {
    try {
      const pollTimeMs = Date.now();
      const diagEntries = [];
      for (const f of rawFlights) {
        const flightLat = f.lat != null ? f.lat : f.latitude;
        const flightLon = f.lon != null ? f.lon : f.longitude;
        if (flightLat == null || flightLon == null || isNaN(flightLat) || isNaN(flightLon)) {
          diagEntries.push(buildAircraftDiagnosticRecord({
            flight: f,
            cpa: null,
            shown: false,
            hiddenBy: 'invalid_coordinates',
            alertSuppressedBy: 'hidden',
            passClass: 'near',
            classificationResult: { flightType: 'unknown', rule: 'invalid_coordinates' },
            pollTimeMs
          }));
          continue;
        }

        const alt = f.altitudeFt != null ? f.altitudeFt : (f.altitude || 0);
        const spd = f.groundSpeedKt != null ? f.groundSpeedKt : (f.speed || 0);
        const hdg = f.trackDeg != null ? f.trackDeg : (f.heading || 0);
        const vr = f.verticalRateFpm != null ? f.verticalRateFpm : (f.verticalSpeed || 0);

        const cpaRes = calculateCPA(
          flightLat, flightLon, alt, spd, hdg, vr,
          latitude, longitude, settings.groundElevationM || 0, radiusKm
        );

        let orig = f.origin || '';
        let dest = f.destination || '';
        const cachedRoute = (!orig || !dest) ? await resolveRouteFromCache(f.callsign || f.flightNumber) : null;
        if (cachedRoute) {
          orig = orig || cachedRoute.origin;
          dest = dest || cachedRoute.destination;
        }

        const classRes = classifyFlightWithRule(orig, dest);
        const isInsideRadius = cpaRes.currentDistanceKm <= radiusKm;
        const isUnknownType = classRes.flightType === 'unknown';

        // Record only aircraft inside detection radius, plus any unknown flightType within fetch radius
        if (!isInsideRadius && !isUnknownType) {
          continue;
        }

        const evalRes = evaluateAircraft({
          ...f,
          origin: orig,
          destination: dest,
          flightType: classRes.flightType
        }, settings, cpaRes);

        diagEntries.push(buildAircraftDiagnosticRecord({
          flight: { ...f, origin: orig, destination: dest },
          cpa: cpaRes,
          shown: evalRes.shown,
          hiddenBy: evalRes.hiddenBy,
          alertSuppressedBy: evalRes.alertSuppressedBy,
          passClass: evalRes.passClass,
          matchedRule: evalRes.matchedRule,
          ruleAction: evalRes.action,
          classificationResult: classRes,
          pollTimeMs
        }));
      }

      await saveDiagnosticPoll({
        pollTime: pollTimeMs,
        provider: settings.mockProviderEnabled ? 'mock' : (providerStatus.activeProvider || 'fr24'),
        rawAircraftCount: rawFlights.length,
        detectionRadiusKm: radiusKm,
        pollingMode: isFastPolling ? 'fast' : 'normal',
        aircraftCount: diagEntries.length,
        aircraft: diagEntries
      });
    } catch (diagErr) {
      console.warn('Airvee: Failed to record diagnostics:', diagErr);
    }
  }

  // Persist for the popup UI (cap at 50 for storage efficiency)
  await chrome.storage.local.set({
    nearbyFlights: processed.slice(0, 50),
    lastPollTime: Date.now(),
    lastPollStatus: 'ok',
    lastPollSource: settings.mockProviderEnabled ? 'MOCK' : (providerStatus.activeProvider || 'FR24'),
    pollingMode: isFastPolling ? 'fast' : 'normal',
    providerStatus,
    flightCount: processed.length
  });

  // ---- Send Notifications & Log Overhead Passes ----
  const quietHoursActive = isQuietHours(settings);
  let bestChime = null; // { alertStyle, ignoreQuiet }

  for (const flight of processed) {
    const isOverhead = flight.passClassification === 'overhead';

    // Log any flight that is passing or has passed within user threshold (IndexedDB deduplicates by day)
    // IMPORTANT: Mock flights are strictly excluded from the real flight log
    if (!flight.isMock && flight.source !== 'mock' && !settings.mockProviderEnabled) {
      if (isOverhead || flight.passesOverhead || (flight.distance <= radiusKm && flight.minDist <= radiusKm)) {
        logFlightPass(flight).catch(err => {
          console.warn('Airvee: Failed to log overhead flight:', err);
        });
      }
    }

    // Alerts apply ONLY to flights classified as "overhead"
    if (!isOverhead) continue;

    let sightingCounts = { typeCount: 0, regCount: 0 };
    if (!flight.isMock && flight.source !== 'mock') {
      try {
        sightingCounts = await getSightingCounts(flight.aircraftType, flight.registration);
      } catch (e) {}
    }

    // Evaluate alert eligibility using the shared decision function
    const alertEval = evaluateAircraft(flight, settings, flight, { sightingCounts });
    if (alertEval.alertSuppressedBy !== null) continue;

    let alertStyle = alertEval.action === 'loud' ? 'special' : 'normal';
    let ignoreQuiet = Boolean(alertEval.bypassQuietHours);
    let alertTag = alertEval.matchedRule ? (alertEval.matchedRule.tag || 'ALERT') : '';

    if (alertEval.matchedRule) {
      flight.isWatchlist = true;
      flight.watchlistTag = alertTag;
      flight.watchlistRuleName = alertEval.matchedRule.name;
      flight.alertStyle = alertStyle;
    }

    // 3. Persistent calendar-day deduplication: max 1 alert per flight per calendar day
    const alreadyNotified = await hasBeenNotifiedToday(flight.id);
    if (alreadyNotified) continue;

    const route = (flight.origin && flight.destination)
      ? `${flight.origin} → ${flight.destination}${flight.isRouteLikely ? ' (likely)' : ''}`
      : 'En route';
    const aircraftTypeStr = flight.aircraftType ? ` · ${flight.aircraftType}` : '';

    // Look direction: "Look SW, 40° up" or relative "Look SW (front-left), 40° up"
    const lookDir = formatLookDirection(
      flight.bearingAtCpa,
      flight.elevationAtCpa,
      settings.userFacing
    );

    const title = formatNotificationTitle(flight, alertTag);
    const newSeenStr = (flight.isNew && flight.newLabel) ? ` · First time seen: ${flight.newLabel}` : '';
    const message = `${route}${aircraftTypeStr} · ${lookDir}${flight.watchlistRuleName ? ` · ${flight.watchlistRuleName}` : ''}${newSeenStr}`;

    // Notification ID format: airvee_{flightId}_{source}_{callsign} (used for deep-linking)
    const notifId = `airvee_${flight.id}_${flight.source || 'fr24'}_${encodeURIComponent(flight.callsign || flight.flightNumber || '')}`;

    try {
      await chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title,
        message,
        priority: alertStyle === 'special' ? 2 : 1,
        requireInteraction: alertStyle === 'special',
        silent: true
      });
    } catch (notifError) {
      console.warn('Airvee: Notification failed:', notifError.message);
    }

    await markNotifiedToday(flight.id);

    // Track highest-priority chime for this poll cycle (special > normal)
    if (!bestChime || alertStyle === 'special') {
      bestChime = { alertStyle, ignoreQuiet };
    }
  }

  // Play exactly one chime per poll cycle for the highest-priority overhead flight
  if (bestChime && settings.soundEnabled && (!quietHoursActive || bestChime.ignoreQuiet)) {
    const vol = settings.chimeVolume != null ? settings.chimeVolume : 80;
    await playChime(vol, bestChime.alertStyle);
  }
}

/**
 * Manage adaptive polling loops: fast (7s) when inbound targets are approaching,
 * normal (30s alarm) otherwise.
 */
function updateAdaptivePolling(hasInboundTarget) {
  if (hasInboundTarget) {
    if (!isFastPolling) {
      isFastPolling = true;
      fastPollCycles = 0;
      console.log('Airvee: Inbound traffic detected within 2x radius. Engaging adaptive FAST polling (7s).');
    }

    if (fastPollTimeout) clearTimeout(fastPollTimeout);

    if (fastPollCycles < MAX_FAST_POLL_CYCLES) {
      fastPollCycles++;
      fastPollTimeout = setTimeout(async () => {
        try {
          await pollFlights();
        } catch (e) {
          console.warn('Airvee: Fast poll error:', e);
        }
      }, 7000);
    } else {
      console.log('Airvee: Fast polling cycle cap reached. Returning to standard alarm intervals.');
      isFastPolling = false;
    }
  } else {
    if (isFastPolling) {
      console.log('Airvee: No inbound traffic in range. Disengaging fast mode, standard alarm active.');
      if (fastPollTimeout) {
        clearTimeout(fastPollTimeout);
        fastPollTimeout = null;
      }
      isFastPolling = false;
      fastPollCycles = 0;
    }
  }
}

// ============================================================
//  Event Listeners & Lifecycle
// ============================================================

// Alarm-driven polling
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === POLL_ALARM_NAME) {
    try {
      await pollFlights();
    } catch (e) {
      console.error('Airvee: Unhandled poll error:', e);
    }
  }
});

// Message handling (popup ↔ background)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  switch (msg.type) {
    case 'GET_FLIGHTS':
      chrome.storage.local.get([
        'nearbyFlights', 'lastPollTime', 'lastPollStatus',
        'lastPollSource', 'providerStatus', 'flightCount'
      ]).then(data => {
        sendResponse({
          flights: data.nearbyFlights || [],
          lastPoll: data.lastPollTime || null,
          status: data.lastPollStatus || 'unknown',
          source: data.lastPollSource || '',
          providerStatus: data.providerStatus || getProviderStatus(),
          count: data.flightCount || 0
        });
      }).catch(e => {
        sendResponse({ flights: [], lastPoll: null, status: 'error', providerStatus: getProviderStatus() });
      });
      return true; // keep sendResponse channel open for async

    case 'FORCE_POLL':
      pollFlights()
        .then(() => sendResponse({ success: true }))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;

    case 'SETTINGS_UPDATED':
      // Re-poll with new settings immediately
      pollFlights().catch(e => console.error('Airvee: Settings re-poll error:', e));
      sendResponse({ acknowledged: true });
      return false;

    case 'TEST_CHIME':
      getSettings().then(stg => {
        const vol = msg.volume != null ? msg.volume : (stg.chimeVolume || 80);
        return playChime(vol);
      })
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
      return true;

    case 'TEST_WATCHLIST_RULE':
      getSettings().then(async stg => {
        const rule = msg.rule || {};
        const alertStyle = rule.alertStyle || 'special';
        const tag = (rule.rareOnly) ? 'RARE' : 'WATCH';
        const notifId = `airvee_test_rule_${Date.now()}`;
        try {
          await chrome.notifications.create(notifId, {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: `AIRVEE [${tag}] · TEST ALERT`,
            message: `Rule: "${rule.name || 'Sample Rule'}" · Look SW (front-left), 42° up`,
            priority: 2,
            silent: true
          });
        } catch (e) {}

        const vol = stg.chimeVolume != null ? stg.chimeVolume : 80;
        if (alertStyle !== 'silent') {
          await playChime(vol, alertStyle);
        }
      })
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
      return true;


    case 'PLAY_CHIME':
      // Handled directly by offscreen document
      return false;

    default:
      return false;
  }
});

// Initial setup on install / reload
chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) {
    await chrome.storage.local.set({ settings: { ...DEFAULTS } });
  } else {
    // Merge any newly introduced default properties while strictly preserving user's coordinates
    await chrome.storage.local.set({ settings: { ...DEFAULTS, ...settings } });
  }

  await chrome.alarms.create(POLL_ALARM_NAME, {
    delayInMinutes: 0.1,
    periodInMinutes: POLL_INTERVAL_MIN
  });

  // Initial poll
  setTimeout(() => pollFlights().catch(console.error), 2000);
});

// Re-create alarm on browser startup (persists across restarts)
chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(POLL_ALARM_NAME, {
    delayInMinutes: 0.1,
    periodInMinutes: POLL_INTERVAL_MIN
  });
});

// Handle notification clicks: deep-link directly to flight tracking
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId && notificationId.startsWith('airvee_')) {
    const parts = notificationId.split('_');
    const source = parts[2] || 'fr24';
    const callsign = decodeURIComponent(parts[3] || '');

    let url = 'https://www.flightradar24.com';
    if (callsign) {
      if (source === 'fr24') {
        url = `https://www.flightradar24.com/${encodeURIComponent(callsign)}`;
      } else if (source === 'adsb_lol' || source === 'adsblol') {
        url = `https://globe.adsb.lol/?callsign=${encodeURIComponent(callsign)}`;
      } else {
        url = `https://www.flightradar24.com/${encodeURIComponent(callsign)}`;
      }
    }

    try {
      chrome.tabs.create({ url });
    } catch (tabErr) {
      console.warn('Airvee: Failed to open flight tracking tab:', tabErr);
    }
  }
  chrome.notifications.clear(notificationId);
});

// ============================================================
//  Service Worker Wake-up Recovery & Self-Healing
//  - MV3 service workers are terminated on idle (~30s)
//  - On wake-up, verify alarm schedule is active and clean
// ============================================================
async function selfHealServiceWorker() {
  try {
    const alarm = await chrome.alarms.get(POLL_ALARM_NAME);
    if (!alarm) {
      console.log('Airvee: Restoring poll alarm on service worker wake-up.');
      await chrome.alarms.create(POLL_ALARM_NAME, {
        delayInMinutes: 0.1,
        periodInMinutes: POLL_INTERVAL_MIN
      });
    }
  } catch (e) {
    console.warn('Airvee: Self-heal check error:', e.message);
  }
}

selfHealServiceWorker();

