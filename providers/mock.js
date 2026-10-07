// ============================================================
//  AIRVEE — Debug Mock Flight Data Provider
//  - Generates realistic test aircraft relative to observer coordinates:
//    (a) Direct overhead pass at 37,000 ft (B77W, ETA ~110s, CPA ~0 km)
//    (b) Passing 20 km east of observer at 33,000 ft (A388, CPA ~20 km)
//    (c) Inbound from the southwest at 35,000 ft (B789, ETA ~125s, CPA ~0 km)
//  - Tagged with isMock: true, source: 'mock' so logs never record them
// ============================================================

const EARTH_RADIUS_KM = 6371.0;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Compute new geographic coordinates offset by (eastKm, northKm) in local tangent plane.
 */
export function addOffsetToCoords(originLat, originLon, eastKm, northKm) {
  const dLatDeg = (northKm / EARTH_RADIUS_KM) * RAD_TO_DEG;
  const meanLatRad = originLat * DEG_TO_RAD;
  const cosLat = Math.cos(meanLatRad);
  const dLonDeg = (eastKm / (EARTH_RADIUS_KM * (cosLat || 1))) * RAD_TO_DEG;

  return {
    lat: Math.round((originLat + dLatDeg) * 10000) / 10000,
    lon: Math.round((originLon + dLonDeg) * 10000) / 10000
  };
}

/**
 * Fetch simulated mock flights positioned deterministically relative to observer lat/lon.
 *
 * @param {number} lat - Observer latitude
 * @param {number} lon - Observer longitude
 * @param {number} [radiusKm=15] - Detection radius in km
 * @returns {Promise<Array<object>>} Normalized flight targets
 */
export async function fetchMockFlightsNear(lat, lon, radiusKm = 15) {
  const now = Date.now();
  const obsLat = Number(lat) || 21.1458;
  const obsLon = Number(lon) || 79.0882;

  // Flight A: Direct overhead pass at 37,000 ft (Northbound, 480kt, tCpa ~110s, dCpa ~0km)
  // Distance south: 110s * (480 * 1.852 / 3600 km/s) ≈ 27.163 km
  const posA = addOffsetToCoords(obsLat, obsLon, 0.0, -27.163);

  // Flight B: Passing 20 km East of observer at 33,000 ft (Northbound, 450kt, CPA 20km)
  // East offset: 20 km, South offset: -15 km (tCpa ~65s)
  const posB = addOffsetToCoords(obsLat, obsLon, 20.0, -15.0);

  // Flight C: Inbound from the Southwest at 35,000 ft (Heading 45° NE, 460kt, tCpa ~125s, CPA ~0km)
  // Distance: 125s * (460 * 1.852 / 3600 km/s) ≈ 29.58 km in SW direction (225°)
  const distC = 29.58;
  const offsetC = distC * Math.sin(45 * DEG_TO_RAD); // 20.916 km
  const posC = addOffsetToCoords(obsLat, obsLon, -offsetC, -offsetC);

  const mockFlights = [
    {
      id: 'mock_aic101',
      callsign: 'AIC101',
      flightNumber: 'AI101',
      airline: 'Air India',
      airlineIcao: 'AIC',
      aircraftType: 'B77W',
      registration: 'VT-ALQ',
      lat: posA.lat,
      lon: posA.lon,
      altitudeFt: 37000,
      groundSpeedKt: 480,
      trackDeg: 0,
      verticalRateFpm: 0,
      origin: 'BOM',
      destination: 'JFK',
      timestamp: Math.floor(now / 1000),
      source: 'mock',
      isMock: true,
      squawk: '4215'
    },
    {
      id: 'mock_uae504',
      callsign: 'UAE504',
      flightNumber: 'EK504',
      airline: 'Emirates',
      airlineIcao: 'UAE',
      aircraftType: 'A388',
      registration: 'A6-EVC',
      lat: posB.lat,
      lon: posB.lon,
      altitudeFt: 33000,
      groundSpeedKt: 450,
      trackDeg: 0,
      verticalRateFpm: 0,
      origin: 'DXB',
      destination: 'BOM',
      timestamp: Math.floor(now / 1000),
      source: 'mock',
      isMock: true,
      squawk: '2104'
    },
    {
      id: 'mock_baw143',
      callsign: 'BAW143',
      flightNumber: 'BA143',
      airline: 'British Airways',
      airlineIcao: 'BAW',
      aircraftType: 'B789',
      registration: 'G-ZBKN',
      lat: posC.lat,
      lon: posC.lon,
      altitudeFt: 35000,
      groundSpeedKt: 460,
      trackDeg: 45,
      verticalRateFpm: 0,
      origin: 'LHR',
      destination: 'DEL',
      timestamp: Math.floor(now / 1000),
      source: 'mock',
      isMock: true,
      squawk: '7320'
    }
  ];

  return mockFlights;
}
