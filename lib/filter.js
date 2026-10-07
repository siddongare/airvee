// ============================================================
//  AIRVEE — Flight Filtering & Decision Engine
//  Single source of truth for Live list, Radar, Alerts, and Diagnostics
// ============================================================

import { classifyPass } from './geo.js';
import { evaluateAlertRules, convertLegacySettingsToAlertRules } from './alerts.js';

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
 * @param {Object} [options] - Additional options (e.g. { watchlistMatch, sightingCounts })
 * @returns {{
 *   shown: boolean,
 *   hiddenBy: string|null,
 *   alertSuppressedBy: string|null,
 *   passClass: 'overhead'|'near',
 *   matchedRule: Object|null,
 *   action: 'alert'|'loud'|'log'|'ignore',
 *   bypassQuietHours: boolean
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
      passClass: 'near',
      matchedRule: null,
      action: 'ignore',
      bypassQuietHours: false
    };
  }

  const altitude = flight.altitudeFt != null ? flight.altitudeFt : (flight.altitude || 0);
  const origin = flight.origin || '';
  const destination = flight.destination || '';
  const flightType = flight.flightType || classifyFlight(origin, destination);

  const enrichedFlight = {
    ...flight,
    altitude,
    origin,
    destination,
    flightType
  };

  // Determine pass classification
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

  // Obtain alert rules configuration
  let alertRules = settings.alertRules;
  let alertMode = settings.alertMode || 'all';
  let defaultAction = settings.defaultAction || 'log';

  // If caller supplied legacy settings or rules not yet migrated, convert on the fly
  if (!Array.isArray(alertRules)) {
    const converted = convertLegacySettingsToAlertRules(settings);
    alertRules = converted.alertRules;
    alertMode = converted.alertMode;
    defaultAction = converted.defaultAction;
  }

  // Support options.watchlistMatch if explicitly provided by legacy callers
  let combinedRules = [...alertRules];
  if (options.watchlistMatch) {
    const wmAction = options.watchlistMatch.alertStyle === 'silent' ? 'log'
      : options.watchlistMatch.alertStyle === 'special' ? 'loud'
      : 'alert';
    combinedRules.unshift({
      id: options.watchlistMatch.ruleId || 'caller-watchlist-match',
      name: options.watchlistMatch.ruleName || 'Watchlist Match',
      enabled: true,
      conditions: {},
      action: wmAction,
      tag: options.watchlistMatch.tag || 'WATCH',
      bypassQuietHours: Boolean(options.watchlistMatch.ignoreQuietHours)
    });
  }

  // Evaluate through the Alerts rules model
  const evalResult = evaluateAlertRules(enrichedFlight, combinedRules, {
    alertMode,
    defaultAction,
    sightingCounts: options.sightingCounts,
    rareSeenThreshold: settings.rareSeenThreshold,
    globalOverheadThresholdKm: settings.overheadThresholdKm
  });

  const { action, matchedRule, bypassQuietHours } = evalResult;

  // "ignore" always wins: not shown, not logged
  if (action === 'ignore') {
    let hiddenBy = 'rule_ignore';
    if (matchedRule) {
      if (matchedRule.id === 'migrated-flight-domestic' || matchedRule.id === 'migrated-flight-intl') {
        hiddenBy = 'flightFilter';
      } else if (matchedRule.id === 'migrated-alt-low' || matchedRule.id === 'migrated-alt-high') {
        hiddenBy = 'altitudeFilter';
      } else if (matchedRule.id === 'migrated-min-alt' || matchedRule.id === 'migrated-max-alt') {
        hiddenBy = 'altitudeBounds';
      } else if (matchedRule.id === 'migrated-airline-filter') {
        hiddenBy = 'airlineFilter';
      } else if (matchedRule.id === 'migrated-aircraft-filter') {
        hiddenBy = 'aircraftFilter';
      }
    }
    return {
      shown: false,
      hiddenBy,
      alertSuppressedBy: 'hidden',
      passClass: 'near',
      matchedRule,
      action: 'ignore',
      bypassQuietHours: false
    };
  }

  // Aircraft passed all display filters: it IS shown in Live and Radar
  let alertSuppressedBy = null;

  // Only flights classified "overhead" can ever notify
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
      } else if (action === 'log') {
        alertSuppressedBy = (matchedRule && matchedRule.id === 'caller-watchlist-match' && options.watchlistMatch?.alertStyle === 'silent')
          ? 'watchlist_silent'
          : 'rule_log';
      }
    }
  }

  return {
    shown: true,
    hiddenBy: null,
    alertSuppressedBy,
    passClass,
    matchedRule,
    action,
    bypassQuietHours
  };
}
