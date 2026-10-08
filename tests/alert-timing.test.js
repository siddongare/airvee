import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_LEAD_MIN_S,
  ALERT_LEAD_MAX_S,
  evaluateAircraft
} from '../lib/filter.js';
import { getCalendarDayKey } from '../lib/audio.js';

test('Alert Timing: Constants defined as ALERT_LEAD_MIN_S = 10 and ALERT_LEAD_MAX_S = 150', () => {
  assert.equal(ALERT_LEAD_MIN_S, 10);
  assert.equal(ALERT_LEAD_MAX_S, 150);
});

test('Alert Timing: First seen at 140s alerts immediately', () => {
  const flight = {
    id: 'flt_140',
    callsign: 'UAE140',
    airlineIcao: 'UAE',
    aircraftType: 'A388',
    altitudeFt: 35000,
    origin: 'DXB',
    destination: 'BOM',
    lat: 19.1,
    lon: 72.8
  };
  const cpa = { tCpa: 140, dCpa: 1.5, elevationAtCpa: 45, isInbound: true };
  const settings = { overheadThresholdKm: 5, minElevationDeg: 15, alertMode: 'all' };

  const evalRes = evaluateAircraft(flight, settings, cpa);
  assert.equal(evalRes.passClass, 'overhead');
  assert.equal(evalRes.alertSuppressedBy, null, '140s is within [10, 150]s, must alert');
  assert.equal(evalRes.action, 'alert');
});

test('Alert Timing: First seen at 60s alerts immediately', () => {
  const flight = {
    id: 'flt_60',
    callsign: 'ETH60',
    airlineIcao: 'ETH',
    aircraftType: 'B788',
    altitudeFt: 36000,
    origin: 'ADD',
    destination: 'BOM',
    lat: 19.1,
    lon: 72.8
  };
  const cpa = { tCpa: 60, dCpa: 2.0, elevationAtCpa: 50, isInbound: true };
  const settings = { overheadThresholdKm: 5, minElevationDeg: 15, alertMode: 'all' };

  const evalRes = evaluateAircraft(flight, settings, cpa);
  assert.equal(evalRes.passClass, 'overhead');
  assert.equal(evalRes.alertSuppressedBy, null, '60s is within [10, 150]s, must alert immediately');
  assert.equal(evalRes.action, 'alert');
});

test('Alert Timing: At 9s does not alert but qualifies for logging', () => {
  const flight = {
    id: 'flt_9',
    callsign: 'AIC09',
    airlineIcao: 'AIC',
    aircraftType: 'A320',
    altitudeFt: 28000,
    origin: 'DEL',
    destination: 'BOM',
    lat: 19.1,
    lon: 72.8
  };
  const cpa = { tCpa: 9, dCpa: 1.0, elevationAtCpa: 60, isInbound: true };
  const settings = { overheadThresholdKm: 5, minElevationDeg: 15, alertMode: 'all' };

  const evalRes = evaluateAircraft(flight, settings, cpa);
  assert.equal(evalRes.passClass, 'overhead', 'Still classified as overhead pass');
  assert.equal(evalRes.alertSuppressedBy, 'eta_out_of_bounds', 'Under 10s suppresses alert');
  assert.equal(evalRes.shown, true, 'Flight is shown and eligible for flight pass logging');
});

test('Alert Timing: At 200s waits and alerts once it reaches 150s', () => {
  const flight = {
    id: 'flt_inbound',
    callsign: 'BAW143',
    airlineIcao: 'BAW',
    aircraftType: 'B789',
    altitudeFt: 37000,
    origin: 'LHR',
    destination: 'DEL',
    lat: 28.5,
    lon: 77.1
  };
  const settings = { overheadThresholdKm: 5, minElevationDeg: 15, alertMode: 'all' };

  // Poll 1: At 200s
  const cpaPoll1 = { tCpa: 200, dCpa: 1.8, elevationAtCpa: 55, isInbound: true };
  const eval1 = evaluateAircraft(flight, settings, cpaPoll1);
  assert.equal(eval1.alertSuppressedBy, 'eta_out_of_bounds', 'Over 150s suppresses alert on first poll');

  // Poll 2: Reaches 150s
  const cpaPoll2 = { tCpa: 150, dCpa: 1.8, elevationAtCpa: 55, isInbound: true };
  const eval2 = evaluateAircraft(flight, settings, cpaPoll2);
  assert.equal(eval2.alertSuppressedBy, null, 'At 150s alert triggers immediately');
  assert.equal(eval2.action, 'alert');
});

test('Alert Timing: Deduplication ensures no duplicate alert on later polls', async () => {
  const dayKey = getCalendarDayKey();
  const notifiedDayHistory = {};

  const simulatePoll = (flightId, etaSeconds) => {
    const flight = { id: flightId, callsign: 'AIC101', altitudeFt: 30000, lat: 19.1, lon: 72.8 };
    const cpa = { tCpa: etaSeconds, dCpa: 1.5, elevationAtCpa: 50, isInbound: true };
    const evalRes = evaluateAircraft(flight, { overheadThresholdKm: 5, alertMode: 'all' }, cpa);

    if (evalRes.alertSuppressedBy !== null) {
      return { alerted: false, reason: evalRes.alertSuppressedBy };
    }

    const storageKey = `${flightId}_${dayKey}`;
    if (notifiedDayHistory[storageKey]) {
      return { alerted: false, reason: 'deduplicated' };
    }

    // Mark notified
    notifiedDayHistory[storageKey] = Date.now();
    return { alerted: true, reason: null };
  };

  // Poll 1 at 140s: alerts
  const res1 = simulatePoll('flt_dedupe', 140);
  assert.equal(res1.alerted, true, 'Alerts on poll 1');

  // Poll 2 at 110s: deduplicated
  const res2 = simulatePoll('flt_dedupe', 110);
  assert.equal(res2.alerted, false);
  assert.equal(res2.reason, 'deduplicated', 'Must not duplicate alert on poll 2');

  // Poll 3 at 60s: deduplicated
  const res3 = simulatePoll('flt_dedupe', 60);
  assert.equal(res3.alerted, false);
  assert.equal(res3.reason, 'deduplicated', 'Must not duplicate alert on poll 3');
});

test('Alert Timing: Two simultaneous overhead flights give one chime per poll (loud wins)', () => {
  const flights = [
    {
      id: 'flt_normal',
      callsign: 'AIC101',
      airlineIcao: 'AIC',
      altitudeFt: 30000,
      lat: 19.1,
      lon: 72.8,
      cpa: { tCpa: 60, dCpa: 2.0, elevationAtCpa: 45, isInbound: true }
    },
    {
      id: 'flt_loud',
      callsign: 'UAE504',
      airlineIcao: 'UAE',
      altitudeFt: 34000,
      lat: 19.1,
      lon: 72.8,
      cpa: { tCpa: 70, dCpa: 1.0, elevationAtCpa: 55, isInbound: true }
    }
  ];

  const rules = [
    {
      id: 'rule-emirates-loud',
      name: 'Emirates',
      enabled: true,
      conditions: { airlines: ['UAE'] },
      action: 'loud'
    }
  ];

  const settings = { overheadThresholdKm: 5, alertMode: 'all', alertRules: rules };

  let bestChime = null;
  const notificationsCreated = [];

  for (const f of flights) {
    const evalRes = evaluateAircraft(f, settings, f.cpa);
    assert.equal(evalRes.alertSuppressedBy, null);

    const alertStyle = evalRes.action === 'loud' ? 'special' : 'normal';
    notificationsCreated.push({ id: f.id, alertStyle });

    if (!bestChime || alertStyle === 'special') {
      bestChime = { alertStyle };
    }
  }

  // Both flights receive visual notifications
  assert.equal(notificationsCreated.length, 2);
  assert.equal(notificationsCreated[0].alertStyle, 'normal');
  assert.equal(notificationsCreated[1].alertStyle, 'special');

  // Exactly one chime played for the cycle, and 'special' (loud) takes priority
  assert.ok(bestChime !== null);
  assert.equal(bestChime.alertStyle, 'special', 'Highest priority loud chime played once per poll');
});

test('Alert Timing: Alert rules (loud, log, ignore) still apply accurately', () => {
  const settings = {
    overheadThresholdKm: 5,
    alertMode: 'chosen',
    defaultAction: 'log',
    alertRules: [
      {
        id: 'r_loud',
        name: 'Loud Emirates',
        enabled: true,
        conditions: { airlines: ['UAE'] },
        action: 'loud'
      },
      {
        id: 'r_ignore',
        name: 'Ignore Cargo',
        enabled: true,
        conditions: { category: ['cargo'] },
        action: 'ignore'
      }
    ]
  };

  const cpa = { tCpa: 60, dCpa: 1.5, elevationAtCpa: 50, isInbound: true };

  // 1. Loud rule flight
  const uae = { callsign: 'UAE504', airlineIcao: 'UAE', altitudeFt: 35000, lat: 19.1, lon: 72.8 };
  const evalLoud = evaluateAircraft(uae, settings, cpa);
  assert.equal(evalLoud.action, 'loud');
  assert.equal(evalLoud.alertSuppressedBy, null);

  // 2. Ignore rule flight
  const cargo = { callsign: 'FDX101', airlineIcao: 'FDX', aircraftType: 'B77L', altitudeFt: 32000, lat: 19.1, lon: 72.8 };
  const evalIgnore = evaluateAircraft(cargo, settings, cpa);
  assert.equal(evalIgnore.action, 'ignore');
  assert.equal(evalIgnore.shown, false);
  assert.equal(evalIgnore.alertSuppressedBy, 'hidden');

  // 3. Unmatched flight follows defaultAction 'log'
  const aic = { callsign: 'AIC101', airlineIcao: 'AIC', altitudeFt: 30000, lat: 19.1, lon: 72.8 };
  const evalLog = evaluateAircraft(aic, settings, cpa);
  assert.equal(evalLog.action, 'log');
  assert.equal(evalLog.alertSuppressedBy, 'rule_log', 'defaultAction log suppresses notification chime');
  assert.equal(evalLog.shown, true, 'Still shown in UI and eligible for logging');
});

// Mock chrome API for background.js import in Node test environment
if (!globalThis.chrome) {
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => ({})
      }
    },
    alarms: {
      get: async () => null,
      create: async () => {},
      onAlarm: { addListener: () => {} }
    },
    runtime: {
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      sendMessage: async () => {}
    },
    notifications: {
      create: async () => {},
      clear: async () => {},
      onClicked: { addListener: () => {} }
    },
    offscreen: {
      hasDocument: async () => false,
      createDocument: async () => {},
      closeDocument: async () => {}
    }
  };
}

const { formatETA, formatNotificationTitle } = await import('../background.js');

test('Notification Title: formatETA formats lead time in mm:ss (45s, 60s, 125s)', () => {
  assert.equal(formatETA(45), '00:45');
  assert.equal(formatETA(60), '01:00');
  assert.equal(formatETA(125), '02:05');
  assert.equal(formatETA(-5), '—');
  assert.equal(formatETA(null), '—');
});

test('Notification Title: Notification title formats overhead in mm:ss for 45s, 60s, and 125s', () => {
  const flight45 = {
    airline: 'Air India',
    callsign: 'AIC101',
    flightNumber: 'AI101',
    eta: 45
  };
  const title45 = formatNotificationTitle(flight45);
  assert.equal(title45, 'AIRVEE · AI · Air India AI101 · overhead in 00:45');

  const flight60 = {
    airline: 'Air India',
    callsign: 'AIC101',
    flightNumber: 'AI101',
    eta: 60
  };
  const title60 = formatNotificationTitle(flight60);
  assert.equal(title60, 'AIRVEE · AI · Air India AI101 · overhead in 01:00');

  const flight125 = {
    airline: 'Air India',
    callsign: 'AIC101',
    flightNumber: 'AI101',
    eta: 125
  };
  const title125 = formatNotificationTitle(flight125);
  assert.equal(title125, 'AIRVEE · AI · Air India AI101 · overhead in 02:05');
});

test('Notification Title: Formats with alert tag and new badge', () => {
  const flight = {
    airline: 'Emirates',
    callsign: 'UAE504',
    flightNumber: 'EK504',
    airlineIcao: 'UAE',
    eta: 45,
    isNew: true
  };
  const title = formatNotificationTitle(flight, 'LOUD');
  assert.equal(title, 'AIRVEE [LOUD · NEW] · EK · Emirates EK504 · overhead in 00:45');
});

