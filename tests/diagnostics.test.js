import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DIAGNOSTICS_POLLS,
  appendPollToRingBuffer,
  buildAircraftDiagnosticRecord,
  verifyRedaction
} from '../lib/diagnostics.js';

test('Diagnostics: Buffer limit caps strictly at MAX_DIAGNOSTICS_POLLS (200)', () => {
  let buffer = [];
  for (let i = 0; i < 250; i++) {
    buffer = appendPollToRingBuffer(buffer, {
      pollTime: 1000 + i,
      aircraftCount: 1,
      aircraft: [{ callsign: `FLT${i}` }]
    });
  }

  assert.equal(buffer.length, MAX_DIAGNOSTICS_POLLS, `Buffer length must equal ${MAX_DIAGNOSTICS_POLLS}`);
  // Oldest items (0-49) dropped; buffer starts at 50
  assert.equal(buffer[0].pollTime, 1050);
  assert.equal(buffer[buffer.length - 1].pollTime, 1249);
});

test('Diagnostics: Redaction verification passes when no absolute coordinates exist', () => {
  const safeRecord = buildAircraftDiagnosticRecord({
    flight: {
      callsign: 'AIC808',
      airline: 'Air India',
      aircraftType: 'A320',
      altitudeFt: 32000,
      groundSpeedKt: 440,
      trackDeg: 180,
      verticalRateFpm: 0,
      timestamp: Math.floor(Date.now() / 1000) - 10
    },
    cpa: {
      currentDistanceKm: 12.4,
      currentBearing: 215,
      dCpa: 4.2,
      tCpa: 85
    },
    passClass: 'overhead',
    classificationResult: { flightType: 'domestic', rule: 'both_indian_airports' },
    droppedReason: null
  });

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    pollCyclesCount: 1,
    polls: [{ pollTime: Date.now(), aircraftCount: 1, aircraft: [safeRecord] }]
  };

  assert.equal(verifyRedaction(exportPayload), true, 'Payload without lat/lon must pass redaction check');
  assert.equal('lat' in safeRecord, false, 'lat must not be present');
  assert.equal('lon' in safeRecord, false, 'lon must not be present');
  assert.equal('latitude' in safeRecord, false, 'latitude must not be present');
  assert.equal('longitude' in safeRecord, false, 'longitude must not be present');
});

test('Diagnostics: Redaction verification fails if absolute coordinates leak into payload', () => {
  const unsafePayload = {
    polls: [
      {
        aircraft: [
          {
            callsign: 'UAE504',
            latitude: 21.1458, // LEAK
            longitude: 79.0882
          }
        ]
      }
    ]
  };

  assert.equal(verifyRedaction(unsafePayload), false, 'Payload containing latitude must fail redaction check');
});

test('Diagnostics: Recording gate allows only real provider polls with diagnosticsEnabled', () => {
  function shouldRecordDiagnostics(settings) {
    return Boolean(settings?.diagnosticsEnabled && !settings?.mockProviderEnabled);
  }

  // Mock enabled - NEVER recorded
  assert.equal(shouldRecordDiagnostics({ diagnosticsEnabled: true, mockProviderEnabled: true }), false);
  assert.equal(shouldRecordDiagnostics({ diagnosticsEnabled: false, mockProviderEnabled: true }), false);

  // Diagnostics disabled - NOT recorded
  assert.equal(shouldRecordDiagnostics({ diagnosticsEnabled: false, mockProviderEnabled: false }), false);

  // Real provider with diagnostics enabled - RECORDED
  assert.equal(shouldRecordDiagnostics({ diagnosticsEnabled: true, mockProviderEnabled: false }), true);
});

test('Diagnostics: Summary totals match individual aircraft records accurately', async () => {
  const { generateDiagnosticsSummary, calculateMedianAndP90 } = await import('../lib/diagnostics.js');

  const nowMs = 1700000000000;
  const poll1 = {
    pollTime: nowMs,
    provider: 'fr24',
    rawAircraftCount: 5,
    detectionRadiusKm: 30,
    pollingMode: 'normal',
    aircraftCount: 5,
    aircraft: [
      // 1. Domestic, Indian airline, valid route, recent data (30s), distance 4 km (0-5 km bucket), alertRule drop (outbound)
      buildAircraftDiagnosticRecord({
        flight: { callsign: 'AIC101', airline: 'Air India', aircraftType: 'A320', origin: 'DEL', destination: 'BOM', timestamp: 1700000000 - 30 },
        cpa: { currentDistanceKm: 4.2, currentBearing: 90, dCpa: 2, tCpa: 45 },
        passClass: 'near',
        classificationResult: { flightType: 'domestic', rule: 'both_indian_airports' },
        droppedReason: 'alertRule',
        pollTimeMs: nowMs
      }),
      // 2. International, foreign airline, dataAge 120s (> 60s), distance 12 km (5-15 km), dropped by flightFilter
      buildAircraftDiagnosticRecord({
        flight: { callsign: 'UAE504', airline: 'Emirates', aircraftType: 'A388', origin: 'DXB', destination: 'BOM', timestamp: 1700000000 - 120 },
        cpa: { currentDistanceKm: 12.0, currentBearing: 180, dCpa: 10, tCpa: 60 },
        passClass: 'near',
        classificationResult: { flightType: 'international', rule: 'intl_destination' },
        droppedReason: 'flightFilter',
        pollTimeMs: nowMs
      }),
      // 3. Unknown flightType, missing route and type, dataAge unavailable (null), distance 25 km (15-30 km), dropped by minElevation
      buildAircraftDiagnosticRecord({
        flight: { callsign: 'UNK01', airline: 'CharterX', timestamp: null },
        cpa: { currentDistanceKm: 25.5, currentBearing: 45, dCpa: 5, tCpa: 30 },
        passClass: 'near',
        classificationResult: { flightType: 'unknown', rule: 'no_route' },
        droppedReason: 'minElevation',
        pollTimeMs: nowMs
      }),
      // 4. International, distance 35 km (30-45 km), outside detection radius (30 km), dropped by other
      buildAircraftDiagnosticRecord({
        flight: { callsign: 'SIA308', airline: 'Singapore Airlines', aircraftType: 'A359', origin: 'SIN', destination: 'LHR', timestamp: 1700000000 - 200 },
        cpa: { currentDistanceKm: 35.0, currentBearing: 270, dCpa: 12, tCpa: 50 },
        passClass: 'near',
        classificationResult: { flightType: 'international', rule: 'both_foreign' },
        droppedReason: 'other',
        pollTimeMs: nowMs
      }),
      // 5. Domestic, distance 50 km (over 45 km), dropped by altitudeFilter
      buildAircraftDiagnosticRecord({
        flight: { callsign: 'IGO202', airline: 'IndiGo', aircraftType: 'A20N', origin: 'DEL', destination: 'BLR', timestamp: 1700000000 - 45 },
        cpa: { currentDistanceKm: 50.2, currentBearing: 15, dCpa: 20, tCpa: 70 },
        passClass: 'near',
        classificationResult: { flightType: 'domestic', rule: 'both_indian_airports' },
        droppedReason: 'altitudeFilter',
        pollTimeMs: nowMs
      })
    ]
  };

  const poll2 = {
    pollTime: nowMs + 10000,
    provider: 'fr24',
    rawAircraftCount: 1,
    detectionRadiusKm: 30,
    pollingMode: 'fast',
    aircraftCount: 1,
    aircraft: [
      // 6. Unknown flightType, same airline CharterX, dataAge 400s (> 60, > 300), distance 18 km (15-30 km), dropped by other
      buildAircraftDiagnosticRecord({
        flight: { callsign: 'UNK02', airline: 'CharterX', aircraftType: 'C172', origin: 'BOM', destination: null, timestamp: 1700000000 - 400 },
        cpa: { currentDistanceKm: 18.0, currentBearing: 200, dCpa: 8, tCpa: 40 },
        passClass: 'near',
        classificationResult: { flightType: 'unknown', rule: 'partial_route' },
        droppedReason: 'other',
        pollTimeMs: nowMs + 10000
      })
    ]
  };

  const summary = generateDiagnosticsSummary([poll1, poll2], { radiusKm: 30 });

  // Flight types
  assert.equal(summary.flightTypeTotals.domestic, 2);
  assert.equal(summary.flightTypeTotals.international, 2);
  assert.equal(summary.flightTypeTotals.unknown, 2);

  // Dropped filters (each filter category counted)
  assert.equal(summary.droppedFilterTotals.flightFilter, 1);
  assert.equal(summary.droppedFilterTotals.altitudeFilter, 1);
  assert.equal(summary.droppedFilterTotals.minElevation, 1);
  assert.equal(summary.droppedFilterTotals.alertRule, 1);
  assert.equal(summary.droppedFilterTotals.other, 2);

  // Missing fields
  // Missing origin: UNK01 (1)
  assert.equal(summary.missingFields.noOrigin, 1);
  // Missing destination: UNK01, UNK02 (2)
  assert.equal(summary.missingFields.noDestination, 2);
  // Missing aircraft type: UNK01 (1)
  assert.equal(summary.missingFields.noAircraftType, 1);

  // Data age unavailable & buckets
  assert.equal(summary.dataAgeUnavailable, 1, 'UNK01 had null timestamp, so dataAgeUnavailable must be 1');
  // Valid ages: 30, 120, 200, 45, 400 -> sorted [30, 45, 120, 200, 400]
  // over60s: 3 (120, 200, 400)
  // over300s: 1 (400)
  // over900s: 0
  assert.equal(summary.dataAgeBuckets.over60s, 3);
  assert.equal(summary.dataAgeBuckets.over300s, 1);
  assert.equal(summary.dataAgeBuckets.over900s, 0);

  // Median and P90 of [30, 45, 120, 200, 410]
  // mid index 2: 120
  // p90 index floor(5 * 0.9) = 4: 410
  assert.equal(summary.dataAgeMedian, 120);
  assert.equal(summary.dataAgeP90, 410);

  // Distance buckets
  // 0-5 km: AIC101 (4.2 km) = 1
  // 5-15 km: UAE504 (12.0 km) = 1
  // 15-30 km: UNK01 (25.5 km), UNK02 (18.0 km) = 2
  // 30-45 km: SIA308 (35.0 km) = 1
  // over45 km: IGO202 (50.2 km) = 1
  assert.equal(summary.distanceBuckets['0_5km'], 1);
  assert.equal(summary.distanceBuckets['5_15km'], 1);
  assert.equal(summary.distanceBuckets['15_30km'], 2);
  assert.equal(summary.distanceBuckets['30_45km'], 1);
  assert.equal(summary.distanceBuckets['over45km'], 1);

  // Outside detection radius (radius is 30 km):
  // SIA308 (35.0 km), IGO202 (50.2 km) -> total 2 outside
  assert.equal(summary.distanceBuckets.outsideRadiusTotal, 2);
  // Average per poll across 2 polls: 2 / 2 = 1.0
  assert.equal(summary.distanceBuckets.outsideRadiusPerPoll, 1.0);

  // Top unknown airlines: CharterX (2)
  assert.equal(summary.topUnknownAirlines.length, 1);
  assert.equal(summary.topUnknownAirlines[0].airline, 'CharterX');
  assert.equal(summary.topUnknownAirlines[0].count, 2);

  // Full export redaction check
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    pollCyclesCount: 2,
    summary,
    polls: [poll1, poll2]
  };
  assert.equal(verifyRedaction(exportPayload), true, 'Full export payload with new summary must pass redaction check');
});

test('Diagnostics: Storage pruning caps store strictly at 200 and removes legacy storage key', async () => {
  const { saveDiagnosticPoll, getDiagnosticPolls, clearDiagnosticPolls } = await import('../lib/diagnostics.js');

  // Track chrome.storage.local removals
  let removedKey = null;
  globalThis.chrome = {
    storage: {
      local: {
        remove: async (key) => { removedKey = key; }
      }
    }
  };

  await clearDiagnosticPolls();

  // Save 250 polls
  for (let i = 0; i < 250; i++) {
    await saveDiagnosticPoll({
      pollTime: 10000 + i,
      provider: 'fr24',
      rawAircraftCount: 1,
      pollingMode: 'normal',
      aircraftCount: 1,
      aircraft: [{ callsign: `FLT${i}`, distanceKm: 10 }]
    });
  }

  const storedPolls = await getDiagnosticPolls();
  assert.equal(storedPolls.length, 200, 'Pruning must keep exactly 200 polls');
  // Oldest 50 polls (10000 to 10049) pruned; buffer starts at 10050
  assert.equal(storedPolls[0].pollTime, 10050, 'Oldest polls must be pruned');
  assert.equal(storedPolls[storedPolls.length - 1].pollTime, 10249, 'Newest poll must be at the end');

  // Check one-time migration removed old key
  assert.equal(removedKey, 'diagnosticsRingBuffer', 'One-time migration must remove legacy diagnosticsRingBuffer key');
});

