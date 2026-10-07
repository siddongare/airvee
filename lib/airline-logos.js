// ============================================================
//  AIRVEE — Airline Monogram Badge System
//  - Minimalist Cockpit badges: 28x28px, 6px radius, hairline border
//  - Centered in Martian Mono 11px/500, color var(--text-secondary)
//  - Displays airline's IATA code (fallback: first 3 letters of ICAO, or "--")
//  - Cargo flights: dashed border
//  - Watchlist/rare matches: orange accent border (var(--accent))
//  - 180ms fade/scale-in respecting prefers-reduced-motion
//  - Zero brand colors, zero images, zero network requests
// ============================================================

import { isCargoAircraft, isMilitaryAircraft, isInherentlyRare } from './watchlist.js';

export const ICAO_TO_IATA = {
  // Major International & Middle East
  UAE: 'EK', // Emirates
  QTR: 'QR', // Qatar Airways
  ETD: 'EY', // Etihad Airways
  SVA: 'SV', // Saudia
  OMA: 'WY', // Oman Air
  GUL: 'GF', // Gulf Air
  FDB: 'FZ', // flydubai
  RUK: 'J9', // Jazeera Airways
  MEA: 'ME', // Middle East Airlines
  ELY: 'LY', // El Al
  RJA: 'RJ', // Royal Jordanian

  // Indian Subcontinent & South Asia
  AIC: 'AI', // Air India
  IGO: '6E', // IndiGo
  AXB: 'IX', // Air India Express
  AIX: 'IX', // Air India Express
  SEJ: 'SG', // SpiceJet
  VTI: 'UK', // Vistara
  AKJ: 'QP', // Akasa Air
  GOW: 'G8', // Go First
  PIA: 'PK', // Pakistan International
  ALK: 'UL', // SriLankan Airlines
  BMA: 'BG', // Biman Bangladesh
  UBD: 'BS', // US-Bangla

  // European Flag & Legacy Carriers
  BAW: 'BA', // British Airways
  DLH: 'LH', // Lufthansa
  AFR: 'AF', // Air France
  KLM: 'KL', // KLM
  SWR: 'LX', // Swiss
  THY: 'TK', // Turkish Airlines
  VIR: 'VS', // Virgin Atlantic
  AUA: 'OS', // Austrian Airlines
  BRU: 'SN', // Brussels Airlines
  SAS: 'SK', // Scandinavian Airlines
  FIN: 'AY', // Finnair
  TAP: 'TP', // TAP Air Portugal
  IBE: 'IB', // Iberia
  AZA: 'AZ', // ITA Airways
  LOT: 'LO', // LOT Polish Airlines
  CSA: 'OK', // Czech Airlines
  AEE: 'A3', // Aegean Airlines
  AFL: 'SU', // Aeroflot

  // Low-Cost European
  RYR: 'FR', // Ryanair
  EZY: 'U2', // easyJet
  WZZ: 'W6', // Wizz Air

  // North America
  AAL: 'AA', // American Airlines
  UAL: 'UA', // United Airlines
  DAL: 'DL', // Delta Air Lines
  SWA: 'WN', // Southwest Airlines
  ACA: 'AC', // Air Canada
  WJA: 'WS', // WestJet
  JBU: 'B6', // JetBlue
  ASA: 'AS', // Alaska Airlines
  SKW: 'OO', // SkyWest
  AMX: 'AM', // Aeromexico

  // Asia Pacific & Oceania
  SIA: 'SQ', // Singapore Airlines
  CPA: 'CX', // Cathay Pacific
  JAL: 'JL', // Japan Airlines
  ANA: 'NH', // All Nippon Airways
  CES: 'MU', // China Eastern
  CSN: 'CZ', // China Southern
  CCA: 'CA', // Air China
  MAS: 'MH', // Malaysia Airlines
  THA: 'TG', // Thai Airways
  GIA: 'GA', // Garuda Indonesia
  KAL: 'KE', // Korean Air
  AAR: 'OZ', // Asiana Airlines
  EVA: 'BR', // EVA Air
  HVN: 'VN', // Vietnam Airlines
  AXM: 'AK', // AirAsia
  LNI: 'JT', // Lion Air
  MAH: 'OD', // Batik Air Malaysia
  CAL: 'CI', // China Airlines
  PAL: 'PR', // Philippine Airlines
  CEB: '5J', // Cebu Pacific
  BKP: 'PG', // Bangkok Airways
  MNG: 'OM', // MIAT Mongolian
  QFA: 'QF', // Qantas
  VOZ: 'VA', // Virgin Australia

  // Africa & South America
  ETH: 'ET', // Ethiopian Airlines
  SAA: 'SA', // South African Airways
  RAM: 'AT', // Royal Air Maroc
  MSR: 'MS', // EgyptAir
  AVA: 'AV', // Avianca
  LAN: 'LA', // LATAM
  TAM: 'JJ', // LATAM Brasil

  // Dedicated Freight / Cargo Carriers
  FDX: 'FX', // FedEx Express
  UPS: '5X', // UPS Airlines
  CLX: 'CV', // Cargolux
  GTI: '5Y', // Atlas Air
  ABW: 'RU', // AirBridgeCargo
  BOX: '3S', // AeroLogic
  SQC: 'SQ', // Singapore Airlines Cargo
  PAC: 'PO', // Polar Air Cargo
  ATN: '8C', // Air Transport International
  CJT: 'W8', // Cargojet
  MPH: 'MP', // Martinair
  NCA: 'KZ', // Nippon Cargo Airlines
  BCS: 'QY', // European Air Transport Leipzig
  GEC: 'LH', // Lufthansa Cargo
  ABD: '5B'  // Air Atlanta Icelandic
};

export const NAME_TO_IATA = {
  'emirates': 'EK',
  'indigo': '6E',
  'qatar': 'QR',
  'air india express': 'IX',
  'air india': 'AI',
  'british airways': 'BA',
  'lufthansa': 'LH',
  'singapore': 'SQ',
  'united': 'UA',
  'delta': 'DL',
  'american airlines': 'AA',
  'air france': 'AF',
  'klm': 'KL',
  'swiss': 'LX',
  'turkish': 'TK',
  'etihad': 'EY',
  'cathay': 'CX',
  'vistara': 'UK',
  'spicejet': 'SG',
  'akasa': 'QP',
  'saudia': 'SV',
  'oman air': 'WY',
  'gulf air': 'GF',
  'flydubai': 'FZ',
  'ethiopian': 'ET',
  'japan airlines': 'JL',
  'ana': 'NH',
  'korean air': 'KE',
  'asiana': 'OZ',
  'eva air': 'BR',
  'vietnam airlines': 'VN',
  'ryanair': 'FR',
  'easyjet': 'U2',
  'wizz': 'W6',
  'qantas': 'QF',
  'virgin': 'VS',
  'fedex': 'FX',
  'ups': '5X',
  'cargolux': 'CV',
  'atlas air': '5Y'
};

const KNOWN_IATA_SET = new Set([
  ...Object.values(ICAO_TO_IATA),
  ...Object.values(NAME_TO_IATA)
]);

/**
 * Resolve an airline's IATA code (fallback: first 3 letters of ICAO, or "--" if unknown).
 *
 * @param {object|string} flightOrCallsign
 * @param {string} [airlineName='']
 * @param {string} [icao='']
 * @returns {string} 2-letter IATA code, 3-letter ICAO code, or "--"
 */
export function resolveAirlineMonogram(flightOrCallsign = '', airlineName = '', icao = '') {
  let callsign = '';
  let flightNumber = '';
  let airline = '';
  let airlineIcao = '';
  let explicitIata = '';

  if (flightOrCallsign && typeof flightOrCallsign === 'object') {
    const f = flightOrCallsign;
    callsign = f.callsign || '';
    flightNumber = f.flightNumber || '';
    airline = f.airline || airlineName || '';
    airlineIcao = f.airlineIcao || f.icao || icao || '';
    explicitIata = f.airlineIata || f.iata || '';
  } else {
    callsign = String(flightOrCallsign || '');
    airline = String(airlineName || '');
    airlineIcao = String(icao || '');
  }

  // 1. Explicit 2-letter IATA code if available
  if (explicitIata && typeof explicitIata === 'string' && explicitIata.trim().length === 2) {
    return explicitIata.trim().toUpperCase();
  }

  const cleanIcao = airlineIcao.trim().toUpperCase();
  const cleanCs = callsign.trim().toUpperCase();
  const cleanFn = flightNumber.trim().toUpperCase();
  const cleanName = airline.trim().toLowerCase();

  // 2. Lookup by ICAO code
  if (cleanIcao && ICAO_TO_IATA[cleanIcao]) {
    return ICAO_TO_IATA[cleanIcao];
  }

  // 3. Lookup by 3-letter ICAO prefix from callsign or flightNumber
  const cs3 = cleanCs.length >= 3 && /^[A-Z]{3}/.test(cleanCs) ? cleanCs.slice(0, 3) : '';
  if (cs3 && ICAO_TO_IATA[cs3]) {
    return ICAO_TO_IATA[cs3];
  }
  const fn3 = cleanFn.length >= 3 && /^[A-Z]{3}/.test(cleanFn) ? cleanFn.slice(0, 3) : '';
  if (fn3 && ICAO_TO_IATA[fn3]) {
    return ICAO_TO_IATA[fn3];
  }

  // 4. Lookup by airline name
  if (cleanName) {
    for (const [key, iata] of Object.entries(NAME_TO_IATA)) {
      if (cleanName.includes(key)) {
        return iata;
      }
    }
  }

  // 5. Check if callsign or flightNumber starts with a known 2-character IATA code followed by digit
  // e.g. "EK39", "6E202", "AI101", "BA143"
  const iataMatch = cleanFn.match(/^([A-Z0-9]{2})\d/) || cleanCs.match(/^([A-Z0-9]{2})\d/);
  if (iataMatch && KNOWN_IATA_SET.has(iataMatch[1])) {
    return iataMatch[1];
  }

  // 6. Fall back to first 3 letters of ICAO code if available
  if (cleanIcao && /^[A-Z0-9]{3}/.test(cleanIcao)) {
    return cleanIcao.slice(0, 3);
  }
  if (cs3 && /^[A-Z0-9]{3}/.test(cs3)) {
    return cs3;
  }

  // 7. Check if flight is military: show "MIL" if no specific military monogram was detected
  if (flightOrCallsign && typeof flightOrCallsign === 'object' && isMilitaryAircraft(flightOrCallsign)) {
    return 'MIL';
  }

  // 8. Unknown airline
  return '--';
}

/**
 * Backwards-compatible alias for existing callers.
 */
export function resolveAirlineKey(flightOrCallsign = '', airlineName = '', icao = '') {
  return resolveAirlineMonogram(flightOrCallsign, airlineName, icao);
}

/**
 * Format notification title/prefix with monogram and airline name.
 * e.g. "EK · Emirates"
 *
 * @param {object|string} flight
 * @returns {string} e.g. "EK · Emirates"
 */
export function formatNotificationAirline(flight) {
  if (!flight) return '--';
  const monogram = resolveAirlineMonogram(flight);
  const rawAirline = typeof flight === 'object' ? (flight.airline || '').trim() : '';
  const rawId = typeof flight === 'object' ? (flight.flightNumber || flight.callsign || '').trim() : String(flight).trim();

  if (monogram && monogram !== '--') {
    const upper = rawAirline.toUpperCase();
    const alreadyPrefixed = upper === monogram || upper.startsWith(`${monogram} ·`) || upper.startsWith(`${monogram} -`) || upper.startsWith(`${monogram} `);
    if (rawAirline && !alreadyPrefixed) {
      return `${monogram} · ${rawAirline}`;
    }
    if (rawAirline) {
      return rawAirline;
    }
    return `${monogram} · ${rawId}`;
  }

  return rawAirline || rawId || '--';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build 28x28px Cockpit Minimal airline monogram badge HTML.
 *
 * - 28x28px badge, 1px hairline border, 6px radius
 * - Centered in Martian Mono 11px/500, color var(--text-secondary)
 * - Cargo flights: dashed border (is-cargo)
 * - Military flights: military badge indicator (is-military)
 * - Watchlist/rare: orange border (var(--accent))
 * - Zero brand colors, zero images, zero network requests
 *
 * @param {object|string} flightOrCallsign
 * @param {string|object} [airlineName='']
 * @param {string|object} [icao='']
 * @param {object} [options={}]
 * @returns {string} HTML string
 */
export function getAirlineMonogramBadge(flightOrCallsign = '', airlineName = '', icao = '', options = {}) {
  let opts = options;
  let flight = null;

  if (flightOrCallsign && typeof flightOrCallsign === 'object') {
    flight = flightOrCallsign;
    if (typeof airlineName === 'object') {
      opts = airlineName;
    }
  } else if (typeof icao === 'object') {
    opts = icao;
  }

  const monogram = resolveAirlineMonogram(flight || flightOrCallsign, airlineName, icao);
  const name = (flight && flight.airline) || (typeof airlineName === 'string' ? airlineName : '') || (flight && flight.callsign) || (typeof flightOrCallsign === 'string' ? flightOrCallsign : '') || '';

  // Determine variant classes
  const isMilitary = opts.isMilitary != null
    ? opts.isMilitary
    : (flight ? (flight.isMilitary === true || flight.flightType === 'military' || isMilitaryAircraft(flight)) : false);

  const isCargo = opts.isCargo != null
    ? opts.isCargo
    : (flight ? (!isMilitary && (flight.isCargo === true || flight.flightType === 'cargo' || isCargoAircraft(flight))) : false);

  const isWatchlist = opts.isWatchlist != null
    ? opts.isWatchlist
    : (flight ? Boolean(flight.watchlistTag || flight.isWatchlistMatch || flight.isRare || (flight.aircraftType && isInherentlyRare(flight.aircraftType))) : false);

  const classNames = ['airline-monogram-badge'];
  if (isMilitary) classNames.push('is-military');
  if (isCargo) classNames.push('is-cargo');
  if (isWatchlist) classNames.push('is-watchlist');

  return `<span class="${classNames.join(' ')}" title="${escapeHtml(name)}">${escapeHtml(monogram)}</span>`;
}

/**
 * Backwards-compatible alias for existing code: returns the 28x28px monogram badge.
 */
export function getAirlineLogoHtml(flightOrCallsign = '', airlineName = '', icao = '', optionsOrSize = {}) {
  const opts = typeof optionsOrSize === 'object' ? optionsOrSize : {};
  return getAirlineMonogramBadge(flightOrCallsign, airlineName, icao, opts);
}
