import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAircraft, classifyFlight, ALERT_LEAD_MIN_S, ALERT_LEAD_MAX_S, ETA_MIN_S, ETA_MAX_S } from '../lib/filter.js';
import { classifyPass } from '../lib/geo.js';

/**
 * EXACT copy of the old reference filtering and alert decision logic
 * extracted directly from background.js (lines 415-548 and lines 771-824).
 */
function oldLiveReferenceDecision(f, settings, cpa, options = {}) {
  const flightLat = f.lat != null ? f.lat : f.latitude;
  const flightLon = f.lon != null ? f.lon : f.longitude;
  if (flightLat == null || flightLon == null || isNaN(flightLat) || isNaN(flightLon)) {
    return { shown: false, passClass: 'near', willAlert: false };
  }

  const altitude = f.altitudeFt != null ? f.altitudeFt : (f.altitude || 0);
  const altitudeFilter = settings.altitudeFilter || 'all';
  if (altitudeFilter === 'high' && altitude < 25000) return { shown: false, passClass: 'near', willAlert: false };
  if (altitudeFilter === 'low' && altitude >= 25000) return { shown: false, passClass: 'near', willAlert: false };

  const origin = f.origin || '';
  const destination = f.destination || '';
  const flightType = f.flightType || classifyFlight(origin, destination);
  const flightFilter = settings.flightFilter || 'all';
  if (flightFilter === 'international' && flightType === 'domestic') return { shown: false, passClass: 'near', willAlert: false };
  if (flightFilter === 'domestic' && flightType === 'international') return { shown: false, passClass: 'near', willAlert: false };

  if (settings.airlineFilter && settings.airlineFilter.trim()) {
    const allowedAirlines = settings.airlineFilter.toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
    const icao = (f.airlineIcao || '').toUpperCase();
    const cs = (f.callsign || '').toUpperCase();
    const match = allowedAirlines.some(code => icao === code || cs.startsWith(code));
    if (!match) return { shown: false, passClass: 'near', willAlert: false };
  }

  if (settings.aircraftFilter && settings.aircraftFilter.trim()) {
    const allowedTypes = settings.aircraftFilter.toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
    const acType = (f.aircraftType || '').toUpperCase();
    const match = allowedTypes.some(t => acType.includes(t));
    if (!match) return { shown: false, passClass: 'near', willAlert: false };
  }

  const minAlt = settings.minAltitudeFt != null ? settings.minAltitudeFt : 0;
  const maxAlt = settings.maxAltitudeFt != null ? settings.maxAltitudeFt : 60000;
  if (altitude < minAlt || altitude > maxAlt) return { shown: false, passClass: 'near', willAlert: false };

  // Passed all display filters: shown in Live list and Radar
  const passClass = classifyPass({
    tCpa: cpa.tCpa,
    dCpa: cpa.dCpa,
    elevationAtCpa: cpa.elevationAtCpa,
    isInbound: cpa.isInbound
  }, settings);

  // Alert check (from background.js lines 771-824):
  const isOverhead = passClass === 'overhead';
  let willAlert = false;
  const eta = cpa.isInbound && cpa.tCpa > 0 ? Math.round(cpa.tCpa) : null;
  const minElev = settings.minElevationDeg != null ? settings.minElevationDeg : 15;

  if (isOverhead && eta !== null && eta > 0 && eta >= ETA_MIN_S && eta <= ETA_MAX_S && cpa.elevationAtCpa >= minElev) {
    const watchlistMatch = options.watchlistMatch || f.watchlistMatch;
    if (watchlistMatch && watchlistMatch.alertStyle === 'silent') {
      willAlert = false;
    } else {
      willAlert = true;
    }
  }

  return { shown: true, passClass, willAlert };
}

test('Filter: Table-driven comparison of evaluateAircraft vs old live reference logic (26 cases)', () => {
  const defaultSettings = {
    overheadThresholdKm: 5,
    minElevationDeg: 15,
    flightFilter: 'all',
    altitudeFilter: 'all',
    airlineFilter: '',
    aircraftFilter: '',
    minAltitudeFt: 0,
    maxAltitudeFt: 60000
  };

  const testCases = [
    {
      name: 'Case 1: Standard overhead inbound flight with valid ETA',
      flight: { callsign: 'AIC101', airlineIcao: 'AIC', aircraftType: 'A320', altitudeFt: 30000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 120, dCpa: 2.5, elevationAtCpa: 45, isInbound: true },
      settings: { ...defaultSettings }
    },
    {
      name: 'Case 2: Near flight - dCpa exceeds overhead threshold (dCpa = 12 km > 5 km)',
      flight: { callsign: 'AIC102', airlineIcao: 'AIC', aircraftType: 'A320', altitudeFt: 30000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 120, dCpa: 12.0, elevationAtCpa: 25, isInbound: true },
      settings: { ...defaultSettings }
    },
    {
      name: 'Case 3: Near flight - outbound (isInbound = false)',
      flight: { callsign: 'AIC103', airlineIcao: 'AIC', aircraftType: 'A320', altitudeFt: 30000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: -30, dCpa: 3.0, elevationAtCpa: 50, isInbound: false },
      settings: { ...defaultSettings }
    },
    {
      name: 'Case 4: Near flight - elevation at CPA below minimum elevation (10° < 15°)',
      flight: { callsign: 'AIC104', airlineIcao: 'AIC', aircraftType: 'A320', altitudeFt: 30000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 120, dCpa: 4.0, elevationAtCpa: 10, isInbound: true },
      settings: { ...defaultSettings }
    },
    {
      name: 'Case 5: flightFilter=international hides domestic flight',
      flight: { callsign: 'AIC105', airlineIcao: 'AIC', aircraftType: 'A320', altitudeFt: 30000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 120, dCpa: 2.0, elevationAtCpa: 40, isInbound: true },
      settings: { ...defaultSettings, flightFilter: 'international' }
    },
    {
      name: 'Case 6: flightFilter=international retains international flight',
      flight: { callsign: 'UAE504', airlineIcao: 'UAE', aircraftType: 'B77W', altitudeFt: 34000, origin: 'DXB', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 110, dCpa: 2.0, elevationAtCpa: 55, isInbound: true },
      settings: { ...defaultSettings, flightFilter: 'international' }
    },
    {
      name: 'Case 7: flightFilter=domestic hides international flight',
      flight: { callsign: 'UAE505', airlineIcao: 'UAE', aircraftType: 'B77W', altitudeFt: 34000, origin: 'DXB', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 110, dCpa: 2.0, elevationAtCpa: 55, isInbound: true },
      settings: { ...defaultSettings, flightFilter: 'domestic' }
    },
    {
      name: 'Case 8: flightFilter=domestic retains domestic flight',
      flight: { callsign: 'IGO202', airlineIcao: 'IGO', aircraftType: 'A20N', altitudeFt: 28000, origin: 'DEL', destination: 'BLR', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 100, dCpa: 3.0, elevationAtCpa: 60, isInbound: true },
      settings: { ...defaultSettings, flightFilter: 'domestic' }
    },
    {
      name: 'Case 9: altitudeFilter=high hides flight under 25,000 ft',
      flight: { callsign: 'SEJ301', airlineIcao: 'SEJ', aircraftType: 'B738', altitudeFt: 18000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 120, dCpa: 2.0, elevationAtCpa: 40, isInbound: true },
      settings: { ...defaultSettings, altitudeFilter: 'high' }
    },
    {
      name: 'Case 10: altitudeFilter=high retains flight at or above 25,000 ft',
      flight: { callsign: 'SEJ302', airlineIcao: 'SEJ', aircraftType: 'B738', altitudeFt: 32000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 120, dCpa: 2.0, elevationAtCpa: 40, isInbound: true },
      settings: { ...defaultSettings, altitudeFilter: 'high' }
    },
    {
      name: 'Case 11: altitudeFilter=low hides flight at or above 25,000 ft',
      flight: { callsign: 'VTI401', airlineIcao: 'VTI', aircraftType: 'A320', altitudeFt: 29000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 120, dCpa: 2.0, elevationAtCpa: 40, isInbound: true },
      settings: { ...defaultSettings, altitudeFilter: 'low' }
    },
    {
      name: 'Case 12: altitudeFilter=low retains flight under 25,000 ft',
      flight: { callsign: 'VTI402', airlineIcao: 'VTI', aircraftType: 'A320', altitudeFt: 14000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 120, dCpa: 2.0, elevationAtCpa: 40, isInbound: true },
      settings: { ...defaultSettings, altitudeFilter: 'low' }
    },
    {
      name: 'Case 13: airlineFilter matches specified ICAO code',
      flight: { callsign: 'BAW139', airlineIcao: 'BAW', aircraftType: 'B789', altitudeFt: 36000, origin: 'LHR', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 130, dCpa: 1.5, elevationAtCpa: 70, isInbound: true },
      settings: { ...defaultSettings, airlineFilter: 'BAW,DLH' }
    },
    {
      name: 'Case 14: airlineFilter hides non-matching ICAO code',
      flight: { callsign: 'AFR218', airlineIcao: 'AFR', aircraftType: 'A359', altitudeFt: 36000, origin: 'CDG', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 130, dCpa: 1.5, elevationAtCpa: 70, isInbound: true },
      settings: { ...defaultSettings, airlineFilter: 'BAW,DLH' }
    },
    {
      name: 'Case 15: aircraftFilter matches specified type substring',
      flight: { callsign: 'AIC144', airlineIcao: 'AIC', aircraftType: 'B788', altitudeFt: 38000, origin: 'EWR', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 120, dCpa: 2.0, elevationAtCpa: 65, isInbound: true },
      settings: { ...defaultSettings, aircraftFilter: 'B788,B789' }
    },
    {
      name: 'Case 16: aircraftFilter hides non-matching type',
      flight: { callsign: 'AIC145', airlineIcao: 'AIC', aircraftType: 'A320', altitudeFt: 38000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 120, dCpa: 2.0, elevationAtCpa: 65, isInbound: true },
      settings: { ...defaultSettings, aircraftFilter: 'B788,B789' }
    },
    {
      name: 'Case 17: Both airlineFilter and aircraftFilter set - both match',
      flight: { callsign: 'BAW139', airlineIcao: 'BAW', aircraftType: 'B789', altitudeFt: 36000, origin: 'LHR', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 130, dCpa: 1.5, elevationAtCpa: 70, isInbound: true },
      settings: { ...defaultSettings, airlineFilter: 'BAW', aircraftFilter: 'B789' }
    },
    {
      name: 'Case 18: Both filters set - airline matches but aircraft fails',
      flight: { callsign: 'BAW139', airlineIcao: 'BAW', aircraftType: 'A350', altitudeFt: 36000, origin: 'LHR', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 130, dCpa: 1.5, elevationAtCpa: 70, isInbound: true },
      settings: { ...defaultSettings, airlineFilter: 'BAW', aircraftFilter: 'B789' }
    },
    {
      name: 'Case 19: Both filters set - aircraft matches but airline fails',
      flight: { callsign: 'UAE139', airlineIcao: 'UAE', aircraftType: 'B789', altitudeFt: 36000, origin: 'DXB', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 130, dCpa: 1.5, elevationAtCpa: 70, isInbound: true },
      settings: { ...defaultSettings, airlineFilter: 'BAW', aircraftFilter: 'B789' }
    },
    {
      name: 'Case 20: Altitude bounds - below minAltitudeFt is hidden',
      flight: { callsign: 'C172A', airlineIcao: '', aircraftType: 'C172', altitudeFt: 2500, origin: '', destination: '', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 100, dCpa: 2.0, elevationAtCpa: 40, isInbound: true },
      settings: { ...defaultSettings, minAltitudeFt: 5000 }
    },
    {
      name: 'Case 21: Altitude bounds - above maxAltitudeFt is hidden',
      flight: { callsign: 'NASA1', airlineIcao: '', aircraftType: 'WB57', altitudeFt: 62000, origin: '', destination: '', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 100, dCpa: 2.0, elevationAtCpa: 40, isInbound: true },
      settings: { ...defaultSettings, maxAltitudeFt: 55000 }
    },
    {
      name: 'Case 22: Overhead pass with ETA < ALERT_LEAD_MIN_S (9s < 10s) suppresses alert',
      flight: { callsign: 'AIC106', airlineIcao: 'AIC', aircraftType: 'A320', altitudeFt: 30000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 9, dCpa: 2.0, elevationAtCpa: 50, isInbound: true },
      settings: { ...defaultSettings }
    },
    {
      name: 'Case 22b: Overhead pass with ETA = 60s (between 10s and 150s) alerts immediately',
      flight: { callsign: 'AIC106B', airlineIcao: 'AIC', aircraftType: 'A320', altitudeFt: 30000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 60, dCpa: 2.0, elevationAtCpa: 50, isInbound: true },
      settings: { ...defaultSettings }
    },
    {
      name: 'Case 23: Overhead pass with ETA > ALERT_LEAD_MAX_S (200s > 150s) suppresses alert',
      flight: { callsign: 'AIC107', airlineIcao: 'AIC', aircraftType: 'A320', altitudeFt: 30000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 200, dCpa: 2.0, elevationAtCpa: 50, isInbound: true },
      settings: { ...defaultSettings }
    },
    {
      name: 'Case 24: Watchlist silent rule suppresses alert',
      flight: { callsign: 'AIC108', airlineIcao: 'AIC', aircraftType: 'A320', altitudeFt: 30000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 120, dCpa: 2.0, elevationAtCpa: 50, isInbound: true },
      settings: { ...defaultSettings },
      options: { watchlistMatch: { alertStyle: 'silent' } }
    },
    {
      name: 'Case 25: Missing/null coordinates hides flight',
      flight: { callsign: 'ERR01', airlineIcao: 'ERR', aircraftType: 'A320', altitudeFt: 30000, origin: 'DEL', destination: 'BOM', lat: null, lon: null },
      cpa: null,
      settings: { ...defaultSettings }
    },
    {
      name: 'Case 26: NaN coordinates hides flight',
      flight: { callsign: 'ERR02', airlineIcao: 'ERR', aircraftType: 'A320', altitudeFt: 30000, origin: 'DEL', destination: 'BOM', lat: NaN, lon: 72.8 },
      cpa: null,
      settings: { ...defaultSettings }
    }
  ];

  for (const tc of testCases) {
    const oldRes = oldLiveReferenceDecision(tc.flight, tc.settings, tc.cpa, tc.options);
    const newRes = evaluateAircraft(tc.flight, tc.settings, tc.cpa, tc.options);

    assert.equal(
      newRes.shown,
      oldRes.shown,
      `[${tc.name}] 'shown' mismatch: expected ${oldRes.shown}, got ${newRes.shown}`
    );

    assert.equal(
      newRes.passClass,
      oldRes.passClass,
      `[${tc.name}] 'passClass' mismatch: expected ${oldRes.passClass}, got ${newRes.passClass}`
    );

    const newWillAlert = newRes.shown && newRes.alertSuppressedBy === null;
    assert.equal(
      newWillAlert,
      oldRes.willAlert,
      `[${tc.name}] 'willAlert' mismatch: expected ${oldRes.willAlert}, got ${newWillAlert} (alertSuppressedBy: ${newRes.alertSuppressedBy})`
    );
  }
});
