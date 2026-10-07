// ============================================================
//  AIRVEE — Bundled Airlines & Aircraft Types Directory
//  Zero network requests. Single source of truth for UI search & chips.
// ============================================================

export const AIRLINE_GROUPS = {
  gulf: {
    id: 'gulf',
    name: 'Gulf carriers',
    description: 'Emirates, Qatar Airways, Etihad, Saudia, Gulf Air, flydubai, Air Arabia, Oman Air',
    codes: ['EK', 'UAE', 'QR', 'QTR', 'EY', 'ETD', 'SV', 'SVA', 'GF', 'GFA', 'FZ', 'FDB', 'G9', 'ABY', 'WY', 'OMA'],
    memberIcaos: ['UAE', 'QTR', 'ETD', 'SVA', 'GFA', 'FDB', 'ABY', 'OMA']
  },
  indian: {
    id: 'indian',
    name: 'Indian carriers',
    description: 'Air India, IndiGo, Vistara, SpiceJet, Akasa Air, Air India Express',
    codes: ['AIC', 'AI', 'IGO', '6E', 'VTI', 'UK', 'SEJ', 'SG', 'AKJ', 'QP', 'AXB', 'IX'],
    memberIcaos: ['AIC', 'IGO', 'VTI', 'SEJ', 'AKJ', 'AXB']
  },
  european: {
    id: 'european',
    name: 'European flag carriers',
    description: 'British Airways, Lufthansa, Air France, KLM, Swiss, Turkish Airlines, Iberia, ITA, SAS, Finnair, TAP',
    codes: ['BAW', 'BA', 'DLH', 'LH', 'AFR', 'AF', 'KLM', 'KL', 'SWR', 'LX', 'THY', 'TK', 'IBE', 'IB', 'ITY', 'AZ', 'SAS', 'SK', 'FIN', 'AY', 'TAP', 'TP'],
    memberIcaos: ['BAW', 'DLH', 'AFR', 'KLM', 'SWR', 'THY', 'IBE', 'ITY', 'SAS', 'FIN', 'TAP']
  },
  us_major: {
    id: 'us_major',
    name: 'US major carriers',
    description: 'American, Delta, United, Southwest, Alaska, JetBlue',
    codes: ['AAL', 'AA', 'DAL', 'DL', 'UAL', 'UA', 'SWA', 'WN', 'ASA', 'AS', 'JBU', 'B6'],
    memberIcaos: ['AAL', 'DAL', 'UAL', 'SWA', 'ASA', 'JBU']
  }
};

export const AIRLINES = [
  // Gulf & Middle East
  { name: 'Emirates', icao: 'UAE', iata: 'EK' },
  { name: 'Qatar Airways', icao: 'QTR', iata: 'QR' },
  { name: 'Etihad Airways', icao: 'ETD', iata: 'EY' },
  { name: 'Saudia', icao: 'SVA', iata: 'SV' },
  { name: 'flydubai', icao: 'FDB', iata: 'FZ' },
  { name: 'Gulf Air', icao: 'GFA', iata: 'GF' },
  { name: 'Air Arabia', icao: 'ABY', iata: 'G9' },
  { name: 'Oman Air', icao: 'OMA', iata: 'WY' },
  { name: 'Kuwait Airways', icao: 'KAC', iata: 'KU' },
  { name: 'Jazeera Airways', icao: 'JZR', iata: 'J9' },
  { name: 'Middle East Airlines', icao: 'MEA', iata: 'ME' },
  { name: 'Royal Jordanian', icao: 'RJA', iata: 'RJ' },
  { name: 'El Al', icao: 'ELY', iata: 'LY' },

  // Indian Subcontinent
  { name: 'Air India', icao: 'AIC', iata: 'AI' },
  { name: 'IndiGo', icao: 'IGO', iata: '6E' },
  { name: 'Vistara', icao: 'VTI', iata: 'UK' },
  { name: 'SpiceJet', icao: 'SEJ', iata: 'SG' },
  { name: 'Akasa Air', icao: 'AKJ', iata: 'QP' },
  { name: 'Air India Express', icao: 'AXB', iata: 'IX' },
  { name: 'SriLankan Airlines', icao: 'ALK', iata: 'UL' },
  { name: 'Biman Bangladesh', icao: 'BBC', iata: 'BG' },
  { name: 'Pakistan International', icao: 'PIA', iata: 'PK' },
  { name: 'US-Bangla Airlines', icao: 'UBG', iata: 'BS' },

  // Europe
  { name: 'British Airways', icao: 'BAW', iata: 'BA' },
  { name: 'Lufthansa', icao: 'DLH', iata: 'LH' },
  { name: 'Air France', icao: 'AFR', iata: 'AF' },
  { name: 'KLM', icao: 'KLM', iata: 'KL' },
  { name: 'Swiss International', icao: 'SWR', iata: 'LX' },
  { name: 'Turkish Airlines', icao: 'THY', iata: 'TK' },
  { name: 'Virgin Atlantic', icao: 'VIR', iata: 'VS' },
  { name: 'Austrian Airlines', icao: 'AUA', iata: 'OS' },
  { name: 'Brussels Airlines', icao: 'BEL', iata: 'SN' },
  { name: 'Scandinavian Airlines', icao: 'SAS', iata: 'SK' },
  { name: 'Finnair', icao: 'FIN', iata: 'AY' },
  { name: 'TAP Air Portugal', icao: 'TAP', iata: 'TP' },
  { name: 'Iberia', icao: 'IBE', iata: 'IB' },
  { name: 'ITA Airways', icao: 'ITY', iata: 'AZ' },
  { name: 'LOT Polish Airlines', icao: 'LOT', iata: 'LO' },
  { name: 'Aegean Airlines', icao: 'AEE', iata: 'A3' },
  { name: 'Ryanair', icao: 'RYR', iata: 'FR' },
  { name: 'easyJet', icao: 'EZY', iata: 'U2' },
  { name: 'Wizz Air', icao: 'WZZ', iata: 'W6' },
  { name: 'Aeroflot', icao: 'AFL', iata: 'SU' },

  // North America
  { name: 'American Airlines', icao: 'AAL', iata: 'AA' },
  { name: 'Delta Air Lines', icao: 'DAL', iata: 'DL' },
  { name: 'United Airlines', icao: 'UAL', iata: 'UA' },
  { name: 'Southwest Airlines', icao: 'SWA', iata: 'WN' },
  { name: 'Air Canada', icao: 'ACA', iata: 'AC' },
  { name: 'WestJet', icao: 'WJA', iata: 'WS' },
  { name: 'Alaska Airlines', icao: 'ASA', iata: 'AS' },
  { name: 'JetBlue', icao: 'JBU', iata: 'B6' },
  { name: 'Spirit Airlines', icao: 'NKS', iata: 'NK' },
  { name: 'Aeromexico', icao: 'AMX', iata: 'AM' },

  // Asia Pacific & Oceania
  { name: 'Singapore Airlines', icao: 'SIA', iata: 'SQ' },
  { name: 'Cathay Pacific', icao: 'CPA', iata: 'CX' },
  { name: 'Japan Airlines', icao: 'JAL', iata: 'JL' },
  { name: 'All Nippon Airways', icao: 'ANA', iata: 'NH' },
  { name: 'Korean Air', icao: 'KAL', iata: 'KE' },
  { name: 'Asiana Airlines', icao: 'AAR', iata: 'OZ' },
  { name: 'EVA Air', icao: 'EVA', iata: 'BR' },
  { name: 'China Airlines', icao: 'CAL', iata: 'CI' },
  { name: 'Air China', icao: 'CCA', iata: 'CA' },
  { name: 'China Eastern', icao: 'CES', iata: 'MU' },
  { name: 'China Southern', icao: 'CSN', iata: 'CZ' },
  { name: 'Malaysia Airlines', icao: 'MAS', iata: 'MH' },
  { name: 'Thai Airways', icao: 'THA', iata: 'TG' },
  { name: 'Garuda Indonesia', icao: 'GIA', iata: 'GA' },
  { name: 'Vietnam Airlines', icao: 'HVN', iata: 'VN' },
  { name: 'AirAsia', icao: 'AXM', iata: 'AK' },
  { name: 'Lion Air', icao: 'LNI', iata: 'JT' },
  { name: 'Batik Air', icao: 'BTK', iata: 'ID' },
  { name: 'Philippine Airlines', icao: 'PAL', iata: 'PR' },
  { name: 'Cebu Pacific', icao: 'CEB', iata: '5J' },
  { name: 'Qantas', icao: 'QFA', iata: 'QF' },
  { name: 'Virgin Australia', icao: 'VOZ', iata: 'VA' },
  { name: 'Air New Zealand', icao: 'ANZ', iata: 'NZ' },

  // Africa & South America
  { name: 'Ethiopian Airlines', icao: 'ETH', iata: 'ET' },
  { name: 'EgyptAir', icao: 'MSR', iata: 'MS' },
  { name: 'Royal Air Maroc', icao: 'RAM', iata: 'AT' },
  { name: 'Kenya Airways', icao: 'KQA', iata: 'KQ' },
  { name: 'South African Airways', icao: 'SAA', iata: 'SA' },
  { name: 'LATAM Airlines', icao: 'LAN', iata: 'LA' },
  { name: 'Avianca', icao: 'AVA', iata: 'AV' },
  { name: 'Copa Airlines', icao: 'CMP', iata: 'CM' },
  { name: 'Gol Transportes Aéreos', icao: 'GLO', iata: 'G3' },
  { name: 'Azul Brazilian Airlines', icao: 'AZU', iata: 'AD' },

  // Dedicated Freight & Cargo Carriers
  { name: 'FedEx Express', icao: 'FDX', iata: 'FX' },
  { name: 'UPS Airlines', icao: 'UPS', iata: '5X' },
  { name: 'Cargolux', icao: 'CLX', iata: 'CV' },
  { name: 'Atlas Air', icao: 'GTI', iata: '5Y' },
  { name: 'AeroLogic', icao: 'BOX', iata: '3S' },
  { name: 'AirBridgeCargo', icao: 'ABW', iata: 'RU' },
  { name: 'Polar Air Cargo', icao: 'PAC', iata: 'PO' },
  { name: 'Cargojet', icao: 'CJT', iata: 'W8' },
  { name: 'Nippon Cargo Airlines', icao: 'NCA', iata: 'KZ' },
  { name: 'Martinair Cargo', icao: 'MPH', iata: 'MP' },
  { name: 'Air Transport Services Group', icao: 'ATN', iata: '8C' }
];

export const AIRCRAFT_TYPES = [
  // Rare Classics & Super-Heavies (from rare_aircraft.json)
  { name: 'Airbus A380-800', icao: 'A388' },
  { name: 'Boeing 747-8', icao: 'B748' },
  { name: 'Boeing 747-400', icao: 'B744' },
  { name: 'Boeing 747-200', icao: 'B742' },
  { name: 'Boeing 747-300', icao: 'B743' },
  { name: 'Boeing 747-100', icao: 'B741' },
  { name: 'Boeing 747 Dreamlifter', icao: 'B74R' },
  { name: 'Boeing 747SP', icao: 'B74S' },
  { name: 'Antonov An-225 Mriya', icao: 'A225' },
  { name: 'Antonov An-124 Ruslan', icao: 'A124' },
  { name: 'Antonov An-12', icao: 'AN12' },
  { name: 'Antonov An-24', icao: 'AN24' },
  { name: 'Antonov An-26', icao: 'AN26' },
  { name: 'Antonov An-72', icao: 'AN72' },
  { name: 'Ilyushin Il-76', icao: 'IL76' },
  { name: 'Ilyushin Il-62', icao: 'IL62' },
  { name: 'Ilyushin Il-96', icao: 'IL96' },
  { name: 'Tupolev Tu-134', icao: 'TU34' },
  { name: 'Tupolev Tu-154', icao: 'TU54' },
  { name: 'Concorde', icao: 'CONC' },
  { name: 'Bell Boeing V-22 Osprey', icao: 'V22' },
  { name: 'Boeing C-17 Globemaster III', icao: 'C17' },
  { name: 'Lockheed C-5 Galaxy', icao: 'C5M' },
  { name: 'Lockheed C-130 Hercules', icao: 'C130' },
  { name: 'Boeing KC-46 Pegasus', icao: 'KC46' },
  { name: 'McDonnell Douglas KC-10 Extender', icao: 'KC10' },
  { name: 'Airbus A330 MRTT', icao: 'KC30' },
  { name: 'Airbus A310', icao: 'A310' },
  { name: 'Airbus A340-200', icao: 'A342' },
  { name: 'Airbus A340-500', icao: 'A345' },
  { name: 'Airbus A340-600', icao: 'A346' },
  { name: 'McDonnell Douglas MD-11', icao: 'MD11' },
  { name: 'McDonnell Douglas DC-10', icao: 'DC10' },
  { name: 'Boeing E-3 Sentry (AWACS)', icao: 'E3CF' },
  { name: 'Boeing E-4 Nightwatch', icao: 'E4B' },
  { name: 'Boeing VC-25 (Air Force One)', icao: 'VC25' },
  { name: 'Boeing B-52 Stratofortress', icao: 'B52' },
  { name: 'Rockwell B-1 Lancer', icao: 'B1' },
  { name: 'Northrop B-2 Spirit', icao: 'B2' },

  // Modern Wide-Body Passenger & Cargo (Twin-Aisle)
  { name: 'Airbus A350-900', icao: 'A359' },
  { name: 'Airbus A350-1000', icao: 'A35K' },
  { name: 'Airbus A330-900neo', icao: 'A339' },
  { name: 'Airbus A330-800neo', icao: 'A338' },
  { name: 'Airbus A330-300', icao: 'A333' },
  { name: 'Airbus A330-200', icao: 'A332' },
  { name: 'Boeing 777-300ER', icao: 'B77W' },
  { name: 'Boeing 777-200LR', icao: 'B77L' },
  { name: 'Boeing 777-200', icao: 'B772' },
  { name: 'Boeing 777-300', icao: 'B773' },
  { name: 'Boeing 787-9 Dreamliner', icao: 'B789' },
  { name: 'Boeing 787-8 Dreamliner', icao: 'B788' },
  { name: 'Boeing 787-10 Dreamliner', icao: 'B78X' },
  { name: 'Boeing 767-300', icao: 'B763' },
  { name: 'Boeing 767-400', icao: 'B764' },

  // Narrow-Body & Regional Airliners (Single-Aisle)
  { name: 'Airbus A321neo', icao: 'A21N' },
  { name: 'Airbus A320neo', icao: 'A20N' },
  { name: 'Airbus A321-200', icao: 'A321' },
  { name: 'Airbus A320-200', icao: 'A320' },
  { name: 'Airbus A319', icao: 'A319' },
  { name: 'Airbus A220-300', icao: 'BCS3' },
  { name: 'Airbus A220-100', icao: 'BCS1' },
  { name: 'Boeing 737 MAX 8', icao: 'B38M' },
  { name: 'Boeing 737 MAX 9', icao: 'B39M' },
  { name: 'Boeing 737-800', icao: 'B738' },
  { name: 'Boeing 737-900', icao: 'B739' },
  { name: 'Boeing 737-700', icao: 'B737' },
  { name: 'Embraer E190', icao: 'E190' },
  { name: 'Embraer E195', icao: 'E195' },
  { name: 'Embraer E195-E2', icao: 'E295' },
  { name: 'Bombardier CRJ-900', icao: 'CRJ9' },
  { name: 'ATR 72', icao: 'ATR7' },
  { name: 'De Havilland Dash 8-400', icao: 'DH8D' }
];

export const CATEGORIES = [
  { id: 'cargo', name: 'Cargo flights', description: 'Dedicated freighters and cargo carriers' },
  { id: 'wide-body', name: 'Wide-body flights', description: 'Twin-aisle heavy airliners (A330, A350, A380, 777, 787, 747)' },
  { id: 'passenger', name: 'Passenger flights', description: 'Commercial passenger airliners' }
];

export const DIRECTIONS = [
  { id: 'N', name: 'Northbound', heading: '337.5° – 22.5°' },
  { id: 'NE', name: 'Northeastbound', heading: '22.5° – 67.5°' },
  { id: 'E', name: 'Eastbound', heading: '67.5° – 112.5°' },
  { id: 'SE', name: 'Southeastbound', heading: '112.5° – 157.5°' },
  { id: 'S', name: 'Southbound', heading: '157.5° – 202.5°' },
  { id: 'SW', name: 'Southwestbound', heading: '202.5° – 247.5°' },
  { id: 'W', name: 'Westbound', heading: '247.5° – 292.5°' },
  { id: 'NW', name: 'Northwestbound', heading: '292.5° – 337.5°' }
];

export const PRESETS = [
  {
    id: 'cargo_only',
    label: 'Cargo only',
    createRule: () => ({
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Cargo flights',
      enabled: true,
      conditions: { category: ['cargo'] },
      action: 'alert',
      tag: 'CARGO'
    })
  },
  {
    id: 'wide_bodies',
    label: 'Wide-bodies',
    createRule: () => ({
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Wide-body flights',
      enabled: true,
      conditions: { category: ['wide-body'] },
      action: 'alert',
      tag: 'HEAVY'
    })
  },
  {
    id: 'rare_aircraft',
    label: 'Rare aircraft',
    createRule: () => ({
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Rare aircraft',
      enabled: true,
      conditions: { rareForMe: true },
      action: 'loud',
      tag: 'RARE'
    })
  },
  {
    id: 'gulf_carriers',
    label: 'Gulf carriers',
    createRule: () => ({
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Gulf carriers',
      enabled: true,
      conditions: { airlines: ['gulf'] },
      action: 'loud',
      tag: 'GULF'
    })
  }
];

export function lookupAirline(query) {
  if (!query) return null;
  const q = String(query).trim().toLowerCase();
  return AIRLINES.find(a =>
    a.icao.toLowerCase() === q ||
    a.iata.toLowerCase() === q ||
    a.name.toLowerCase() === q ||
    a.name.toLowerCase().startsWith(q) ||
    a.name.toLowerCase().includes(q)
  ) || null;
}

export function lookupAircraftType(query) {
  if (!query) return null;
  const q = String(query).trim().toUpperCase();
  return AIRCRAFT_TYPES.find(t =>
    t.icao === q ||
    t.name.toUpperCase().includes(q)
  ) || null;
}

export function getAirlineDisplayName(code) {
  if (!code) return '';
  const c = String(code).trim().toUpperCase();
  if (AIRLINE_GROUPS[c.toLowerCase()]) {
    return AIRLINE_GROUPS[c.toLowerCase()].name;
  }
  const found = AIRLINES.find(a => a.icao === c || a.iata === c);
  return found ? found.name : c;
}

export function getAircraftDisplayName(type) {
  if (!type) return '';
  const t = String(type).trim().toUpperCase();
  const found = AIRCRAFT_TYPES.find(a => a.icao === t);
  return found ? found.name : t;
}

/**
 * Generates a human-friendly rule name from its conditions.
 *
 * @param {object} conditions
 * @returns {string} Readable rule name
 */
export function generateRuleNameFromConditions(conditions = {}) {
  const parts = [];

  if (Array.isArray(conditions.airlines) && conditions.airlines.length > 0) {
    const names = conditions.airlines.map(code => {
      const lower = String(code).toLowerCase();
      if (AIRLINE_GROUPS[lower]) return AIRLINE_GROUPS[lower].name;
      const found = AIRLINES.find(a => a.icao.toUpperCase() === code.toUpperCase() || a.iata.toUpperCase() === code.toUpperCase());
      return found ? found.name : code;
    });
    parts.push(names.join(', '));
  }

  if (Array.isArray(conditions.aircraftTypes) && conditions.aircraftTypes.length > 0) {
    const types = conditions.aircraftTypes.map(t => {
      const found = AIRCRAFT_TYPES.find(ac => ac.icao === t.toUpperCase());
      return found ? found.name : t;
    });
    parts.push(types.join(', '));
  }

  if (Array.isArray(conditions.category) && conditions.category.length > 0) {
    const cats = conditions.category.map(c => {
      if (c === 'cargo') return 'Cargo';
      if (c === 'wide-body') return 'Wide-bodies';
      if (c === 'passenger') return 'Passenger';
      return c;
    });
    parts.push(cats.join(', ') + ' flights');
  }

  if (Array.isArray(conditions.direction) && conditions.direction.length > 0) {
    parts.push(conditions.direction.map(d => `${d}bound`).join(', '));
  }

  if (conditions.route) {
    const r = conditions.route;
    if (r.origin && r.destination) parts.push(`${r.origin} → ${r.destination}`);
    else if (r.origin) parts.push(`From ${r.origin}`);
    else if (r.destination) parts.push(`To ${r.destination}`);
    else if (r.flightType === 'international') parts.push('International flights');
    else if (r.flightType === 'domestic') parts.push('Domestic flights');
  }

  if (conditions.registration) {
    parts.push(`Reg ${conditions.registration}`);
  }

  if (conditions.callsignPrefix) {
    parts.push(`Callsign ${conditions.callsignPrefix}*`);
  }

  if (conditions.rareForMe && parts.length === 0) {
    parts.push('Rare aircraft');
  }

  return parts.length > 0 ? parts.join(' · ') : 'Rule';
}

/**
 * Returns a readable sentence and details for a rule card in the list.
 *
 * @param {object} rule
 * @returns {{ title: string, subtitle: string }}
 */
export function formatRuleSentence(rule) {
  if (!rule) return { title: 'Rule', subtitle: 'Alert' };

  let title = rule.name;
  if (!title || title.trim() === '' || title === 'Rule' || title === 'Watchlist Rule') {
    title = generateRuleNameFromConditions(rule.conditions);
  }

  // If group is present, also mention members if name is just group name
  if (rule.conditions && Array.isArray(rule.conditions.airlines) && rule.conditions.airlines.includes('gulf')) {
    if (title === 'Gulf carriers') {
      title = 'Gulf carriers (Emirates, Qatar, Etihad, Saudia...)';
    }
  }

  const actionText = rule.action === 'loud' ? 'Loud alert'
    : rule.action === 'log' ? 'Log only'
    : rule.action === 'ignore' ? 'Ignore'
    : 'Alert';

  const details = [];
  details.push(actionText);

  if (rule.conditions?.rareForMe) {
    details.push('only if rare for me');
  }
  if (rule.conditions?.bypassQuietHours) {
    details.push('ignores quiet hours');
  }
  if (rule.conditions?.overheadThresholdKm) {
    details.push(`within ${rule.conditions.overheadThresholdKm} km`);
  }

  return {
    title,
    subtitle: details.join(' · ')
  };
}
