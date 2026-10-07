// ============================================================
//  AIRVEE — Life List ("Collection") Unit Tests
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { getLifeListStats, checkIsFirstTimeSeen } from '../lib/db.js';

test('Life List: Aggregates unique airlines with counts and first/last seen timestamps', () => {
  const records = [
    {
      flightId: 'AIC101',
      airline: 'Air India',
      airlineIcao: 'AIC',
      aircraftType: 'B77W',
      registration: 'VT-ALQ',
      closestDistance: 2.1,
      passesOverhead: true,
      timestamp: 1700000000000
    },
    {
      flightId: 'AIC102',
      airline: 'Air India',
      airlineIcao: 'AIC',
      aircraftType: 'A359',
      registration: 'VT-JRA',
      closestDistance: 3.5,
      passesOverhead: true,
      timestamp: 1700050000000
    },
    {
      flightId: 'UAE504',
      airline: 'Emirates',
      airlineIcao: 'UAE',
      aircraftType: 'A388',
      registration: 'A6-EOH',
      closestDistance: 1.2,
      passesOverhead: true,
      timestamp: 1700020000000
    }
  ];

  const stats = getLifeListStats({ records, includeNearby: false });

  assert.equal(stats.airlines.length, 2, 'Should aggregate 2 distinct airlines');
  
  // Sorted descending by count
  assert.equal(stats.airlines[0].name, 'Air India');
  assert.equal(stats.airlines[0].count, 2);
  assert.equal(stats.airlines[0].firstSeen, 1700000000000);
  assert.equal(stats.airlines[0].lastSeen, 1700050000000);
  assert.equal(stats.airlines[0].icao, 'AIC');

  assert.equal(stats.airlines[1].name, 'Emirates');
  assert.equal(stats.airlines[1].count, 1);
  assert.equal(stats.airlines[1].firstSeen, 1700020000000);
  assert.equal(stats.airlines[1].lastSeen, 1700020000000);
  assert.equal(stats.airlines[1].icao, 'UAE');
});

test('Life List: Aggregates unique aircraft types and registrations with typical seats', () => {
  const records = [
    {
      airline: 'Emirates',
      aircraftType: 'A388',
      registration: 'A6-EOH',
      closestDistance: 2.0,
      passesOverhead: true,
      timestamp: 1700000000000
    },
    {
      airline: 'Emirates',
      aircraftType: 'A388',
      registration: 'A6-EOP',
      closestDistance: 1.8,
      passesOverhead: true,
      timestamp: 1700080000000
    },
    {
      airline: 'IndiGo',
      aircraftType: 'A20N',
      registration: 'VT-IZB',
      closestDistance: 4.2,
      passesOverhead: true,
      timestamp: 1700040000000
    }
  ];

  const stats = getLifeListStats({ records, includeNearby: false });

  // Aircraft types
  assert.equal(stats.aircraftTypes.length, 2, 'Should aggregate 2 types');
  assert.equal(stats.aircraftTypes[0].name, 'A388');
  assert.equal(stats.aircraftTypes[0].count, 2);
  assert.equal(stats.aircraftTypes[0].typicalSeats, 525, 'A388 seat estimate');
  assert.equal(stats.aircraftTypes[1].name, 'A20N');
  assert.equal(stats.aircraftTypes[1].count, 1);
  assert.equal(stats.aircraftTypes[1].typicalSeats, 180, 'A20N seat estimate');

  // Registrations
  assert.equal(stats.registrations.length, 3, 'Should aggregate 3 unique airframes');
  const regNames = stats.registrations.map(r => r.name);
  assert.ok(regNames.includes('A6-EOH'));
  assert.ok(regNames.includes('A6-EOP'));
  assert.ok(regNames.includes('VT-IZB'));
});

test('Life List: Toggle between "Overhead only" and "All nearby"', () => {
  const records = [
    {
      airline: 'British Airways',
      aircraftType: 'B77W',
      registration: 'G-STBA',
      closestDistance: 3.2,
      passesOverhead: true,
      timestamp: 1700000000000
    },
    {
      airline: 'Lufthansa',
      aircraftType: 'B748',
      registration: 'D-ABYA',
      closestDistance: 18.5,
      passesOverhead: false, // Nearby pass outside 5 km threshold
      timestamp: 1700010000000
    },
    {
      airline: 'Qatar Airways',
      aircraftType: 'A359',
      registration: 'A7-ALH',
      closestDistance: 24.0,
      passesOverhead: false,
      timestamp: 1700020000000
    }
  ];

  // 1. Default Overhead Only (threshold = 5 km)
  const overheadStats = getLifeListStats({ records, includeNearby: false, overheadThresholdKm: 5 });
  assert.equal(overheadStats.airlines.length, 1, 'Only British Airways passed overhead');
  assert.equal(overheadStats.airlines[0].name, 'British Airways');
  assert.equal(overheadStats.totalOverheadCount, 1);
  assert.equal(overheadStats.totalNearbyCount, 2);

  // 2. All Nearby Included
  const nearbyStats = getLifeListStats({ records, includeNearby: true, overheadThresholdKm: 5 });
  assert.equal(nearbyStats.airlines.length, 3, 'All 3 airlines included in nearby view');
  assert.equal(nearbyStats.registrations.length, 3);
});

test('Life List: Strictly excludes mock test flights from collection stats', () => {
  const records = [
    {
      airline: 'Real Airline',
      aircraftType: 'A320',
      registration: 'VT-REAL',
      closestDistance: 2.0,
      passesOverhead: true,
      isMock: false,
      source: 'fr24',
      timestamp: 1700000000000
    },
    {
      airline: 'Mock Simulation Airline',
      aircraftType: 'A388',
      registration: 'VT-MOCK',
      closestDistance: 1.0,
      passesOverhead: true,
      isMock: true,
      source: 'mock',
      timestamp: 1700000000000
    }
  ];

  const stats = getLifeListStats({ records, includeNearby: true });
  assert.equal(stats.airlines.length, 1, 'Mock airline must be excluded');
  assert.equal(stats.airlines[0].name, 'Real Airline');
  assert.equal(stats.aircraftTypes.length, 1);
  assert.equal(stats.aircraftTypes[0].name, 'A320');
  assert.equal(stats.registrations.length, 1);
  assert.equal(stats.registrations[0].name, 'VT-REAL');
});

test('Life List: checkIsFirstTimeSeen correctly detects never-before-logged registration', () => {
  const history = [
    {
      airline: 'Emirates',
      aircraftType: 'A388',
      registration: 'A6-EOH',
      timestamp: 1700000000000
    }
  ];

  // 1. Never seen registration on known type
  const newFlight = {
    airline: 'Emirates',
    aircraftType: 'A388',
    registration: 'A6-EOP'
  };
  const result1 = checkIsFirstTimeSeen(newFlight, { records: history });
  assert.equal(result1.isNew, true);
  assert.equal(result1.label, 'A6-EOP');
  assert.equal(result1.type, 'registration');

  // 2. Previously seen registration
  const seenFlight = {
    airline: 'Emirates',
    aircraftType: 'A388',
    registration: 'A6-EOH'
  };
  const result2 = checkIsFirstTimeSeen(seenFlight, { records: history });
  assert.equal(result2.isNew, false);
});

test('Life List: checkIsFirstTimeSeen falls back to aircraft type when registration is unknown', () => {
  const history = [
    {
      airline: 'Air India',
      aircraftType: 'A320',
      registration: 'VT-EXF',
      timestamp: 1700000000000
    }
  ];

  // Flight with no registration ('—') and never seen type B77W
  const newTypeFlight = {
    airline: 'Air India',
    aircraftType: 'B77W',
    registration: '—'
  };
  const res1 = checkIsFirstTimeSeen(newTypeFlight, { records: history });
  assert.equal(res1.isNew, true);
  assert.equal(res1.label, 'B77W');
  assert.equal(res1.type, 'aircraftType');

  // Flight with no registration ('—') and already seen type A320
  const seenTypeFlight = {
    airline: 'Air India',
    aircraftType: 'A320',
    registration: '—'
  };
  const res2 = checkIsFirstTimeSeen(seenTypeFlight, { records: history });
  assert.equal(res2.isNew, false);
});

test('Life List: checkIsFirstTimeSeen falls back to airline when both reg and type are unknown', () => {
  const history = [
    {
      airline: 'IndiGo',
      aircraftType: 'A320',
      registration: 'VT-IFH',
      timestamp: 1700000000000
    }
  ];

  // Flight with unknown reg and unknown type, but new airline
  const newAirlineFlight = {
    airline: 'Singapore Airlines',
    aircraftType: '—',
    registration: '—'
  };
  const res = checkIsFirstTimeSeen(newAirlineFlight, { records: history });
  assert.equal(res.isNew, true);
  assert.equal(res.label, 'Singapore Airlines');
  assert.equal(res.type, 'airline');
});

test('Life List: checkIsFirstTimeSeen handles flight logged moments ago in same pass', () => {
  const now = Date.now();
  const currentFlight = {
    id: 'AIC101',
    callsign: 'AIC101',
    airline: 'Air India',
    aircraftType: 'B77W',
    registration: 'VT-ALQ',
    timestamp: now
  };

  // History contains only the record that was JUST written for this current pass
  const historyJustLogged = [
    {
      flightId: 'AIC101',
      callsign: 'AIC101',
      airline: 'Air India',
      aircraftType: 'B77W',
      registration: 'VT-ALQ',
      timestamp: now - 5000 // 5 seconds ago
    }
  ];

  // It should recognise this is the maiden sighting of VT-ALQ, not already seen from a prior pass
  const res = checkIsFirstTimeSeen(currentFlight, { records: historyJustLogged });
  assert.equal(res.isNew, true, 'Current pass record should not disqualify maiden discovery');
  assert.equal(res.label, 'VT-ALQ');
});
