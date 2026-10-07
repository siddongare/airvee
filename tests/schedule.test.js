// ============================================================
//  AIRVEE — Learned Schedule & Heatmap Unit Tests
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  predictLikelyFlightsToday,
  computeHeatmapData,
  recordHeartbeat,
  formatTimeWindow
} from '../lib/schedule.js';

test('Schedule: Predicts flight when passing in ±20 min window on ≥3 of last 7 days', () => {
  // Let now be Thursday Oct 8, 2026 at 12:00 local time
  const now = new Date(2026, 9, 8, 12, 0, 0).getTime();

  // Create passes on Monday, Tuesday, Wednesday around 14:30 local time
  const records = [
    // Mon 14:25
    {
      flightNumber: 'EK504',
      airline: 'Emirates',
      aircraftType: 'A388',
      origin: 'DXB',
      destination: 'BOM',
      timestamp: new Date(2026, 9, 5, 14, 25, 0).getTime(),
      dateStr: '2026-10-05'
    },
    // Tue 14:35
    {
      flightNumber: 'EK504',
      airline: 'Emirates',
      aircraftType: 'A388',
      origin: 'DXB',
      destination: 'BOM',
      timestamp: new Date(2026, 9, 6, 14, 35, 0).getTime(),
      dateStr: '2026-10-06'
    },
    // Wed 14:30
    {
      flightNumber: 'EK504',
      airline: 'Emirates',
      aircraftType: 'A388',
      origin: 'DXB',
      destination: 'BOM',
      timestamp: new Date(2026, 9, 7, 14, 30, 0).getTime(),
      dateStr: '2026-10-07'
    }
  ];

  const predictions = predictLikelyFlightsToday(records, now);

  assert.equal(predictions.length, 1, 'Should produce 1 schedule prediction');
  const pred = predictions[0];
  assert.equal(pred.flightNumber, 'EK504');
  assert.equal(pred.airline, 'Emirates');
  assert.equal(pred.aircraftType, 'A388');
  assert.equal(pred.daysSeen, 3);
  assert.equal(pred.confidenceStr, 'Seen 3 of last 7 days');
  assert.equal(pred.hasPassedToday, false, 'Has not passed yet today (it is 12:00)');
  assert.ok(pred.windowStr.includes('14:10') || pred.windowStr.includes('14:50'), 'Window should center around 14:30');
});

test('Schedule: Rejects flight with fewer than 3 days of sightings in last 7 days', () => {
  const now = new Date('2026-10-08T12:00:00Z').getTime();

  // Only 2 days of sightings
  const records = [
    {
      flightNumber: 'AIC101',
      airline: 'Air India',
      aircraftType: 'B77W',
      timestamp: new Date('2026-10-05T10:00:00Z').getTime(),
      dateStr: '2026-10-05'
    },
    {
      flightNumber: 'AIC101',
      airline: 'Air India',
      aircraftType: 'B77W',
      timestamp: new Date('2026-10-06T10:05:00Z').getTime(),
      dateStr: '2026-10-06'
    }
  ];

  const predictions = predictLikelyFlightsToday(records, now);
  assert.equal(predictions.length, 0, 'Must have at least 3 days to qualify');
});

test('Schedule: Rejects flight with multiple passes on the same day but <3 distinct days', () => {
  const now = new Date('2026-10-08T12:00:00Z').getTime();

  // 3 passes all on the SAME day (e.g. training flight)
  const records = [
    {
      flightNumber: 'TRN01',
      airline: 'Flight School',
      aircraftType: 'C172',
      timestamp: new Date('2026-10-05T10:00:00Z').getTime(),
      dateStr: '2026-10-05'
    },
    {
      flightNumber: 'TRN01',
      airline: 'Flight School',
      aircraftType: 'C172',
      timestamp: new Date('2026-10-05T10:15:00Z').getTime(),
      dateStr: '2026-10-05'
    },
    {
      flightNumber: 'TRN01',
      airline: 'Flight School',
      aircraftType: 'C172',
      timestamp: new Date('2026-10-05T10:30:00Z').getTime(),
      dateStr: '2026-10-05'
    }
  ];

  const predictions = predictLikelyFlightsToday(records, now);
  assert.equal(predictions.length, 0, 'Multiple passes on 1 day must not count as 3 separate days');
});

test('Schedule: Detects when a predicted flight has already passed today', () => {
  // Now is 16:00 on Thursday 2026-10-08
  const now = new Date('2026-10-08T16:00:00Z').getTime();

  const records = [
    // Mon 14:30
    { flightNumber: 'BAW143', airline: 'BA', timestamp: new Date('2026-10-05T14:30:00Z').getTime(), dateStr: '2026-10-05' },
    // Tue 14:28
    { flightNumber: 'BAW143', airline: 'BA', timestamp: new Date('2026-10-06T14:28:00Z').getTime(), dateStr: '2026-10-06' },
    // Wed 14:32
    { flightNumber: 'BAW143', airline: 'BA', timestamp: new Date('2026-10-07T14:32:00Z').getTime(), dateStr: '2026-10-07' },
    // Thu 14:30 (already passed 1.5 hours ago today)
    { flightNumber: 'BAW143', airline: 'BA', timestamp: new Date('2026-10-08T14:30:00Z').getTime(), dateStr: '2026-10-08' }
  ];

  const predictions = predictLikelyFlightsToday(records, now);
  assert.equal(predictions.length, 1);
  assert.equal(predictions[0].hasPassedToday, true, 'Should mark flight as already passed today');
  assert.ok(predictions[0].passedAtStr.includes('14:30') || predictions[0].passedAtStr.length > 0);
});

test('Schedule: Strictly excludes mock test flights', () => {
  const now = new Date('2026-10-08T12:00:00Z').getTime();

  const records = [
    { flightNumber: 'MOCK1', airline: 'Sim', isMock: true, source: 'mock', timestamp: new Date('2026-10-05T14:30:00Z').getTime() },
    { flightNumber: 'MOCK1', airline: 'Sim', isMock: true, source: 'mock', timestamp: new Date('2026-10-06T14:30:00Z').getTime() },
    { flightNumber: 'MOCK1', airline: 'Sim', isMock: true, source: 'mock', timestamp: new Date('2026-10-07T14:30:00Z').getTime() }
  ];

  const predictions = predictLikelyFlightsToday(records, now);
  assert.equal(predictions.length, 0, 'Mock flights must never generate schedule predictions');
});

test('Heartbeat: Detects gaps greater than 35 minutes when browser was closed', async () => {
  let stored = {};
  const mockStorage = {
    get: async (keys) => {
      const res = {};
      for (const k of (Array.isArray(keys) ? keys : [keys])) {
        if (stored[k] !== undefined) res[k] = stored[k];
      }
      return res;
    },
    set: async (obj) => {
      Object.assign(stored, obj);
    }
  };

  const t1 = new Date('2026-10-05T23:10:00Z').getTime();
  await recordHeartbeat(t1, mockStorage);

  assert.equal(stored.lastHeartbeat, t1);
  assert.equal((stored.heartbeatGaps || []).length, 0);

  // Machine sleeps / closed until 06:45 next morning (~7.5 hours later)
  const t2 = new Date('2026-10-06T06:45:00Z').getTime();
  const res = await recordHeartbeat(t2, mockStorage);

  assert.equal(res.isGap, true);
  assert.equal(stored.heartbeatGaps.length, 1);
  assert.equal(stored.heartbeatGaps[0].start, t1);
  assert.equal(stored.heartbeatGaps[0].end, t2);
});

test('Heatmap: Computes 7x24 matrix and marks heartbeat gaps', () => {
  const now = new Date(2026, 9, 8, 12, 0, 0).getTime();

  // One pass on Wednesday 14:00 (Oct 7, 2026 is Wednesday, dayIso = 2)
  const records = [
    {
      flightNumber: 'AIC101',
      timestamp: new Date(2026, 9, 7, 14, 15, 0).getTime()
    }
  ];

  // A gap on Tuesday night from 23:10 to 06:45 Wednesday
  const heartbeatData = {
    heartbeatGaps: [
      {
        start: new Date(2026, 9, 6, 23, 10, 0).getTime(),
        end: new Date(2026, 9, 7, 6, 45, 0).getTime()
      }
    ]
  };

  const heatmap = computeHeatmapData(records, heartbeatData, now);

  assert.equal(heatmap.grid.length, 7, '7 days in week');
  assert.equal(heatmap.grid[0].length, 24, '24 hours in day');

  // Wednesday (day 2) hour 14 has count 1
  assert.equal(heatmap.grid[2][14].count, 1);

  // Wednesday (day 2) hour 03 is inside the overnight gap (23:10 to 06:45)
  assert.equal(heatmap.grid[2][3].count, 0);
  assert.equal(heatmap.grid[2][3].isGap, true, 'Cell in overnight gap must be flagged isGap');
  assert.ok(heatmap.grid[2][3].gapText.includes('No data recorded'));
});
