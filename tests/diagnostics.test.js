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
