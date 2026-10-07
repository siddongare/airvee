// ============================================================
//  AIRVEE — Flightradar24 Provider Adapter
//  Normalizes FR24 public zone feed into standard schema
// ============================================================

const EARTH_RADIUS_KM = 6371;

// Common airline ICAO code to display name mapping
const AIRLINES = {
  UAE: 'Emirates',       AIC: 'Air India',       AXB: 'Air India Express',
  IGO: 'IndiGo',         SEJ: 'SpiceJet',        VTI: 'Vistara',
  AKJ: 'Akasa Air',      THY: 'Turkish Airlines', QTR: 'Qatar Airways',
  ETD: 'Etihad',         SIA: 'Singapore Airlines', CPA: 'Cathay Pacific',
  BAW: 'British Airways', DLH: 'Lufthansa',       AFR: 'Air France',
  KLM: 'KLM',            SWR: 'Swiss',            AAL: 'American Airlines',
  UAL: 'United',          DAL: 'Delta',            JAL: 'Japan Airlines',
  ANA: 'All Nippon',      CES: 'China Eastern',   CSN: 'China Southern',
  CCA: 'Air China',       MAS: 'Malaysia Airlines', THA: 'Thai Airways',
  GIA: 'Garuda',          SVA: 'Saudia',           MEA: 'Middle East Airlines',
  ETH: 'Ethiopian',       SAA: 'South African',    KAL: 'Korean Air',
  AAR: 'Asiana',          EVA: 'EVA Air',           HVN: 'Vietnam Airlines',
  RAM: 'Royal Air Maroc', RYR: 'Ryanair',          EZY: 'easyJet',
  FDB: 'flydubai',        AXM: 'AirAsia',          LNI: 'Lion Air',
  MSR: 'EgyptAir',        PIA: 'PIA',              ALK: 'SriLankan',
  BMA: 'Biman Bangladesh', UBD: 'US-Bangla',       RUK: 'Jazeera Airways',
  OMA: 'Oman Air',        GUL: 'Gulf Air',         FDX: 'FedEx',
  UPS: 'UPS Airlines',    GTI: 'Atlas Air',        CLX: 'Cargolux',
  AHO: 'Air Hamburg',     ELY: 'El Al',            RJA: 'Royal Jordanian',
  WZZ: 'Wizz Air',        VOZ: 'Virgin Australia', QFA: 'Qantas',
  TAP: 'TAP Portugal',    IBE: 'Iberia',           AZA: 'ITA Airways',
  LOT: 'LOT Polish',      CSA: 'Czech Airlines',   MAH: 'Malindo Air',
  CAL: 'China Airlines',  PAL: 'Philippine Airlines',
  CEB: 'Cebu Pacific',    BKP: 'Bangkok Airways',  MNG: 'MIAT',
  FIN: 'Finnair',         SAS: 'SAS',              TAI: 'TACA',
  AMX: 'Aeromexico',      AVA: 'Avianca',          LAN: 'LATAM',
  GOW: 'Go First',        AIX: 'Air India Express', SKW: 'SkyWest'
};

/**
 * Resolve airline name from callsign or 3-letter ICAO operator code
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

/**
 * Calculate bounding box around coordinates for FR24 feed query
 */
function getBoundingBox(lat, lon, radiusKm) {
  const dLat = radiusKm / 111.32;
  const cosLat = Math.cos(lat * Math.PI / 180);
  const dLon = radiusKm / (111.32 * (Math.abs(cosLat) > 0.001 ? cosLat : 1));
  return {
    latMin: lat - dLat,
    latMax: lat + dLat,
    lonMin: lon - dLon,
    lonMax: lon + dLon
  };
}

/**
 * Fetch live aircraft data near a geographic location from Flightradar24.
 *
 * @param {number} lat - Latitude in decimal degrees
 * @param {number} lon - Longitude in decimal degrees
 * @param {number} radiusKm - Query radius in kilometers
 * @returns {Promise<Array<NormalizedFlight>>} Array of normalized flight objects
 */
export async function fetchFlightsNear(lat, lon, radiusKm) {
  const bounds = getBoundingBox(lat, lon, radiusKm);

  const url =
    `https://data-cloud.flightradar24.com/zones/fcgi/feed.json` +
    `?bounds=${bounds.latMax.toFixed(4)},${bounds.latMin.toFixed(4)},` +
    `${bounds.lonMin.toFixed(4)},${bounds.lonMax.toFixed(4)}` +
    `&faa=1&satellite=1&mlat=1&flarm=1&adsb=1` +
    `&gnd=0&air=1&vehicles=0&estimated=0&maxage=14400&gliders=0&stats=0`;

  const resp = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  if (!resp.ok) {
    const err = new Error(`FR24 HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  const normalized = [];

  for (const [key, val] of Object.entries(data)) {
    // Basic verification of flight array format
    if (!Array.isArray(val) || val.length < 14) continue;
    if (val[14] === 1 || val[14] === true) continue; // Skip ground vehicles

    const flightLat = Number(val[1]);
    const flightLon = Number(val[2]);
    if (isNaN(flightLat) || isNaN(flightLon)) continue;

    const callsign = String(val[16] || val[13] || val[0] || key).trim();
    const flightNumber = String(val[13] || val[16] || '').trim();
    const airlineIcao = String(val[18] || (callsign.length >= 3 ? callsign.slice(0, 3) : '')).toUpperCase();
    const airline = resolveAirline(callsign, airlineIcao);
    const aircraftType = String(val[8] || '').trim();
    const registration = String(val[9] || '').trim();
    const altitudeFt = Number(val[4]) || 0;
    const groundSpeedKt = Number(val[5]) || 0;
    const trackDeg = Number(val[3]) || 0;
    const verticalRateFpm = Number(val[15]) || 0;
    const origin = String(val[11] || '').trim().toUpperCase();
    const destination = String(val[12] || '').trim().toUpperCase();
    const timestamp = Number(val[10]) || Math.floor(Date.now() / 1000);
    const squawk = String(val[6] || '—').trim();
    const icao = String(val[0] || '').trim();

    // Standardized Normalized Flight Object Shape
    normalized.push({
      id: String(key),
      callsign,
      flightNumber,
      airline,
      airlineIcao,
      aircraftType,
      registration,
      lat: flightLat,
      lon: flightLon,
      altitudeFt,
      groundSpeedKt,
      trackDeg,
      verticalRateFpm,
      origin,
      destination,
      timestamp,
      source: 'fr24',

      // Backward-compatibility aliases for existing UI code
      latitude: flightLat,
      longitude: flightLon,
      altitude: altitudeFt,
      speed: groundSpeedKt,
      heading: trackDeg,
      verticalSpeed: verticalRateFpm,
      squawk,
      icao
    });
  }

  return normalized;
}
