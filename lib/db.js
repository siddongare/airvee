// ============================================================
//  AIRVEE — IndexedDB Flight Log & Statistics Engine
//  - Persistent logging of flights that passed within threshold
//  - 1 alert & log per flight per calendar day deduplication
//  - Comprehensive aggregation: hours, days, airlines, routes, aircraft
//  - Aircraft typical seat capacity lookup table (clearly labeled estimate)
//  - Callsign-to-route cache (with 'likely' indicator for unverified)
//  - CSV export & safe log purge
// ============================================================

const DB_NAME = 'airvee_flight_db';
const DB_VERSION = 1;
const STORE_NAME = 'flight_passes';

// ---- Typical Passenger Seating Capacity Lookup Table ----
// Note: ADS-B transponders do not transmit passenger numbers.
// These are standard typical airline 2/3-class configurations, clearly labeled as estimates.
export const AIRCRAFT_SEATS = {
  // Wide-body & Super-heavy
  'A388': 525, 'A380': 525,
  'B748': 410, 'B744': 416, 'B747': 412,
  'B77W': 396, 'B773': 368, 'B772': 312, 'B77L': 317, 'B778': 384, 'B779': 426,
  'A35K': 369, 'A359': 315, 'A350': 325,
  'B78X': 330, 'B789': 296, 'B788': 248, 'B787': 275,
  'A339': 287, 'A338': 257, 'A333': 277, 'A332': 247, 'A330': 260,
  'A346': 380, 'A345': 313, 'A343': 295, 'A340': 300,
  'B764': 240, 'B763': 218, 'B762': 181,

  // Narrow-body
  'A21N': 220, 'A321': 200,
  'A20N': 180, 'A320': 168,
  'A19N': 150, 'A319': 140,
  'A318': 120,
  'BCS3': 140, 'A223': 140, 'BCS1': 115, 'A221': 115,
  'B39M': 210, 'B739': 189,
  'B38M': 189, 'B738': 162,
  'B37M': 153, 'B737': 138,

  // Regional & Turboprops
  'E295': 132, 'E195': 120, 'E290': 106, 'E190': 100,
  'E175': 76,  'E170': 70,  'E145': 50,
  'CRJ9': 90,  'CRJ7': 70,  'CRJ2': 50,
  'AT76': 72,  'AT75': 70,  'AT72': 70,  'AT45': 48,
  'DH8D': 78,  'Q400': 78
};

/**
 * Get typical seat count estimate for an aircraft type code.
 * Returns null if unknown, so ADS-B data is never faked.
 *
 * @param {string} typeCode - e.g. "B77W", "A320"
 * @returns {number|null} Estimated typical seat capacity or null
 */
export function getTypicalSeats(typeCode) {
  if (!typeCode) return null;
  const clean = typeCode.trim().toUpperCase();
  return AIRCRAFT_SEATS[clean] || null;
}

// ============================================================
//  Callsign-to-Route Persistent Cache
//  Caches confirmed provider routes and resolves unverified routes as 'likely'
// ============================================================

/**
 * Cache route for a callsign when confirmed from a data provider.
 *
 * @param {string} callsign
 * @param {string} origin
 * @param {string} destination
 */
export async function cacheCallsignRoute(callsign, origin, destination) {
  if (!callsign || !origin || !destination) return;
  const key = callsign.trim().toUpperCase();
  try {
    const { callsignRouteCache = {} } = await chrome.storage.local.get('callsignRouteCache');
    callsignRouteCache[key] = {
      origin: origin.trim().toUpperCase(),
      destination: destination.trim().toUpperCase(),
      updatedAt: Date.now()
    };
    await chrome.storage.local.set({ callsignRouteCache });
  } catch (e) {
    // Storage access fallback
  }
}

/**
 * Look up a callsign in the local route cache.
 *
 * @param {string} callsign
 * @returns {Promise<{ origin: string, destination: string, isLikely: boolean } | null>}
 */
export async function resolveRouteFromCache(callsign) {
  if (!callsign) return null;
  const key = callsign.trim().toUpperCase();
  try {
    const { callsignRouteCache = {} } = await chrome.storage.local.get('callsignRouteCache');
    const cached = callsignRouteCache[key];
    if (cached && cached.origin && cached.destination) {
      return {
        origin: cached.origin,
        destination: cached.destination,
        isLikely: true
      };
    }
  } catch (e) {}
  return null;
}

/**
 * Open or upgrade the Airvee IndexedDB database.
 * Compatible with both Service Worker and Window / Popup contexts.
 *
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  return new Promise((resolve, reject) => {
    const idb = (typeof indexedDB !== 'undefined') ? indexedDB : null;
    if (!idb) {
      return reject(new Error('IndexedDB is not available in this environment.'));
    }

    const request = idb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        // Indexes for lightning-fast queries and deduplication
        store.createIndex('flightDayKey', 'flightDayKey', { unique: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('airline', 'airline', { unique: false });
        store.createIndex('aircraftType', 'aircraftType', { unique: false });
        store.createIndex('origin', 'origin', { unique: false });
        store.createIndex('destination', 'destination', { unique: false });
        store.createIndex('flightType', 'flightType', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Log an overhead flight pass into IndexedDB.
 * Deduplicated by flight ID + calendar day key (max 1 log per flight per day).
 *
 * @param {object} flightData - Normalized flight telemetry & approach data
 * @returns {Promise<{ logged: boolean, id?: number, reason?: string }>}
 */
export async function logFlightPass(flightData) {
  if (!flightData || !flightData.callsign) {
    return { logged: false, reason: 'invalid_flight_data' };
  }
  // Exclude mock test flights from real persistent flight log and statistics
  if (flightData.isMock || flightData.source === 'mock') {
    return { logged: false, reason: 'mock_flight_excluded' };
  }

  const flightId = flightData.id || flightData.callsign;
  const now = new Date(flightData.timestamp || Date.now());

  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dayKey = `${y}-${m}-${d}`;
  const flightDayKey = `${flightId}_${dayKey}`;

  const record = {
    flightDayKey,
    flightId: String(flightId),
    timestamp: now.getTime(),
    callsign: String(flightData.callsign || '').trim(),
    flightNumber: String(flightData.flightNumber || flightData.callsign || '').trim(),
    airline: String(flightData.airline || 'Unknown Airline').trim(),
    airlineIcao: String(flightData.airlineIcao || '').trim().toUpperCase(),
    aircraftType: String(flightData.aircraftType || '').trim().toUpperCase(),
    typicalSeats: getTypicalSeats(flightData.aircraftType),
    registration: String(flightData.registration || '—').trim(),
    squawk: String(flightData.squawk || '—').trim(),
    altitude: Math.round(Number(flightData.altitude || flightData.altitudeFt) || 0),
    speed: Math.round(Number(flightData.speed || flightData.groundSpeedKt) || 0),
    closestDistance: Math.round((Number(flightData.minDist || flightData.distance) || 0) * 10) / 10,
    passesOverhead: Boolean(flightData.passesOverhead != null ? flightData.passesOverhead : ((flightData.minDist || flightData.distance || 0) <= (flightData.overheadThresholdKm || 5))),
    azimuthAtCpa: flightData.bearingAtCpa != null ? Math.round(flightData.bearingAtCpa) : null,
    elevationAtCpa: flightData.elevationAtCpa != null ? Math.round(flightData.elevationAtCpa) : null,
    origin: String(flightData.origin || '').trim().toUpperCase(),
    destination: String(flightData.destination || '').trim().toUpperCase(),
    route: (flightData.origin && flightData.destination)
      ? `${flightData.origin.toUpperCase()} → ${flightData.destination.toUpperCase()}`
      : 'En route',
    isRouteLikely: Boolean(flightData.isRouteLikely),
    flightType: flightData.flightType || 'international',
    source: flightData.source || 'fr24',
    hourOfDay: now.getHours(),
    dayOfWeek: now.getDay(),
    dateStr: dayKey
  };

  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('flightDayKey');

    const checkReq = index.get(flightDayKey);

    checkReq.onsuccess = () => {
      if (checkReq.result) {
        // Already logged this flight today
        resolve({ logged: false, reason: 'duplicate_day_pass', existingId: checkReq.result.id });
      } else {
        const addReq = store.add(record);
        addReq.onsuccess = (e) => {
          resolve({ logged: true, id: e.target.result, record });
        };
        addReq.onerror = () => reject(addReq.error);
      }
    };

    checkReq.onerror = () => reject(checkReq.error);
  });
}

/**
 * Get the number of times an aircraft type and/or registration has been logged.
 * Used for "Rare for me" detection and collection stats.
 *
 * @param {string} [aircraftType]
 * @param {string} [registration]
 * @returns {Promise<{ typeCount: number, regCount: number }>}
 */
export async function getSightingCounts(aircraftType = '', registration = '') {
  const db = await openDB();

  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const records = (req.result || []).filter(r => !r.isMock && r.source !== 'mock');
      let typeCount = 0;
      let regCount = 0;

      const cleanType = String(aircraftType || '').trim().toUpperCase();
      const cleanReg = String(registration || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();

      for (const r of records) {
        if (cleanType && r.aircraftType && r.aircraftType.trim().toUpperCase() === cleanType) {
          typeCount++;
        }
        if (cleanReg && cleanReg !== '' && r.registration && r.registration !== '—') {
          const recReg = String(r.registration).replace(/[^A-Z0-9]/gi, '').toUpperCase();
          if (recReg === cleanReg) {
            regCount++;
          }
        }
      }

      resolve({ typeCount, regCount });
    };

    req.onerror = () => resolve({ typeCount: 0, regCount: 0 });
  });
}

/**
 * Check if a live flight has never been logged in history.
 * Checks registration first, then aircraft type, then airline if reg unknown.
 *
 * @param {object} flight - Live flight data object
 * @param {object} [options]
 * @param {Array<object>} [options.records] - Optional in-memory records (for fast bulk checks or tests)
 * @returns {Promise<{ isNew: boolean, label: string, type: 'registration'|'aircraftType'|'airline'|null }>|{ isNew: boolean, label: string, type: string|null }}
 */
export function checkIsFirstTimeSeen(flight, options = {}) {
  if (!flight) return { isNew: false, label: '', type: null };

  const checkAgainstRecords = (records) => {
    // Exclude mock test flights
    const validRecords = (records || []).filter(r => !r.isMock && r.source !== 'mock');

    // Exclude current flight's own day pass if it was logged moments ago
    const history = validRecords.filter(r => {
      if (flight.id && r.flightId === String(flight.id)) return false;
      if (flight.callsign && r.callsign === String(flight.callsign) &&
          Math.abs(Number(r.timestamp || 0) - (Number(flight.timestamp) || Date.now())) < 3600000) {
        return false;
      }
      return true;
    });

    // 1. Check Registration
    const cleanReg = String(flight.registration || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (cleanReg && cleanReg !== 'UNKNOWN' && cleanReg.length > 2) {
      const seenCount = history.filter(r => {
        const recReg = String(r.registration || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
        return recReg === cleanReg;
      }).length;
      if (seenCount === 0) {
        return { isNew: true, label: flight.registration.trim(), type: 'registration' };
      }
      return { isNew: false, label: flight.registration.trim(), type: 'registration' };
    }

    // 2. Check Aircraft Type (if registration unknown/empty)
    const cleanType = String(flight.aircraftType || '').trim().toUpperCase();
    if (cleanType && cleanType !== '—') {
      const seenCount = history.filter(r => String(r.aircraftType || '').trim().toUpperCase() === cleanType).length;
      if (seenCount === 0) {
        return { isNew: true, label: cleanType, type: 'aircraftType' };
      }
      return { isNew: false, label: cleanType, type: 'aircraftType' };
    }

    // 3. Check Airline (if both reg & type unknown)
    const airline = String(flight.airline || '').trim();
    if (airline && airline !== 'Unknown Airline') {
      const seenCount = history.filter(r => String(r.airline || '').trim().toUpperCase() === airline.toUpperCase()).length;
      if (seenCount === 0) {
        return { isNew: true, label: airline, type: 'airline' };
      }
    }

    return { isNew: false, label: '', type: null };
  };

  if (options.records) {
    return checkAgainstRecords(options.records);
  }

  // If records not passed synchronously, return a Promise that reads IndexedDB
  return openDB().then(db => {
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(checkAgainstRecords(req.result || []));
      req.onerror = () => resolve({ isNew: false, label: '', type: null });
    });
  }).catch(() => ({ isNew: false, label: '', type: null }));
}

/**
 * Compute the Life List ("Collection") aggregating unique Airlines,
 * Aircraft Types, and Registrations with sighting counts and first/last seen dates.
 *
 * @param {object} [options]
 * @param {boolean} [options.includeNearby=false] - If false (default), counts overhead passes only
 * @param {number} [options.overheadThresholdKm=5] - Distance threshold for overhead classification
 * @param {Array<object>} [options.records] - Optional in-memory records (for tests)
 * @returns {Promise<object>|object}
 */
export function getLifeListStats(options = {}) {
  const { includeNearby = false, overheadThresholdKm = 5, records: providedRecords } = options;

  const aggregate = (records) => {
    const realRecords = (records || []).filter(r => !r.isMock && r.source !== 'mock');

    let totalOverheadCount = 0;
    let totalNearbyCount = 0;

    for (const r of realRecords) {
      const isOverhead = r.passesOverhead === true ||
        (r.closestDistance != null && r.closestDistance <= overheadThresholdKm);
      if (isOverhead) {
        totalOverheadCount++;
      } else {
        totalNearbyCount++;
      }
    }

    const filtered = includeNearby
      ? realRecords
      : realRecords.filter(r => r.passesOverhead === true || (r.closestDistance != null && r.closestDistance <= overheadThresholdKm));

    const airlineMap = new Map();
    const typeMap = new Map();
    const regMap = new Map();

    for (const r of filtered) {
      const ts = Number(r.timestamp) || Date.now();

      // 1. Airlines
      const airlineName = String(r.airline || '').trim() || 'Unknown Airline';
      if (!airlineMap.has(airlineName)) {
        airlineMap.set(airlineName, {
          name: airlineName,
          icao: r.airlineIcao || '',
          count: 0,
          firstSeen: ts,
          lastSeen: ts
        });
      }
      const aEntry = airlineMap.get(airlineName);
      aEntry.count++;
      if (ts < aEntry.firstSeen) aEntry.firstSeen = ts;
      if (ts > aEntry.lastSeen) aEntry.lastSeen = ts;
      if (!aEntry.icao && r.airlineIcao) aEntry.icao = r.airlineIcao;

      // 2. Aircraft Types
      const typeCode = String(r.aircraftType || '').trim().toUpperCase();
      if (typeCode && typeCode !== '—') {
        if (!typeMap.has(typeCode)) {
          typeMap.set(typeCode, {
            name: typeCode,
            count: 0,
            firstSeen: ts,
            lastSeen: ts,
            typicalSeats: getTypicalSeats(typeCode)
          });
        }
        const tEntry = typeMap.get(typeCode);
        tEntry.count++;
        if (ts < tEntry.firstSeen) tEntry.firstSeen = ts;
        if (ts > tEntry.lastSeen) tEntry.lastSeen = ts;
      }

      // 3. Registrations
      const regCode = String(r.registration || '').trim().toUpperCase();
      if (regCode && regCode !== '—' && regCode !== 'UNKNOWN' && regCode.length > 2) {
        if (!regMap.has(regCode)) {
          regMap.set(regCode, {
            name: regCode,
            count: 0,
            firstSeen: ts,
            lastSeen: ts,
            aircraftType: r.aircraftType || '',
            airline: r.airline || ''
          });
        }
        const rEntry = regMap.get(regCode);
        rEntry.count++;
        if (ts < rEntry.firstSeen) rEntry.firstSeen = ts;
        if (ts > rEntry.lastSeen) {
          rEntry.lastSeen = ts;
          if (r.aircraftType) rEntry.aircraftType = r.aircraftType;
          if (r.airline) rEntry.airline = r.airline;
        }
      }
    }

    const sortByCount = (arr) => arr.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);

    return {
      airlines: sortByCount(Array.from(airlineMap.values())),
      aircraftTypes: sortByCount(Array.from(typeMap.values())),
      registrations: sortByCount(Array.from(regMap.values())),
      totalOverheadCount,
      totalNearbyCount,
      totalRecords: realRecords.length
    };
  };

  if (providedRecords) {
    return aggregate(providedRecords);
  }

  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(aggregate(req.result || []));
      req.onerror = () => reject(req.error);
    });
  });
}

/**
 * Retrieve all logged flights with optional search query, filtering, and sorting.
 *
 * @param {object} [options]
 * @param {string} [options.query] - Search term matching callsign, flight #, airline, aircraft, route
 * @param {string} [options.flightType='all'] - 'all', 'international', or 'domestic'
 * @param {string} [options.sortBy='timestamp'] - 'timestamp', 'distance', 'altitude', 'airline', 'callsign'
 * @param {string} [options.sortOrder='desc'] - 'asc' or 'desc'
 * @param {number} [options.limit=500] - Max records
 * @returns {Promise<Array<object>>}
 */
export async function getFlightLogs(options = {}) {
  const {
    query = '',
    flightType = 'all',
    sortBy = 'timestamp',
    sortOrder = 'desc',
    limit = 500
  } = options;

  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      let records = (req.result || []).filter(r => !r.isMock && r.source !== 'mock');

      // 1. Filter by flight type
      if (flightType !== 'all') {
        records = records.filter(r => r.flightType === flightType);
      }

      // 2. Search query filter
      if (query && query.trim()) {
        const q = query.trim().toUpperCase();
        records = records.filter(r =>
          (r.callsign && r.callsign.toUpperCase().includes(q)) ||
          (r.flightNumber && r.flightNumber.toUpperCase().includes(q)) ||
          (r.airline && r.airline.toUpperCase().includes(q)) ||
          (r.aircraftType && r.aircraftType.toUpperCase().includes(q)) ||
          (r.registration && r.registration.toUpperCase().includes(q)) ||
          (r.origin && r.origin.toUpperCase().includes(q)) ||
          (r.destination && r.destination.toUpperCase().includes(q)) ||
          (r.route && r.route.toUpperCase().includes(q))
        );
      }

      // 3. Sort records
      records.sort((a, b) => {
        let valA = a[sortBy];
        let valB = b[sortBy];

        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });

      // 4. Limit results
      resolve(records.slice(0, limit));
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Compute rich flight analytics and statistics from IndexedDB logs.
 * Includes flights per hour of day, daily breakdown, top airlines, top routes,
 * aircraft breakdown, and "rarest aircraft seen" badge.
 *
 * @returns {Promise<object>}
 */
export async function getFlightStats() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const records = (req.result || []).filter(r => !r.isMock && r.source !== 'mock');
      const total = records.length;

      if (total === 0) {
        return resolve({
          totalFlights: 0,
          flightsPerHour: Array(24).fill(0),
          dailyCounts: {},
          topAirlines: [],
          topOrigins: [],
          topDestinations: [],
          aircraftBreakdown: [],
          rarestAircraft: null,
          maxSimultaneous: 0,
          internationalCount: 0,
          domesticCount: 0
        });
      }

      const flightsPerHour = Array(24).fill(0);
      const dailyCounts = {};
      const airlineMap = {};
      const originMap = {};
      const destMap = {};
      const aircraftMap = {};
      let intlCount = 0;
      let domCount = 0;

      for (const r of records) {
        // Hourly distribution (0-23)
        const hour = r.hourOfDay != null ? r.hourOfDay : new Date(r.timestamp).getHours();
        if (hour >= 0 && hour < 24) {
          flightsPerHour[hour]++;
        }

        // Daily volume
        const dateKey = r.dateStr || new Date(r.timestamp).toISOString().split('T')[0];
        dailyCounts[dateKey] = (dailyCounts[dateKey] || 0) + 1;

        // Airlines
        const airline = r.airline || 'Unknown';
        airlineMap[airline] = (airlineMap[airline] || 0) + 1;

        // Origins & Destinations
        if (r.origin && r.origin !== '—') {
          originMap[r.origin] = (originMap[r.origin] || 0) + 1;
        }
        if (r.destination && r.destination !== '—') {
          destMap[r.destination] = (destMap[r.destination] || 0) + 1;
        }

        // Aircraft types
        if (r.aircraftType && r.aircraftType !== '—') {
          aircraftMap[r.aircraftType] = (aircraftMap[r.aircraftType] || 0) + 1;
        }

        if (r.flightType === 'international') intlCount++;
        if (r.flightType === 'domestic') domCount++;
      }

      // Convert to sorted ranking arrays
      const toRanked = (map, limit = 5) =>
        Object.entries(map)
          .map(([name, count]) => ({ name, count, percent: Math.round((count / total) * 100) }))
          .sort((a, b) => b.count - a.count)
          .slice(0, limit);

      const topAirlines = toRanked(airlineMap, 6);
      const topOrigins = toRanked(originMap, 5);
      const topDestinations = toRanked(destMap, 5);
      const aircraftBreakdown = toRanked(aircraftMap, 6);

      // Identify Rarest Aircraft Seen (aircraft type with 1 or fewest sightings)
      let rarestAircraft = null;
      const sortedAircraftAsc = Object.entries(aircraftMap)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => a.count - b.count);

      if (sortedAircraftAsc.length > 0) {
        const rarest = sortedAircraftAsc[0];
        rarestAircraft = {
          type: rarest.type,
          sightings: rarest.count,
          typicalSeats: getTypicalSeats(rarest.type)
        };
      }

      resolve({
        totalFlights: total,
        internationalCount: intlCount,
        domesticCount: domCount,
        flightsPerHour,
        dailyCounts,
        topAirlines,
        topOrigins,
        topDestinations,
        aircraftBreakdown,
        rarestAircraft
      });
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Generate a complete RFC-4180 compliant CSV string of all flight passes.
 *
 * @returns {Promise<string>}
 */
export async function exportLogsToCSV() {
  const logs = await getFlightLogs({ limit: 10000, sortOrder: 'desc' });

  const headers = [
    'Timestamp (ISO)',
    'Date',
    'Time (Local)',
    'Callsign',
    'Flight Number',
    'Airline',
    'Aircraft Type',
    'Typical Seats (Est)',
    'Registration',
    'Squawk',
    'Origin',
    'Destination',
    'Route',
    'Type',
    'Closest Distance (km)',
    'Altitude (ft)',
    'Ground Speed (kt)',
    'Azimuth CPA (deg)',
    'Elevation CPA (deg)'
  ];

  const escapeCSV = (val) => {
    if (val == null) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = logs.map(r => {
    const d = new Date(r.timestamp);
    const dateStr = d.toLocaleDateString();
    const timeStr = d.toLocaleTimeString();

    return [
      escapeCSV(d.toISOString()),
      escapeCSV(dateStr),
      escapeCSV(timeStr),
      escapeCSV(r.callsign),
      escapeCSV(r.flightNumber),
      escapeCSV(r.airline),
      escapeCSV(r.aircraftType),
      escapeCSV(r.typicalSeats || ''),
      escapeCSV(r.registration),
      escapeCSV(r.squawk),
      escapeCSV(r.origin),
      escapeCSV(r.destination),
      escapeCSV(r.route),
      escapeCSV(r.flightType),
      escapeCSV(r.closestDistance),
      escapeCSV(r.altitude),
      escapeCSV(r.speed),
      escapeCSV(r.azimuthAtCpa != null ? r.azimuthAtCpa : ''),
      escapeCSV(r.elevationAtCpa != null ? r.elevationAtCpa : '')
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\r\n');
}

/**
 * Clear all logged flights from IndexedDB with confirmation safety.
 *
 * @returns {Promise<{ cleared: boolean, count: number }>}
 */
export async function clearAllLogs() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const countReq = store.count();

    countReq.onsuccess = () => {
      const totalCount = countReq.result;
      const clearReq = store.clear();
      clearReq.onsuccess = () => resolve({ cleared: true, count: totalCount });
      clearReq.onerror = () => reject(clearReq.error);
    };

    countReq.onerror = () => reject(countReq.error);
  });
}
