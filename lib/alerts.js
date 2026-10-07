// ============================================================
//  AIRVEE — Alerts Engine & Rules Data Model
//  Single source of truth for alert rules, evaluation and precedence
// ============================================================

import { bearingToCompass } from './geo.js';
import {
  isInherentlyRare,
  isCargoAircraft,
  isMilitaryAircraft,
  isRareForMe,
  DEFAULT_INHERENTLY_RARE_TYPES
} from './watchlist.js';
import { classifyFlight } from './filter.js';

// Pre-defined airline groups for friendly multi-select rules
export const AIRLINE_GROUPS = {
  gulf: {
    id: 'gulf',
    name: 'Gulf carriers',
    codes: ['EK', 'UAE', 'QR', 'QTR', 'EY', 'ETD', 'SV', 'SVA', 'GF', 'GFA', 'FZ', 'FDB', 'G9', 'ABY', 'WY', 'OMA']
  },
  indian: {
    id: 'indian',
    name: 'Indian carriers',
    codes: ['AIC', 'AI', 'IGO', '6E', 'VTI', 'UK', 'SEJ', 'SG', 'AKJ', 'QP', 'AXB', 'IX', 'IAD', 'I5']
  },
  european: {
    id: 'european',
    name: 'European flag carriers',
    codes: ['BAW', 'BA', 'AFR', 'AF', 'DLH', 'LH', 'KLM', 'KL', 'SWR', 'LX', 'IBE', 'IB', 'ITY', 'AZ', 'SAS', 'SK', 'FIN', 'AY', 'TAP', 'TP', 'THY', 'TK']
  },
  us_major: {
    id: 'us_major',
    name: 'US major carriers',
    codes: ['AAL', 'AA', 'DAL', 'DL', 'UAL', 'UA', 'SWA', 'WN', 'ASA', 'AS', 'JBU', 'B6']
  }
};

// Twin-aisle / heavy wide-body aircraft ICAO codes
export const WIDE_BODY_TYPES = new Set([
  'A306', 'A30B', 'A310', 'A332', 'A333', 'A338', 'A339', 'A342', 'A343', 'A345', 'A346', 'A359', 'A35K', 'A388',
  'B741', 'B742', 'B743', 'B744', 'B748', 'B762', 'B763', 'B764', 'B772', 'B773', 'B778', 'B779', 'B77L', 'B77W',
  'B788', 'B789', 'B78X', 'DC10', 'MD11', 'L101', 'IL86', 'IL96'
]);

/**
 * Determine if an aircraft is a twin-aisle wide-body airliner.
 *
 * @param {object} flight
 * @returns {boolean}
 */
export function isWideBodyAircraft(flight) {
  if (!flight) return false;
  const type = String(flight.aircraftType || '').trim().toUpperCase();
  return WIDE_BODY_TYPES.has(type);
}

/**
 * Match a flight against a single alert rule.
 * Conditions are combined with AND; multiple values within a condition are OR'd.
 *
 * @param {object} flight
 * @param {object} rule
 * @param {object} [context={}]
 * @returns {boolean}
 */
export function matchRule(flight, rule, context = {}) {
  if (!flight || !rule || rule.enabled === false) return false;
  if (flight.isMock === true && !context.allowMock) return false;

  const cond = rule.conditions || {};
  const {
    sightingCounts = {},
    rareSeenThreshold = 2,
    inherentlyRareList = DEFAULT_INHERENTLY_RARE_TYPES
  } = context;

  // 1. Airlines
  if (Array.isArray(cond.airlines) && cond.airlines.length > 0) {
    const fIcao = String(flight.airlineIcao || '').trim().toUpperCase();
    const fName = String(flight.airline || '').trim().toUpperCase();
    const fCs = String(flight.callsign || '').trim().toUpperCase();
    const fNum = String(flight.flightNumber || '').trim().toUpperCase();

    const targetCodesOrNames = [];
    for (const item of cond.airlines) {
      const lower = String(item).trim().toLowerCase();
      if (AIRLINE_GROUPS[lower]) {
        targetCodesOrNames.push(...AIRLINE_GROUPS[lower].codes);
      } else {
        targetCodesOrNames.push(String(item).trim().toUpperCase());
      }
    }

    const matchesAirline = targetCodesOrNames.some(target => {
      return (fIcao && fIcao === target) ||
             (fName && fName.includes(target)) ||
             (fCs && fCs.startsWith(target)) ||
             (fNum && fNum.startsWith(target));
    });

    if (cond.invertAirlines) {
      if (matchesAirline) return false;
    } else {
      if (!matchesAirline) return false;
    }
  }

  // 2. Aircraft Types
  if (Array.isArray(cond.aircraftTypes) && cond.aircraftTypes.length > 0) {
    const fType = String(flight.aircraftType || '').trim().toUpperCase();
    const targetTypes = cond.aircraftTypes.map(t => String(t).trim().toUpperCase());
    const matchesType = targetTypes.some(t => fType === t || fType.includes(t) || (fType.length >= 3 && t.includes(fType)));

    if (cond.invertAircraftTypes) {
      if (matchesType) return false;
    } else {
      if (!matchesType) return false;
    }
  }

  // 3. Category (cargo, passenger, wide-body, military)
  if (Array.isArray(cond.category) && cond.category.length > 0) {
    const matchesCategory = cond.category.some(cat => {
      const c = String(cat).trim().toLowerCase();
      if (c === 'cargo') return isCargoAircraft(flight);
      if (c === 'passenger') return !isCargoAircraft(flight) && !isMilitaryAircraft(flight);
      if (c === 'wide-body' || c === 'wide_body' || c === 'widebody') return isWideBodyAircraft(flight);
      if (c === 'military') return isMilitaryAircraft(flight);
      return false;
    });
    if (!matchesCategory) return false;
  }

  // 4. Direction (8 compass directions: N, NE, E, SE, S, SW, W, NW)
  if (Array.isArray(cond.direction) && cond.direction.length > 0) {
    const trackVal = flight.trackDeg != null ? flight.trackDeg : (flight.track != null ? flight.track : flight.heading);
    if (trackVal == null || isNaN(trackVal)) return false;
    const compassDir = bearingToCompass(trackVal, false);
    const targetDirs = cond.direction.map(d => String(d).trim().toUpperCase());
    if (!targetDirs.includes(compassDir)) return false;
  }

  // 5. Route (origin, destination, airports, flightType)
  if (cond.route) {
    const fOrg = String(flight.origin || '').trim().toUpperCase();
    const fDst = String(flight.destination || '').trim().toUpperCase();

    if (Array.isArray(cond.route.airports) && cond.route.airports.length > 0) {
      const targets = cond.route.airports.map(a => String(a).trim().toUpperCase());
      const hasAirport = (fOrg && targets.includes(fOrg)) || (fDst && targets.includes(fDst));
      if (!hasAirport) return false;
    }

    if (cond.route.origin) {
      const origs = (Array.isArray(cond.route.origin) ? cond.route.origin : [cond.route.origin])
        .map(a => String(a).trim().toUpperCase());
      if (!fOrg || !origs.includes(fOrg)) return false;
    }

    if (cond.route.destination) {
      const dsts = (Array.isArray(cond.route.destination) ? cond.route.destination : [cond.route.destination])
        .map(a => String(a).trim().toUpperCase());
      if (!fDst || !dsts.includes(fDst)) return false;
    }

    if (cond.route.flightType) {
      const fType = flight.flightType || classifyFlight(flight.origin, flight.destination);
      if (fType !== cond.route.flightType) return false;
    }
  }

  // 6. Registration
  if (Array.isArray(cond.registration) && cond.registration.length > 0) {
    const fRegClean = String(flight.registration || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (!fRegClean) return false;
    const targetRegs = cond.registration.map(r => String(r).replace(/[^A-Z0-9]/gi, '').toUpperCase());
    if (!targetRegs.includes(fRegClean)) return false;
  }

  // 7. Callsign Prefix
  if (Array.isArray(cond.callsignPrefix) && cond.callsignPrefix.length > 0) {
    const fCs = String(flight.callsign || '').trim().toUpperCase();
    const fNum = String(flight.flightNumber || '').trim().toUpperCase();
    const prefixes = cond.callsignPrefix.map(p => String(p).trim().toUpperCase());
    const matchesPrefix = prefixes.some(p => (fCs && fCs.startsWith(p)) || (fNum && fNum.startsWith(p)));
    if (!matchesPrefix) return false;
  }

  // 8. Altitude Range
  if (cond.altitudeRange) {
    const alt = flight.altitudeFt != null ? flight.altitudeFt : (flight.altitude != null ? flight.altitude : 0);
    const minFt = cond.altitudeRange.minFt != null ? cond.altitudeRange.minFt : 0;
    const maxFt = cond.altitudeRange.maxFt != null ? cond.altitudeRange.maxFt : 60000;
    if (alt < minFt || alt > maxFt) return false;
  }

  // 9. Rare for me
  if (cond.rareForMe === true) {
    const flightIsRare = isRareForMe(flight, sightingCounts, rareSeenThreshold, inherentlyRareList);
    if (!flightIsRare) return false;
  }

  // 10. Per-rule overhead threshold (advanced)
  const ruleThreshold = (cond.overheadThresholdKm != null && Number(cond.overheadThresholdKm) > 0)
    ? Number(cond.overheadThresholdKm)
    : (rule.overheadThresholdKm != null && Number(rule.overheadThresholdKm) > 0 ? Number(rule.overheadThresholdKm) : null);

  if (ruleThreshold != null) {
    const cpaDist = flight.dCpa != null ? Number(flight.dCpa) : Number(flight.distance || 0);
    if (cpaDist > ruleThreshold) return false;
  }

  return true;
}

/**
 * Evaluate all active alert rules for a flight.
 * Applies precedence: "ignore" always wins; otherwise loud > alert > log.
 *
 * @param {object} flight
 * @param {object[]} alertRules
 * @param {object} [options={}]
 * @returns {{
 *   action: 'alert'|'loud'|'log'|'ignore',
 *   matchedRule: object|null,
 *   matchedRules: object[],
 *   bypassQuietHours: boolean,
 *   tag: string|null
 * }}
 */
export function evaluateAlertRules(flight, alertRules = [], options = {}) {
  const alertMode = options.alertMode || 'all';
  const defaultAction = options.defaultAction || 'log';

  const matchedRules = [];
  if (Array.isArray(alertRules)) {
    for (const rule of alertRules) {
      if (matchRule(flight, rule, options)) {
        matchedRules.push(rule);
      }
    }
  }

  let finalAction;
  let winningRule = null;

  if (matchedRules.length > 0) {
    // Precedence: ignore > loud > alert > log
    const hasIgnore = matchedRules.find(r => r.action === 'ignore');
    const hasLoud = matchedRules.find(r => r.action === 'loud');
    const hasAlert = matchedRules.find(r => r.action === 'alert');
    const hasLog = matchedRules.find(r => r.action === 'log');

    if (hasIgnore) {
      finalAction = 'ignore';
      winningRule = hasIgnore;
    } else if (hasLoud) {
      finalAction = 'loud';
      winningRule = hasLoud;
    } else if (hasAlert) {
      finalAction = 'alert';
      winningRule = hasAlert;
    } else if (hasLog) {
      finalAction = 'log';
      winningRule = hasLog;
    } else {
      finalAction = 'alert';
      winningRule = matchedRules[0];
    }
  } else {
    // No rules matched
    if (alertMode === 'all') {
      finalAction = 'alert';
    } else {
      finalAction = defaultAction;
    }
  }

  const bypassQuietHours = matchedRules.some(r =>
    Boolean(r.conditions?.bypassQuietHours || r.bypassQuietHours || r.ignoreQuietHours)
  );

  return {
    action: finalAction,
    matchedRule: winningRule,
    matchedRules,
    bypassQuietHours,
    tag: winningRule ? (winningRule.tag || (winningRule.conditions?.rareForMe ? 'RARE' : 'ALERT')) : null
  };
}

/**
 * Converts legacy settings (flightFilter, altitudeFilter, airlineFilter,
 * aircraftFilter, min/max altitude, watchlistRules) into modern alertRules.
 * Guarantees identical runtime behavior for all existing configurations.
 *
 * @param {object} rawSettings
 * @returns {{
 *   alertMode: 'all'|'chosen',
 *   defaultAction: 'alert'|'log'|'ignore',
 *   alertRules: object[]
 * }}
 */
export function convertLegacySettingsToAlertRules(rawSettings = {}) {
  const alertRules = [];

  // 1. Convert existing Watchlist rules
  if (Array.isArray(rawSettings.watchlistRules)) {
    rawSettings.watchlistRules.forEach((wr, idx) => {
      const cond = {};
      if (wr.aircraftType && wr.aircraftType.trim()) {
        cond.aircraftTypes = wr.aircraftType.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      }
      if (wr.airline && wr.airline.trim()) {
        cond.airlines = wr.airline.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
      }
      if (wr.registration && wr.registration.trim()) {
        cond.registration = [wr.registration.trim()];
      }
      if (wr.callsignPrefix && wr.callsignPrefix.trim()) {
        cond.callsignPrefix = wr.callsignPrefix.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      }
      if (wr.cargoFilter && wr.cargoFilter !== 'any') {
        cond.category = [
          wr.cargoFilter === 'cargo_only' ? 'cargo'
          : wr.cargoFilter === 'passenger_only' ? 'passenger'
          : wr.cargoFilter === 'military_only' ? 'military'
          : 'cargo'
        ];
      }
      if (wr.rareOnly) {
        cond.rareForMe = true;
      }
      if (wr.overheadThresholdKm != null && Number(wr.overheadThresholdKm) > 0) {
        cond.overheadThresholdKm = Number(wr.overheadThresholdKm);
      }
      if (wr.ignoreQuietHours) {
        cond.bypassQuietHours = true;
      }

      const action = wr.alertStyle === 'silent' ? 'log'
        : wr.alertStyle === 'special' ? 'loud'
        : 'alert';

      alertRules.push({
        id: wr.id || `migrated-watchlist-${idx + 1}`,
        name: wr.name || `Rule ${idx + 1}`,
        enabled: wr.enabled !== false,
        conditions: cond,
        action,
        tag: (wr.rareOnly) ? 'RARE' : 'WATCH'
      });
    });
  }

  // 2. Convert flightFilter ('international' / 'domestic')
  if (rawSettings.flightFilter === 'international') {
    alertRules.push({
      id: 'migrated-flight-domestic',
      name: 'Ignore domestic flights',
      enabled: true,
      conditions: { route: { flightType: 'domestic' } },
      action: 'ignore'
    });
  } else if (rawSettings.flightFilter === 'domestic') {
    alertRules.push({
      id: 'migrated-flight-intl',
      name: 'Ignore international flights',
      enabled: true,
      conditions: { route: { flightType: 'international' } },
      action: 'ignore'
    });
  }

  // 3. Convert altitudeFilter ('high' / 'low')
  if (rawSettings.altitudeFilter === 'high') {
    alertRules.push({
      id: 'migrated-alt-low',
      name: 'Ignore low altitude (< 25,000 ft)',
      enabled: true,
      conditions: { altitudeRange: { minFt: 0, maxFt: 24999 } },
      action: 'ignore'
    });
  } else if (rawSettings.altitudeFilter === 'low') {
    alertRules.push({
      id: 'migrated-alt-high',
      name: 'Ignore high altitude (≥ 25,000 ft)',
      enabled: true,
      conditions: { altitudeRange: { minFt: 25000, maxFt: 100000 } },
      action: 'ignore'
    });
  }

  // 4. Convert min/max altitude bounds
  if (rawSettings.minAltitudeFt != null && rawSettings.minAltitudeFt > 0) {
    alertRules.push({
      id: 'migrated-min-alt',
      name: `Ignore below ${rawSettings.minAltitudeFt} ft`,
      enabled: true,
      conditions: { altitudeRange: { minFt: 0, maxFt: rawSettings.minAltitudeFt - 1 } },
      action: 'ignore'
    });
  }
  if (rawSettings.maxAltitudeFt != null && rawSettings.maxAltitudeFt < 60000) {
    alertRules.push({
      id: 'migrated-max-alt',
      name: `Ignore above ${rawSettings.maxAltitudeFt} ft`,
      enabled: true,
      conditions: { altitudeRange: { minFt: rawSettings.maxAltitudeFt + 1, maxFt: 100000 } },
      action: 'ignore'
    });
  }

  // 5. Convert airlineFilter (allow-list -> ignore others)
  if (rawSettings.airlineFilter && rawSettings.airlineFilter.trim()) {
    const allowed = rawSettings.airlineFilter.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    alertRules.push({
      id: 'migrated-airline-filter',
      name: 'Exclude non-allowed airlines',
      enabled: true,
      conditions: { airlines: allowed, invertAirlines: true },
      action: 'ignore'
    });
  }

  // 6. Convert aircraftFilter (allow-list -> ignore others)
  if (rawSettings.aircraftFilter && rawSettings.aircraftFilter.trim()) {
    const allowed = rawSettings.aircraftFilter.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    alertRules.push({
      id: 'migrated-aircraft-filter',
      name: 'Exclude non-allowed aircraft types',
      enabled: true,
      conditions: { aircraftTypes: allowed, invertAircraftTypes: true },
      action: 'ignore'
    });
  }

  return {
    alertMode: rawSettings.alertMode || 'all',
    defaultAction: rawSettings.defaultAction || 'log',
    alertRules
  };
}
