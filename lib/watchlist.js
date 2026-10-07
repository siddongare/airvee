/**
 * Airvee — Watchlist & Rare Aircraft Detection Engine
 *
 * Matching rules:
 *  a) Aircraft type (ICAO code, e.g. A388, B748, B744, A359, B77W)
 *  b) Airline (ICAO code or name)
 *  c) Specific registration (e.g. A6-EEA)
 *  d) Callsign or flight-number prefix (e.g. ETH, EK39)
 *  e) Cargo only or passenger only
 *  f) "Rare for me": type/reg seen < N times in user log OR inherently rare static list
 *
 * Alert styles:
 *  - Silent (log only)
 *  - Normal (standard chime + notification)
 *  - Special (distinct louder 3-tone chime + WATCHLIST/RARE notification)
 */

export const DEFAULT_INHERENTLY_RARE_TYPES = [
  'A388', 'B748', 'B744', 'B742', 'B743', 'B741', 'B74R', 'B74S',
  'A225', 'A124', 'AN12', 'AN24', 'AN26', 'AN72',
  'IL76', 'IL62', 'IL96', 'TU34', 'TU54', 'CONC', 'V22',
  'C17', 'C5M', 'C130', 'KC46', 'KC10', 'KC30',
  'A310', 'A342', 'A345', 'A346', 'MD11', 'DC10',
  'E3CF', 'E4B', 'VC25', 'B52', 'B1', 'B2'
];

export const KNOWN_CARGO_AIRLINES = [
  'FDX', 'UPS', 'CLX', 'GTI', 'ABW', 'BOX', 'CKS', 'SQC', 'PAC',
  'ATN', 'CJT', 'MPH', 'NCA', 'BCS', 'TAY', 'KAL', 'GEC', 'ABD'
];

export const KNOWN_MILITARY_AIRFRAMES = [
  'C17', 'C5', 'C5M', 'C130', 'C30J', 'A400', 'KC46', 'KC10', 'KC30',
  'A33MRTT', 'E3CF', 'E4B', 'VC25', 'B52', 'B1', 'B2', 'V22',
  'IL76', 'IL78', 'AN12', 'AN26', 'AN72', 'TU95', 'TU160',
  'F16', 'F18', 'F22', 'F35', 'EUFI', 'TOR', 'HAWK', 'P8', 'RC135'
];

export const KNOWN_MILITARY_CALLSIGN_PREFIXES = [
  'RCH', 'REACH', 'TREK', 'MOOSE', 'JAKE', 'TOPCAT', 'SLAM', 'VALOR',
  'FORTE', 'PAT', 'ASY', 'RRR', 'ASCOT', 'CFC', 'CANFORCE', 'GAF',
  'FAF', 'IAM', 'IFC', 'BAF', 'NAF', 'AME', 'ROF', 'HRZ'
];

/**
 * Check if an aircraft type is inherently rare based on bundled list.
 *
 * @param {string} typeCode
 * @param {string[]} [rareList=DEFAULT_INHERENTLY_RARE_TYPES]
 * @returns {boolean}
 */
export function isInherentlyRare(typeCode, rareList = DEFAULT_INHERENTLY_RARE_TYPES) {
  if (!typeCode) return false;
  const clean = String(typeCode).trim().toUpperCase();
  const set = new Set(rareList.map(t => String(t).trim().toUpperCase()));
  return set.has(clean);
}

/**
 * Determine if a flight is a military or government transport / tactical aircraft.
 *
 * @param {object} flight
 * @returns {boolean}
 */
export function isMilitaryAircraft(flight) {
  if (!flight) return false;
  if (flight.isMilitary === true || flight.flightType === 'military') return true;

  const type = String(flight.aircraftType || '').trim().toUpperCase();
  if (type && KNOWN_MILITARY_AIRFRAMES.includes(type)) {
    return true;
  }

  const cs = String(flight.callsign || flight.flightNumber || '').trim().toUpperCase();
  if (cs && KNOWN_MILITARY_CALLSIGN_PREFIXES.some(prefix => cs.startsWith(prefix))) {
    return true;
  }

  const icao = String(flight.airlineIcao || '').trim().toUpperCase();
  if (icao && KNOWN_MILITARY_CALLSIGN_PREFIXES.includes(icao)) {
    return true;
  }

  const airline = String(flight.airline || '').toLowerCase();
  if (
    airline.includes('air force') ||
    airline.includes('royal air force') ||
    airline.includes('navy') ||
    airline.includes('military') ||
    airline.includes('air mobility command') ||
    airline.includes('armed forces') ||
    airline.includes('defense') ||
    airline.includes('defence')
  ) {
    return true;
  }

  return false;
}

/**
 * Determine if a flight is a dedicated civilian cargo or freighter aircraft.
 * Military transports are strictly differentiated and excluded.
 *
 * @param {object} flight
 * @returns {boolean}
 */
export function isCargoAircraft(flight) {
  if (!flight) return false;

  // Military aircraft are NOT civilian cargo
  if (isMilitaryAircraft(flight)) {
    return false;
  }

  if (flight.isCargo === true || flight.flightType === 'cargo') return true;

  const type = String(flight.aircraftType || '').trim().toUpperCase();
  // Most civilian freighter variants end with 'F', 'SF', 'BCF', 'BDSF'
  if (type.endsWith('F') || type.endsWith('BCF') || type.endsWith('SF') || type.endsWith('BDSF')) {
    return true;
  }

  // Known civilian heavy cargo-exclusive airframes (e.g. Antonov commercial freighters)
  const civilianCargoAirframes = ['A225', 'A124', 'B744F', 'B748F', 'B77F', 'B77L', 'MD11F', 'A332F'];
  if (civilianCargoAirframes.includes(type)) return true;

  // Airline check
  const icao = String(flight.airlineIcao || '').trim().toUpperCase();
  if (icao && KNOWN_CARGO_AIRLINES.includes(icao)) return true;

  const cs = String(flight.callsign || '').trim().toUpperCase();
  if (cs && KNOWN_CARGO_AIRLINES.some(c => cs.startsWith(c))) return true;

  const airline = String(flight.airline || '').toLowerCase();
  if (airline.includes('cargo') || airline.includes('freight') || airline.includes('logistics') || airline.includes('air transport international')) {
    return true;
  }

  return false;
}

/**
 * Check if a flight qualifies as "Rare for me".
 * Mock flights are strictly excluded and never qualify as rare.
 *
 * @param {object} flight
 * @param {object} [sightingCounts={ typeCount: 0, regCount: 0 }]
 * @param {number} [rareSeenThreshold=2]
 * @param {string[]} [rareList=DEFAULT_INHERENTLY_RARE_TYPES]
 * @returns {boolean}
 */
export function isRareForMe(flight, sightingCounts = {}, rareSeenThreshold = 2, rareList = DEFAULT_INHERENTLY_RARE_TYPES) {
  if (!flight) return false;
  // Mock flights must NEVER count toward watchlist history or life list
  if (flight.isMock === true || flight.source === 'mock') {
    return false;
  }

  const type = String(flight.aircraftType || '').trim().toUpperCase();
  if (isInherentlyRare(type, rareList)) {
    return true;
  }

  const thresh = Number(rareSeenThreshold) > 0 ? Number(rareSeenThreshold) : 2;

  if (sightingCounts.typeCount != null && sightingCounts.typeCount < thresh) {
    return true;
  }

  if (sightingCounts.regCount != null && sightingCounts.regCount < thresh && flight.registration && flight.registration !== '—') {
    return true;
  }

  return false;
}

/**
 * Match a flight against a single Watchlist Rule.
 *
 * @param {object} flight
 * @param {object} rule
 * @param {object} [context={}]
 * @returns {object|null}
 */
export function matchFlightAgainstRule(flight, rule, context = {}) {
  if (!flight || !rule || rule.enabled === false) return null;

  // Mock flights never trigger real notifications or write to history
  if (flight.isMock === true || flight.source === 'mock') {
    return null;
  }

  const {
    sightingCounts = {},
    rareSeenThreshold = 2,
    inherentlyRareList = DEFAULT_INHERENTLY_RARE_TYPES,
    globalOverheadThresholdKm = 5
  } = context;

  // a) Aircraft type match (ICAO code, e.g. A388, B748)
  if (rule.aircraftType && String(rule.aircraftType).trim() !== '') {
    const requiredTypes = String(rule.aircraftType)
      .split(/[\s,]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    const flightType = String(flight.aircraftType || '').trim().toUpperCase();
    if (!requiredTypes.includes(flightType)) {
      return null;
    }
  }

  // b) Airline match (ICAO code or name)
  if (rule.airline && String(rule.airline).trim() !== '') {
    const requiredAirlines = String(rule.airline)
      .split(/[\s,]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);

    const fIcao = String(flight.airlineIcao || '').trim().toUpperCase();
    const fName = String(flight.airline || '').trim().toUpperCase();
    const fCs = String(flight.callsign || '').trim().toUpperCase();

    const matchedAirline = requiredAirlines.some(req => {
      return (fIcao && fIcao === req) ||
             (fName && fName.includes(req)) ||
             (fCs && fCs.startsWith(req));
    });

    if (!matchedAirline) return null;
  }

  // c) Specific registration match (e.g. A6-EEA)
  if (rule.registration && String(rule.registration).trim() !== '') {
    const reqRegClean = String(rule.registration).replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const fRegClean = String(flight.registration || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (!fRegClean || fRegClean !== reqRegClean) {
      return null;
    }
  }

  // d) Callsign or flight-number prefix match (e.g. ETH, EK39)
  if (rule.callsignPrefix && String(rule.callsignPrefix).trim() !== '') {
    const prefixes = String(rule.callsignPrefix)
      .split(/[\s,]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);

    const fCs = String(flight.callsign || '').trim().toUpperCase();
    const fNum = String(flight.flightNumber || '').trim().toUpperCase();

    const matchedPrefix = prefixes.some(p => fCs.startsWith(p) || fNum.startsWith(p));
    if (!matchedPrefix) return null;
  }

  // e) Cargo only, Military only, or Passenger only
  if (rule.cargoFilter && rule.cargoFilter !== 'any') {
    const isCargo = isCargoAircraft(flight);
    const isMilitary = isMilitaryAircraft(flight);

    if (rule.cargoFilter === 'cargo_only' && !isCargo) return null;
    if (rule.cargoFilter === 'military_only' && !isMilitary) return null;
    if (rule.cargoFilter === 'passenger_only' && (isCargo || isMilitary)) return null;
  }

  // f) Rare for me match
  const flightIsRare = isRareForMe(flight, sightingCounts, rareSeenThreshold, inherentlyRareList);
  if (rule.rareOnly) {
    if (!flightIsRare) return null;
  }

  // Per-rule overhead threshold:
  // A rule can use a different overhead threshold than the global one
  const ruleThreshold = (rule.overheadThresholdKm != null && Number(rule.overheadThresholdKm) > 0)
    ? Number(rule.overheadThresholdKm)
    : Number(globalOverheadThresholdKm || 5);

  const cpaDist = flight.dCpa != null ? Number(flight.dCpa) : Number(flight.distance || 0);
  if (cpaDist > ruleThreshold) {
    return null;
  }

  const alertStyle = rule.alertStyle || 'normal';
  const tag = (rule.rareOnly || flightIsRare) ? 'RARE' : 'WATCH';

  return {
    matched: true,
    ruleId: rule.id,
    ruleName: rule.name || 'Watchlist Rule',
    alertStyle, // 'silent' | 'normal' | 'special'
    ignoreQuietHours: Boolean(rule.ignoreQuietHours),
    overheadThresholdKm: ruleThreshold,
    tag,
    isRare: flightIsRare
  };
}

/**
 * Evaluate all active watchlist rules for a flight.
 * If multiple match, returns the highest-priority alert.
 *
 * @param {object} flight
 * @param {object[]} rules
 * @param {object} [context={}]
 * @returns {object|null}
 */
export function evaluateFlightWatchlist(flight, rules = [], context = {}) {
  if (!flight || !Array.isArray(rules) || rules.length === 0) return null;

  const matches = [];
  for (const rule of rules) {
    const match = matchFlightAgainstRule(flight, rule, context);
    if (match) matches.push(match);
  }

  if (matches.length === 0) return null;

  // Pick highest priority alert style: special > normal > silent
  const styleOrder = { special: 3, normal: 2, silent: 1 };
  matches.sort((a, b) => (styleOrder[b.alertStyle] || 0) - (styleOrder[a.alertStyle] || 0));

  const bestMatch = matches[0];
  const anyIgnoreQuietHours = matches.some(m => m.ignoreQuietHours);

  return {
    ...bestMatch,
    ignoreQuietHours: anyIgnoreQuietHours,
    allMatchingRules: matches.map(m => m.ruleName)
  };
}
