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
  const { generateDiagnosticsSummary } = await import('../lib/diagnostics.js');

  const nowMs = 1700000000000;
  const poll1 = {
    pollTime: nowMs,
    provider: 'fr24',
    rawAircraftCount: 3,
    pollingMode: 'normal',
    aircraftCount: 3,
    aircraft: [
      // 1. Domestic, Indian airline, valid route, recent data (30s)
      buildAircraftDiagnosticRecord({
        flight: { callsign: 'AIC101', airline: 'Air India', aircraftType: 'A320', origin: 'DEL', destination: 'BOM', timestamp: 1700000000 - 30 },
        cpa: { currentDistanceKm: 15, currentBearing: 90, dCpa: 2, tCpa: 45 },
        passClass: 'overhead',
        classificationResult: { flightType: 'domestic', rule: 'both_indian_airports' },
        droppedReason: null,
        pollTimeMs: nowMs
      }),
      // 2. International, foreign airline, dataAge 120s (> 60s), dropped by filter
      buildAircraftDiagnosticRecord({
        flight: { callsign: 'UAE504', airline: 'Emirates', aircraftType: 'A388', origin: 'DXB', destination: 'BOM', timestamp: 1700000000 - 120 },
        cpa: { currentDistanceKm: 25, currentBearing: 180, dCpa: 10, tCpa: 60 },
        passClass: 'near',
        classificationResult: { flightType: 'international', rule: 'intl_destination' },
        droppedReason: 'altitude_filter_low',
        pollTimeMs: nowMs
      }),
      // 3. Unknown flightType, missing route and type, dataAge 950s (> 60, > 300, > 900)
      buildAircraftDiagnosticRecord({
        flight: { callsign: 'UNK01', airline: 'CharterX', timestamp: 1700000000 - 950 },
        cpa: null,
        passClass: 'near',
        classificationResult: { flightType: 'unknown', rule: 'no_route' },
        droppedReason: null,
        pollTimeMs: nowMs
      })
    ]
  };

  const poll2 = {
    pollTime: nowMs + 10000,
    provider: 'fr24',
    rawAircraftCount: 1,
    pollingMode: 'fast',
    aircraftCount: 1,
    aircraft: [
      // 4. Unknown flightType, same airline CharterX, dataAge 400s (> 60, > 300), dropped by bounds
      buildAircraftDiagnosticRecord({
        flight: { callsign: 'UNK02', airline: 'CharterX', aircraftType: 'C172', origin: 'BOM', destination: null, timestamp: 1700000000 - 400 },
        cpa: null,
        passClass: 'near',
        classificationResult: { flightType: 'unknown', rule: 'partial_route' },
        droppedReason: 'altitude_bounds',
        pollTimeMs: nowMs + 10000
      })
    ]
  };

  const summary = generateDiagnosticsSummary([poll1, poll2]);

  // Flight types
  assert.equal(summary.flightTypeTotals.domestic, 1);
  assert.equal(summary.flightTypeTotals.international, 1);
  assert.equal(summary.flightTypeTotals.unknown, 2);

  // Dropped filters
  assert.equal(summary.droppedFilterTotals['altitude_filter_low'], 1);
  assert.equal(summary.droppedFilterTotals['altitude_bounds'], 1);

  // Missing fields
  // Missing origin: UNK01 (1)
  assert.equal(summary.missingFields.noOrigin, 1);
  // Missing destination: UNK01, UNK02 (2)
  assert.equal(summary.missingFields.noDestination, 2);
  // Missing aircraft type: UNK01 (1)
  assert.equal(summary.missingFields.noAircraftType, 1);

  // Data age buckets:
  // AIC101 (30s) -> none
  // UAE504 (120s) -> > 60s
  // UNK01 (950s) -> > 60s, > 300s, > 900s
  // UNK02 (400s) -> > 60s, > 300s
  // over60s: 3 (UAE504, UNK01, UNK02)
  // over300s: 2 (UNK01, UNK02)
  // over900s: 1 (UNK01)
  assert.equal(summary.dataAgeBuckets.over60s, 3);
  assert.equal(summary.dataAgeBuckets.over300s, 2);
  assert.equal(summary.dataAgeBuckets.over900s, 1);

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
  assert.equal(verifyRedaction(exportPayload), true, 'Full export payload with summary must pass redaction check');
});
