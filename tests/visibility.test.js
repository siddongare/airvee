// ============================================================
//  AIRVEE — Visibility Hint & Solar Astronomy Unit Tests
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSunElevation,
  getSunRegime,
  percentToOktas,
  fetchCloudCover,
  classifyVisibility
} from '../lib/visibility.js';

test('Solar Astronomy: Equinox solar noon at Equator produces ~90° elevation', () => {
  // Equinox (March 20) at Equator (0, 0) at 12:00 UTC
  const equinoxNoon = new Date('2026-03-20T12:07:00Z');
  const elev = calculateSunElevation(0, 0, equinoxNoon);

  assert.ok(elev >= 88.0 && elev <= 90.0, `Expected ~90° at equinox equator solar noon, got ${elev}°`);
});

test('Solar Astronomy: Midnight at Equator produces ~ -90° elevation', () => {
  const midnight = new Date('2026-03-20T00:07:00Z');
  const elev = calculateSunElevation(0, 0, midnight);

  assert.ok(elev <= -88.0 && elev >= -90.0, `Expected ~ -90° at midnight, got ${elev}°`);
});

test('Solar Astronomy: Summer solstice at North Pole produces continuous day (~ +23.4°)', () => {
  // June 21 at North Pole (90°N, 0°E)
  const summerSolstice = new Date('2026-06-21T12:00:00Z');
  const elev = calculateSunElevation(90, 0, summerSolstice);

  assert.ok(elev >= 23.0 && elev <= 24.0, `Expected ~23.4° polar day, got ${elev}°`);
});

test('Solar Astronomy: Winter solstice at North Pole produces polar night (~ -23.4°)', () => {
  // Dec 21 at North Pole (90°N, 0°E)
  const winterSolstice = new Date('2026-12-21T12:00:00Z');
  const elev = calculateSunElevation(90, 0, winterSolstice);

  assert.ok(elev <= -23.0 && elev >= -24.0, `Expected ~ -23.4° polar night, got ${elev}°`);
});

test('Solar Astronomy: getSunRegime classifies lighting transitions accurately', () => {
  assert.equal(getSunRegime(45.0), 'day');
  assert.equal(getSunRegime(7.0), 'day');
  assert.equal(getSunRegime(3.0), 'golden_hour');
  assert.equal(getSunRegime(0.0), 'golden_hour');
  assert.equal(getSunRegime(-4.0), 'civil_twilight');
  assert.equal(getSunRegime(-9.0), 'nautical_twilight');
  assert.equal(getSunRegime(-25.0), 'night');
});

test('Visibility: Day + Clear sky produces "Clear sky · high contrast"', () => {
  const flight = { altitudeFt: 35000, elevationAtCpa: 65 };
  const res = classifyVisibility(flight, {
    sunElevation: 40,
    cloudData: { cloudCover: 5, cloudCoverLow: 0 }
  });

  assert.equal(res.hint, 'Clear sky · high contrast');
  assert.equal(res.contrast, 'high');
});

test('Visibility: Overcast (8/8) with high altitude flight produces contrail hint', () => {
  const flight = { altitudeFt: 37000, elevationAtCpa: 70 };
  const res = classifyVisibility(flight, {
    sunElevation: 25,
    cloudData: { cloudCover: 95, cloudCoverLow: 85 }
  });

  assert.ok(res.hint.includes('Overcast (8/8)'));
  assert.ok(res.hint.includes('contrail only if above cloud'));
});

test('Visibility: Night + Clear sky produces "Night · look for strobe lights"', () => {
  const flight = { altitudeFt: 32000, elevationAtCpa: 50 };
  const res = classifyVisibility(flight, {
    sunElevation: -30,
    cloudData: { cloudCover: 10 }
  });

  assert.equal(res.hint, 'Night · look for strobe lights');
  assert.equal(res.regime, 'night');
});

test('Visibility: Golden hour produces "Golden hour · belly illuminated"', () => {
  const flight = { altitudeFt: 34000, elevationAtCpa: 45 };
  const res = classifyVisibility(flight, {
    sunElevation: 3.5, // 3.5° above horizon
    cloudData: { cloudCover: 15 }
  });

  assert.equal(res.hint, 'Golden hour · belly illuminated');
  assert.equal(res.regime, 'golden_hour');
});

test('Weather Cache: fetchCloudCover caches for 30 minutes locally', async () => {
  let stored = {};
  const mockStorage = {
    get: async (k) => ({ weatherCache: stored.weatherCache }),
    set: async (obj) => { Object.assign(stored, obj); }
  };

  let fetchCallCount = 0;
  const mockFetch = async () => {
    fetchCallCount++;
    return {
      ok: true,
      json: async () => ({
        current: {
          cloud_cover: 25,
          cloud_cover_low: 10,
          cloud_cover_mid: 15,
          cloud_cover_high: 0,
          visibility: 15000
        }
      })
    };
  };

  // First fetch: hits network
  const res1 = await fetchCloudCover(21.1458, 79.0882, mockStorage, mockFetch);
  assert.equal(fetchCallCount, 1);
  assert.equal(res1.fromCache, false);
  assert.equal(res1.cloudCover, 25);

  // Second fetch 5 minutes later: served from local cache (0 new network calls)
  const res2 = await fetchCloudCover(21.1458, 79.0882, mockStorage, mockFetch);
  assert.equal(fetchCallCount, 1, 'Should NOT call fetch again within 30 min');
  assert.equal(res2.fromCache, true);
  assert.equal(res2.cloudCover, 25);
});

test('Privacy: Open-Meteo request URL uses 2 decimals (~1 km) while local sun calculation uses full precision', async () => {
  let requestedUrl = null;
  const mockFetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({
        current: { cloud_cover: 10 }
      })
    };
  };

  const highPrecisionLat = 21.1458923;
  const highPrecisionLon = 79.0882145;

  await fetchCloudCover(highPrecisionLat, highPrecisionLon, null, mockFetch);

  assert.ok(requestedUrl, 'fetch called');
  assert.ok(requestedUrl.includes('latitude=21.15'), `Expected latitude=21.15 in URL, got ${requestedUrl}`);
  assert.ok(requestedUrl.includes('longitude=79.09'), `Expected longitude=79.09 in URL, got ${requestedUrl}`);

  // Prove local sun calculation takes full-precision coordinates directly (not truncated to 2 decimals)
  const now = new Date('2026-06-21T06:00:00Z');
  const elevFull = calculateSunElevation(21.1458923, 79.0882145, now);
  const elevDifferent = calculateSunElevation(21.60, 79.09, now);
  assert.notEqual(elevFull, elevDifferent, 'Local sun calculation uses full coordinates across observer grid');
});
