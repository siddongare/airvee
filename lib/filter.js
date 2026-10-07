// ============================================================
//  AIRVEE — Flight Filtering & Decision Engine
//  Single source of truth for Live list, Radar, Alerts, and Diagnostics
// ============================================================

import { classifyPass } from './geo.js';

export const ETA_MIN_S = 90;
export const ETA_MAX_S = 150;

// ---- Comprehensive Indian Airport IATA Codes ----
export const INDIAN_AIRPORTS = new Set([
  'AGR', 'AGX', 'AJL', 'AMD', 'ATQ', 'BBI', 'BDQ', 'BEK', 'BHJ', 'BHO',
  'BHU', 'BKB', 'BLR', 'BOM', 'BUP', 'CCJ', 'CCU', 'CDP', 'CJB', 'COK',
  'DAI', 'DBR', 'DDN', 'DED', 'DEL', 'DGH', 'DHM', 'DIB', 'DIU', 'DMU',
  'GAU', 'GAY', 'GBI', 'GOI', 'GOP', 'GUX', 'GWL', 'HBX', 'HJR', 'HSS',
  'HYD', 'IDR', 'IMF', 'ISK', 'IXA', 'IXB', 'IXC', 'IXD', 'IXE', 'IXG',
  'IXH', 'IXI', 'IXJ', 'IXK', 'IXL', 'IXM', 'IXN', 'IXP', 'IXQ', 'IXR',
  'IXS', 'IXU', 'IXW', 'IXY', 'IXZ', 'JAI', 'JDH', 'JGA', 'JLR', 'JRH',
  'JSA', 'KLH', 'KNU', 'KQH', 'KTU', 'KUU', 'LDA', 'LKO', 'LUH', 'MAA',
  'MYQ', 'NAG', 'NDC', 'NMB', 'PAB', 'PAT', 'PBD', 'PGH', 'PNQ', 'PNY',
  'PYB', 'RAJ', 'RDP', 'REW', 'RJA', 'RPR', 'RRK', 'RTC', 'RUP', 'SAG',
  'SHL', 'SLV', 'SSE', 'STV', 'SXR', 'TCR', 'TEI', 'TEZ', 'TIR', 'TRV',
  'TRZ', 'UDR', 'VGA', 'VNS', 'VTZ', 'WGC', 'ZER', 'MOH', 'KJB', 'RJI',
  'SXV', 'TJV', 'VDY', 'CBD', 'JGB', 'PUT', 'AIP', 'RGH', 'SLN', 'TNI',
  'JRG', 'BEP', 'VGA', 'PYG', 'GOX', 'MZA', 'HGI', 'JLG', 'KBK', 'NVY',
  'OMN', 'PCR', 'PYJ', 'RAT', 'RMD', 'STV', 'VDY', 'MZU', 'AYJ', 'CNN',
  'RTC', 'KCG', 'SAP', 'BPM', 'HOD', 'RGH', 'SET'
]);

/**
 * Classify a flight as 'international', 'domestic', or 'unknown'
 * based on origin and destination IATA codes, and returns which rule decided it.
 *
 * @param {string} origin
 * @param {string} destination
 * @returns {{ flightType: 'international'|'domestic'|'unknown', rule: string }}
 */
export function classifyFlightWithRule(origin, destination) {
  const org = (origin || '').trim().toUpperCase();
  const dst = (destination || '').trim().toUpperCase();

  if (!org && !dst) {
    return { flightType: 'unknown', rule: 'missing_route_data' };
  }

  const orgIsIndian = org ? INDIAN_AIRPORTS.has(org) : null;
  const dstIsIndian = dst ? INDIAN_AIRPORTS.has(dst) : null;

  // Both are known Indian airports → domestic
  if (orgIsIndian === true && dstIsIndian === true) {
    return { flightType: 'domestic', rule: 'both_indian_airports' };
  }

  // At least one is known and NOT Indian → international
  if (orgIsIndian === false || dstIsIndian === false) {
    return { flightType: 'international', rule: 'foreign_airport_detected' };
  }

  // One is Indian, other is empty → could be either (lean towards unknown)
  if ((orgIsIndian === true && dstIsIndian === null) ||
      (orgIsIndian === null && dstIsIndian === true)) {
    return { flightType: 'unknown', rule: 'single_indian_endpoint_only' };
  }

  // Both are non-empty but neither is in our Indian list → likely international
  if (org && dst && orgIsIndian === false && dstIsIndian === false) {
    return { flightType: 'international', rule: 'both_unlisted_likely_foreign' };
  }

  return { flightType: 'unknown', rule: 'unresolved' };
}

/**
 * Convenience helper returning just the flightType string.
 */
export function classifyFlight(origin, destination) {
  return classifyFlightWithRule(origin, destination).flightType;
}

/**
 * Pure evaluation function for aircraft visibility, classification and alert eligibility.
 * Used by background tracking, popup Live tab, radar, alert pipeline, and diagnostics.
 *
 * @param {Object} flight - Raw or normalized flight data
 * @param {Object} settings - User settings
 * @param {Object|null} geoResult - CPA calculation result
 * @param {Object} [options] - Additional options (e.g. { watchlistMatch })
 * @returns {{
 *   shown: boolean,
 *   hiddenBy: string|null,
 *   alertSuppressedBy: string|null,
 *   passClass: 'overhead'|'near'
 * }}
 */
export function evaluateAircraft(flight, settings = {}, geoResult = null, options = {}) {
  const flightLat = flight?.lat != null ? flight.lat : flight?.latitude;
  const flightLon = flight?.lon != null ? flight.lon : flight?.longitude;

  if (flightLat == null || flightLon == null || isNaN(flightLat) || isNaN(flightLon)) {
    return {
      shown: false,
      hiddenBy: 'invalid_coordinates',
      alertSuppressedBy: 'hidden',
      passClass: 'near'
    };
  }

  const altitude = flight.altitudeFt != null ? flight.altitudeFt : (flight.altitude || 0);

  // 1. Altitude filter ('high' / 'low' / 'all')
  const altitudeFilter = settings.altitudeFilter || 'all';
  if (altitudeFilter === 'high' && altitude < 25000) {
    return { shown: false, hiddenBy: 'altitudeFilter', alertSuppressedBy: 'hidden', passClass: 'near' };
  }
  if (altitudeFilter === 'low' && altitude >= 25000) {
    return { shown: false, hiddenBy: 'altitudeFilter', alertSuppressedBy: 'hidden', passClass: 'near' };
  }

  // 2. Flight filter ('international' / 'domestic' / 'all')
  const origin = flight.origin || '';
  const destination = flight.destination || '';
  const flightType = flight.flightType || classifyFlight(origin, destination);
  const flightFilter = settings.flightFilter || 'all';

  if (flightFilter === 'international' && flightType === 'domestic') {
    return { shown: false, hiddenBy: 'flightFilter', alertSuppressedBy: 'hidden', passClass: 'near' };
  }
  if (flightFilter === 'domestic' && flightType === 'international') {
    return { shown: false, hiddenBy: 'flightFilter', alertSuppressedBy: 'hidden', passClass: 'near' };
  }

  // 3. Airline filter (comma-separated ICAO codes)
  if (settings.airlineFilter && settings.airlineFilter.trim()) {
    const allowedAirlines = settings.airlineFilter.toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
    const icao = (flight.airlineIcao || '').toUpperCase();
    const cs = (flight.callsign || '').toUpperCase();
    const match = allowedAirlines.some(code => icao === code || cs.startsWith(code));
    if (!match) {
      return { shown: false, hiddenBy: 'airlineFilter', alertSuppressedBy: 'hidden', passClass: 'near' };
    }
  }

  // 4. Aircraft type filter (comma-separated ICAO types)
  if (settings.aircraftFilter && settings.aircraftFilter.trim()) {
    const allowedTypes = settings.aircraftFilter.toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
    const acType = (flight.aircraftType || '').toUpperCase();
    const match = allowedTypes.some(t => acType.includes(t));
    if (!match) {
      return { shown: false, hiddenBy: 'aircraftFilter', alertSuppressedBy: 'hidden', passClass: 'near' };
    }
  }

  // 5. Altitude bounds
  const minAlt = settings.minAltitudeFt != null ? settings.minAltitudeFt : 0;
  const maxAlt = settings.maxAltitudeFt != null ? settings.maxAltitudeFt : 60000;
  if (altitude < minAlt || altitude > maxAlt) {
    return { shown: false, hiddenBy: 'altitudeBounds', alertSuppressedBy: 'hidden', passClass: 'near' };
  }

  // Aircraft passed all display filters: it IS shown in Live and Radar
  let passClass = 'near';
  if (geoResult) {
    passClass = classifyPass({
      tCpa: geoResult.tCpa,
      dCpa: geoResult.dCpa,
      elevationAtCpa: geoResult.elevationAtCpa,
      isInbound: geoResult.isInbound
    }, settings);
  } else if (flight.passClassification) {
    passClass = flight.passClassification;
  }

  // Determine alert suppression
  let alertSuppressedBy = null;

  if (passClass !== 'overhead') {
    alertSuppressedBy = 'not_overhead';
  } else {
    let eta = flight.eta;
    if (eta == null && geoResult && geoResult.isInbound && geoResult.tCpa > 0) {
      eta = Math.round(geoResult.tCpa);
    }

    if (eta === null || eta <= 0) {
      alertSuppressedBy = 'no_eta';
    } else if (eta < ETA_MIN_S || eta > ETA_MAX_S) {
      alertSuppressedBy = 'eta_out_of_bounds';
    } else {
      const minElev = settings.minElevationDeg != null ? settings.minElevationDeg : 15;
      const elevationAtCpa = geoResult?.elevationAtCpa != null ? geoResult.elevationAtCpa : (flight.elevationAtCpa || 0);
      if (elevationAtCpa < minElev) {
        alertSuppressedBy = 'minElevation';
      } else {
        const watchlistMatch = options.watchlistMatch || flight.watchlistMatch;
        if (watchlistMatch && watchlistMatch.alertStyle === 'silent') {
          alertSuppressedBy = 'watchlist_silent';
        }
      }
    }
  }

  return {
    shown: true,
    hiddenBy: null,
    alertSuppressedBy,
    passClass
  };
}
