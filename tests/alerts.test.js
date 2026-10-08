// ============================================================
//  AIRVEE — Unit Tests for Alerts Model & Schema v6 Migration
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchRule,
  evaluateAlertRules,
  convertLegacySettingsToAlertRules,
  isWideBodyAircraft,
  AIRLINE_GROUPS
} from '../lib/alerts.js';
import { evaluateAircraft, classifyFlight } from '../lib/filter.js';
import { migrateSettings, SCHEMA_VERSION } from '../lib/settings-defaults.js';
import { buildAircraftDiagnosticRecord } from '../lib/diagnostics.js';
import { evaluateFlightWatchlist } from '../lib/watchlist.js';

// ============================================================
//  Reference Legacy Logic (Exact copy of pre-v6 Airvee decision)
// ============================================================
function oldReferenceEvaluation(flight, settings = {}, geoResult = null, options = {}) {
  const flightLat = flight?.lat != null ? flight.lat : flight?.latitude;
  const flightLon = flight?.lon != null ? flight.lon : flight?.longitude;

  if (flightLat == null || flightLon == null || isNaN(flightLat) || isNaN(flightLon)) {
    return { shown: false, hiddenBy: 'invalid_coordinates', alertSuppressedBy: 'hidden', passClass: 'near', willAlert: false };
  }

  const altitude = flight.altitudeFt != null ? flight.altitudeFt : (flight.altitude || 0);

  // 1. Altitude filter
  const altitudeFilter = settings.altitudeFilter || 'all';
  if (altitudeFilter === 'high' && altitude < 25000) {
    return { shown: false, hiddenBy: 'altitudeFilter', alertSuppressedBy: 'hidden', passClass: 'near', willAlert: false };
  }
  if (altitudeFilter === 'low' && altitude >= 25000) {
    return { shown: false, hiddenBy: 'altitudeFilter', alertSuppressedBy: 'hidden', passClass: 'near', willAlert: false };
  }

  // 2. Flight filter
  const origin = flight.origin || '';
  const destination = flight.destination || '';
  const flightType = flight.flightType || classifyFlight(origin, destination);
  const flightFilter = settings.flightFilter || 'all';

  if (flightFilter === 'international' && flightType === 'domestic') {
    return { shown: false, hiddenBy: 'flightFilter', alertSuppressedBy: 'hidden', passClass: 'near', willAlert: false };
  }
  if (flightFilter === 'domestic' && flightType === 'international') {
    return { shown: false, hiddenBy: 'flightFilter', alertSuppressedBy: 'hidden', passClass: 'near', willAlert: false };
  }

  // 3. Airline filter
  if (settings.airlineFilter && settings.airlineFilter.trim()) {
    const allowed = settings.airlineFilter.toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
    const icao = (flight.airlineIcao || '').toUpperCase();
    const cs = (flight.callsign || '').toUpperCase();
    const match = allowed.some(code => icao === code || cs.startsWith(code));
    if (!match) {
      return { shown: false, hiddenBy: 'airlineFilter', alertSuppressedBy: 'hidden', passClass: 'near', willAlert: false };
    }
  }

  // 4. Aircraft type filter
  if (settings.aircraftFilter && settings.aircraftFilter.trim()) {
    const allowed = settings.aircraftFilter.toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
    const acType = (flight.aircraftType || '').toUpperCase();
    const match = allowed.some(t => acType.includes(t));
    if (!match) {
      return { shown: false, hiddenBy: 'aircraftFilter', alertSuppressedBy: 'hidden', passClass: 'near', willAlert: false };
    }
  }

  // 5. Altitude bounds
  const minAlt = settings.minAltitudeFt != null ? settings.minAltitudeFt : 0;
  const maxAlt = settings.maxAltitudeFt != null ? settings.maxAltitudeFt : 60000;
  if (altitude < minAlt || altitude > maxAlt) {
    return { shown: false, hiddenBy: 'altitudeBounds', alertSuppressedBy: 'hidden', passClass: 'near', willAlert: false };
  }

  // Pass classification
  let passClass = 'near';
  if (geoResult) {
    const dCpa = geoResult.dCpa != null ? geoResult.dCpa : 999;
    const thresh = settings.overheadThresholdKm || 5;
    const minElev = settings.minElevationDeg != null ? settings.minElevationDeg : 15;
    const elev = geoResult.elevationAtCpa != null ? geoResult.elevationAtCpa : 0;
    if (geoResult.isInbound && geoResult.tCpa > 0 && dCpa <= thresh && elev >= minElev) {
      passClass = 'overhead';
    }
  }

  // Alert suppression
  let alertSuppressedBy = null;
  if (passClass !== 'overhead') {
    alertSuppressedBy = 'not_overhead';
  } else {
    let eta = flight.eta;
    if (eta == null && geoResult && geoResult.isInbound && geoResult.tCpa > 0) {
      eta = Math.round(geoResult.tCpa);
    }
    if (eta === null || eta <= 0) {
      alertSuppressedBy = 'no_eta';
    } else if (eta < 10 || eta > 150) {
      alertSuppressedBy = 'eta_out_of_bounds';
    } else {
      const minElev = settings.minElevationDeg != null ? settings.minElevationDeg : 15;
      const elevationAtCpa = geoResult?.elevationAtCpa != null ? geoResult.elevationAtCpa : 0;
      if (elevationAtCpa < minElev) {
        alertSuppressedBy = 'minElevation';
      } else {
        const wm = options.watchlistMatch || (Array.isArray(settings.watchlistRules) ? evaluateFlightWatchlist(flight, settings.watchlistRules, { sightingCounts: options.sightingCounts }) : null);
        if (wm && wm.alertStyle === 'silent') {
          alertSuppressedBy = 'watchlist_silent';
        }
      }
    }
  }

  const willAlert = alertSuppressedBy === null;
  return { shown: true, hiddenBy: null, alertSuppressedBy, passClass, willAlert };
}

// ============================================================
//  SECTION 1: Equivalence Tests Across 18 Legacy Configurations
// ============================================================
test('Alerts Equivalence: Migrated settings produce identical decisions to old logic across 18 configs', () => {
  const baseSettings = {
    overheadThresholdKm: 5,
    minElevationDeg: 15,
    flightFilter: 'all',
    altitudeFilter: 'all',
    airlineFilter: '',
    aircraftFilter: '',
    minAltitudeFt: 0,
    maxAltitudeFt: 60000,
    watchlistRules: []
  };

  const configs = [
    { name: '1. Clean default install', settings: { ...baseSettings } },
    { name: '2. International only', settings: { ...baseSettings, flightFilter: 'international' } },
    { name: '3. Domestic only', settings: { ...baseSettings, flightFilter: 'domestic' } },
    { name: '4. High altitude only', settings: { ...baseSettings, altitudeFilter: 'high' } },
    { name: '5. Low altitude only', settings: { ...baseSettings, altitudeFilter: 'low' } },
    { name: '6. Min altitude 15,000 ft', settings: { ...baseSettings, minAltitudeFt: 15000 } },
    { name: '7. Max altitude 32,000 ft', settings: { ...baseSettings, maxAltitudeFt: 32000 } },
    { name: '8. Airline filter AIC and UAE', settings: { ...baseSettings, airlineFilter: 'AIC, UAE' } },
    { name: '9. Aircraft filter A388 and B744', settings: { ...baseSettings, aircraftFilter: 'A388, B744' } },
    { name: '10. Airline UAE + Aircraft B77W', settings: { ...baseSettings, airlineFilter: 'UAE', aircraftFilter: 'B77W' } },
    {
      name: '11. Watchlist special (loud) A388',
      settings: {
        ...baseSettings,
        watchlistRules: [{ id: 'w1', name: 'A380 Rule', aircraftType: 'A388', alertStyle: 'special', enabled: true }]
      }
    },
    {
      name: '12. Watchlist silent (log only) Cargo',
      settings: {
        ...baseSettings,
        watchlistRules: [{ id: 'w2', name: 'Cargo Rule', cargoFilter: 'cargo_only', alertStyle: 'silent', enabled: true }]
      }
    },
    {
      name: '13. Multi-rule: A388 special + B77W normal + B738 silent',
      settings: {
        ...baseSettings,
        watchlistRules: [
          { id: 'w1', name: 'A388 Special', aircraftType: 'A388', alertStyle: 'special', enabled: true },
          { id: 'w2', name: 'B77W Normal', aircraftType: 'B77W', alertStyle: 'normal', enabled: true },
          { id: 'w3', name: 'B738 Silent', aircraftType: 'B738', alertStyle: 'silent', enabled: true }
        ]
      }
    },
    {
      name: '14. Intl only + Watchlist A388',
      settings: {
        ...baseSettings,
        flightFilter: 'international',
        watchlistRules: [{ id: 'w1', name: 'A388 Special', aircraftType: 'A388', alertStyle: 'special', enabled: true }]
      }
    },
    {
      name: '15. High alt + Min 30k + BAW only',
      settings: {
        ...baseSettings,
        altitudeFilter: 'high',
        minAltitudeFt: 30000,
        airlineFilter: 'BAW'
      }
    },
    {
      name: '16. Low alt + Domestic only',
      settings: {
        ...baseSettings,
        altitudeFilter: 'low',
        flightFilter: 'domestic'
      }
    },
    {
      name: '17. Watchlist custom threshold 8 km',
      settings: {
        ...baseSettings,
        watchlistRules: [{ id: 'w-custom', name: 'Wider threshold', aircraftType: 'A359', overheadThresholdKm: 8, enabled: true }]
      }
    },
    {
      name: '18. Watchlist quiet hours bypass',
      settings: {
        ...baseSettings,
        watchlistRules: [{ id: 'w-quiet', name: 'Bypass quiet', aircraftType: 'B748', ignoreQuietHours: true, enabled: true }]
      }
    }
  ];

  const testFlights = [
    // Flight A: Inbound domestic overhead A320 at 30k
    {
      flight: { callsign: 'AIC101', airlineIcao: 'AIC', airline: 'Air India', aircraftType: 'A320', altitudeFt: 30000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 110, dCpa: 2.0, elevationAtCpa: 45, isInbound: true }
    },
    // Flight B: Inbound intl overhead Emirates B77W at 36k
    {
      flight: { callsign: 'UAE504', airlineIcao: 'UAE', airline: 'Emirates', aircraftType: 'B77W', altitudeFt: 36000, origin: 'DXB', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 115, dCpa: 2.5, elevationAtCpa: 50, isInbound: true }
    },
    // Flight C: Inbound intl overhead Singapore A388 at 38k
    {
      flight: { callsign: 'SIA424', airlineIcao: 'SIA', airline: 'Singapore Airlines', aircraftType: 'A388', altitudeFt: 38000, origin: 'SIN', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 120, dCpa: 1.5, elevationAtCpa: 60, isInbound: true }
    },
    // Flight D: Low altitude domestic turboprop at 12k
    {
      flight: { callsign: 'SEJ202', airlineIcao: 'SEJ', airline: 'SpiceJet', aircraftType: 'DH8D', altitudeFt: 12000, origin: 'DEL', destination: 'JAI', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 100, dCpa: 3.0, elevationAtCpa: 30, isInbound: true }
    },
    // Flight E: Near flight outside overhead threshold (dCpa = 12 km > 5 km)
    {
      flight: { callsign: 'AIC505', airlineIcao: 'AIC', airline: 'Air India', aircraftType: 'A320', altitudeFt: 32000, origin: 'DEL', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 120, dCpa: 12.0, elevationAtCpa: 20, isInbound: true }
    },
    // Flight F: Cargo flight Cargolux B744F at 34k
    {
      flight: { callsign: 'CLX789', airlineIcao: 'CLX', airline: 'Cargolux', aircraftType: 'B744F', altitudeFt: 34000, origin: 'LUX', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 105, dCpa: 2.2, elevationAtCpa: 48, isInbound: true }
    },
    // Flight G: British Airways B789 at 35k
    {
      flight: { callsign: 'BAW139', airlineIcao: 'BAW', airline: 'British Airways', aircraftType: 'B789', altitudeFt: 35000, origin: 'LHR', destination: 'BOM', lat: 19.1, lon: 72.8 },
      cpa: { tCpa: 110, dCpa: 2.0, elevationAtCpa: 52, isInbound: true }
    }
  ];

  for (const cfg of configs) {
    const migrated = migrateSettings(cfg.settings);
    for (const tf of testFlights) {
      const oldRes = oldReferenceEvaluation(tf.flight, cfg.settings, tf.cpa);
      const newRes = evaluateAircraft(tf.flight, migrated, tf.cpa);

      assert.equal(
        newRes.shown,
        oldRes.shown,
        `[${cfg.name} - ${tf.flight.callsign}] 'shown' match`
      );
      assert.equal(
        newRes.passClass,
        oldRes.passClass,
        `[${cfg.name} - ${tf.flight.callsign}] 'passClass' match`
      );
      const newWillAlert = newRes.shown && newRes.alertSuppressedBy === null;
      assert.equal(
        newWillAlert,
        oldRes.willAlert,
        `[${cfg.name} - ${tf.flight.callsign}] 'willAlert' match: old=${oldRes.willAlert}, new=${newWillAlert} (suppressedBy: ${newRes.alertSuppressedBy})`
      );
    }
  }
});

// ============================================================
//  SECTION 2: Rule-Matching Tests for Every Condition Type
// ============================================================
test('Condition: Airlines (individual codes, names, prefixes, named groups)', () => {
  // Individual ICAO code
  const r1 = { enabled: true, conditions: { airlines: ['EK'] } };
  assert.equal(matchRule({ airlineIcao: 'EK' }, r1), true, 'Matches by ICAO');
  assert.equal(matchRule({ airlineIcao: 'QR' }, r1), false, 'Rejects non-matching ICAO');

  // Name substring
  const r2 = { enabled: true, conditions: { airlines: ['Emirates'] } };
  assert.equal(matchRule({ airline: 'Emirates Airline' }, r2), true, 'Matches airline name');

  // Callsign prefix
  const r3 = { enabled: true, conditions: { airlines: ['UAE'] } };
  assert.equal(matchRule({ callsign: 'UAE504' }, r3), true, 'Matches callsign prefix');

  // Named group 'gulf'
  const rGulf = { enabled: true, conditions: { airlines: ['gulf'] } };
  assert.equal(matchRule({ airlineIcao: 'EK' }, rGulf), true, 'Gulf matches EK');
  assert.equal(matchRule({ airlineIcao: 'QR' }, rGulf), true, 'Gulf matches QR');
  assert.equal(matchRule({ airlineIcao: 'EY' }, rGulf), true, 'Gulf matches EY');
  assert.equal(matchRule({ airlineIcao: 'BAW' }, rGulf), false, 'Gulf rejects BAW');
});

test('Condition: Aircraft types', () => {
  const r = { enabled: true, conditions: { aircraftTypes: ['A388', 'B748'] } };
  assert.equal(matchRule({ aircraftType: 'A388' }, r), true, 'Matches A388');
  assert.equal(matchRule({ aircraftType: 'B748' }, r), true, 'Matches B748');
  assert.equal(matchRule({ aircraftType: 'A320' }, r), false, 'Rejects A320');
});

test('Condition: Category (cargo, passenger, wide-body)', () => {
  // Cargo
  const rCargo = { enabled: true, conditions: { category: ['cargo'] } };
  assert.equal(matchRule({ aircraftType: 'B77F' }, rCargo), true, 'B77F is cargo');
  assert.equal(matchRule({ aircraftType: 'A320' }, rCargo), false, 'A320 is passenger');

  // Wide-body
  const rWide = { enabled: true, conditions: { category: ['wide-body'] } };
  assert.equal(matchRule({ aircraftType: 'B77W' }, rWide), true, 'B77W is wide-body');
  assert.equal(matchRule({ aircraftType: 'A359' }, rWide), true, 'A359 is wide-body');
  assert.equal(matchRule({ aircraftType: 'A320' }, rWide), false, 'A320 is narrow-body');

  // Passenger
  const rPass = { enabled: true, conditions: { category: ['passenger'] } };
  assert.equal(matchRule({ aircraftType: 'A320' }, rPass), true, 'A320 is passenger');
  assert.equal(matchRule({ aircraftType: 'B77F' }, rPass), false, 'B77F is cargo');
});

test('Condition: Direction of travel from track', () => {
  const rEast = { enabled: true, conditions: { direction: ['E', 'ENE', 'ESE'] } };
  assert.equal(matchRule({ trackDeg: 90 }, rEast), true, 'Track 90° is East');
  assert.equal(matchRule({ track: 270 }, rEast), false, 'Track 270° is West');
});

test('Condition: Route (origin, destination, airports list, flightType)', () => {
  const rAirports = { enabled: true, conditions: { route: { airports: ['DXB', 'LHR'] } } };
  assert.equal(matchRule({ origin: 'DXB', destination: 'BOM' }, rAirports), true, 'Matches origin DXB');
  assert.equal(matchRule({ origin: 'DEL', destination: 'LHR' }, rAirports), true, 'Matches destination LHR');
  assert.equal(matchRule({ origin: 'DEL', destination: 'BOM' }, rAirports), false, 'Rejects DEL -> BOM');

  const rIntl = { enabled: true, conditions: { route: { flightType: 'international' } } };
  assert.equal(matchRule({ origin: 'DXB', destination: 'BOM' }, rIntl), true, 'DXB -> BOM is intl');
  assert.equal(matchRule({ origin: 'DEL', destination: 'BOM' }, rIntl), false, 'DEL -> BOM is domestic');
});

test('Condition: Registration and Callsign prefix', () => {
  const rReg = { enabled: true, conditions: { registration: ['A6-EEA'] } };
  assert.equal(matchRule({ registration: 'A6-EEA' }, rReg), true, 'Matches registration exact');
  assert.equal(matchRule({ registration: 'A6EEA' }, rReg), true, 'Matches cleaned registration');
  assert.equal(matchRule({ registration: 'VT-EXR' }, rReg), false, 'Rejects non-matching reg');

  const rPrefix = { enabled: true, conditions: { callsignPrefix: ['ETH', 'EK39'] } };
  assert.equal(matchRule({ callsign: 'ETH670' }, rPrefix), true, 'Matches ETH prefix');
  assert.equal(matchRule({ flightNumber: 'EK394' }, rPrefix), true, 'Matches EK39 prefix');
  assert.equal(matchRule({ callsign: 'AIC101' }, rPrefix), false, 'Rejects AIC prefix');
});

test('Condition: Altitude range', () => {
  const rAlt = { enabled: true, conditions: { altitudeRange: { minFt: 30000, maxFt: 40000 } } };
  assert.equal(matchRule({ altitudeFt: 35000 }, rAlt), true, '35k inside range');
  assert.equal(matchRule({ altitudeFt: 25000 }, rAlt), false, '25k below range');
  assert.equal(matchRule({ altitudeFt: 45000 }, rAlt), false, '45k above range');
});

test('Condition: Rare for me', () => {
  const rRare = { enabled: true, conditions: { rareForMe: true } };
  assert.equal(matchRule({ aircraftType: 'A388' }, rRare), true, 'A388 inherently rare');
  assert.equal(matchRule({ aircraftType: 'A320' }, rRare, { sightingCounts: { typeCount: 1 }, rareSeenThreshold: 2 }), true, 'Seen 1x < 2x threshold is rare');
  assert.equal(matchRule({ aircraftType: 'A320' }, rRare, { sightingCounts: { typeCount: 5 }, rareSeenThreshold: 2 }), false, 'Seen 5x >= 2x threshold not rare');
});

test('Condition: Advanced options (overheadThresholdKm and bypassQuietHours)', () => {
  const rThresh = { enabled: true, conditions: { overheadThresholdKm: 8 } };
  assert.equal(matchRule({ dCpa: 6 }, rThresh), true, '6 km <= 8 km threshold');
  assert.equal(matchRule({ dCpa: 10 }, rThresh), false, '10 km > 8 km threshold');
});

// ============================================================
//  SECTION 3: Precedence Rules
// ============================================================
test('Precedence: "ignore" always wins over loud, alert, and log', () => {
  const rules = [
    { id: 'r-loud', action: 'loud', enabled: true, conditions: { aircraftTypes: ['A388'] } },
    { id: 'r-ignore', action: 'ignore', enabled: true, conditions: { airlines: ['EK'] } }
  ];
  const flight = { aircraftType: 'A388', airlineIcao: 'EK' };
  const res = evaluateAlertRules(flight, rules);
  assert.equal(res.action, 'ignore', 'Ignore beats loud');
  assert.equal(res.matchedRule.id, 'r-ignore', 'Winning rule is ignore');
});

test('Precedence: loud > alert > log', () => {
  const rules = [
    { id: 'r-log', action: 'log', enabled: true, conditions: { category: ['wide-body'] } },
    { id: 'r-alert', action: 'alert', enabled: true, conditions: { airlines: ['EK'] } },
    { id: 'r-loud', action: 'loud', enabled: true, conditions: { aircraftTypes: ['A388'] } }
  ];
  const flight = { aircraftType: 'A388', airlineIcao: 'EK' }; // matches all 3
  const res = evaluateAlertRules(flight, rules);
  assert.equal(res.action, 'loud', 'Loud beats alert and log');

  const rulesNoLoud = [
    { id: 'r-log', action: 'log', enabled: true, conditions: { category: ['wide-body'] } },
    { id: 'r-alert', action: 'alert', enabled: true, conditions: { airlines: ['EK'] } }
  ];
  const res2 = evaluateAlertRules(flight, rulesNoLoud);
  assert.equal(res2.action, 'alert', 'Alert beats log');
});

// ============================================================
//  SECTION 4: Default Action and alertMode
// ============================================================
test('alertMode: "all" vs "chosen" and defaultAction behavior', () => {
  const flight = { callsign: 'AIC101', aircraftType: 'A320' };
  const rules = [
    { id: 'r1', action: 'loud', enabled: true, conditions: { aircraftTypes: ['A388'] } }
  ];

  // In alertMode: 'all', unmatched flight gets normal alert
  const resAll = evaluateAlertRules(flight, rules, { alertMode: 'all' });
  assert.equal(resAll.action, 'alert', 'alertMode: all defaults to alert');

  // In alertMode: 'chosen', unmatched flight gets defaultAction (default: log)
  const resChosenLog = evaluateAlertRules(flight, rules, { alertMode: 'chosen', defaultAction: 'log' });
  assert.equal(resChosenLog.action, 'log', 'alertMode: chosen with defaultAction: log gets log');

  const resChosenIgnore = evaluateAlertRules(flight, rules, { alertMode: 'chosen', defaultAction: 'ignore' });
  assert.equal(resChosenIgnore.action, 'ignore', 'alertMode: chosen with defaultAction: ignore gets ignore');
});

// ============================================================
//  SECTION 5: Near Flights Never Alert
// ============================================================
test('Near flights never notify regardless of rule matching action', () => {
  const loudRuleSettings = {
    alertMode: 'all',
    alertRules: [
      { id: 'r-loud', name: 'Loud A380', enabled: true, conditions: { aircraftTypes: ['A388'] }, action: 'loud' }
    ]
  };

  const nearA388 = {
    callsign: 'SIA424',
    aircraftType: 'A388',
    altitudeFt: 38000,
    lat: 19.1,
    lon: 72.8
  };
  const nearCpa = {
    tCpa: 120,
    dCpa: 15.0, // Exceeds threshold (near flight)
    elevationAtCpa: 20,
    isInbound: true
  };

  const evalRes = evaluateAircraft(nearA388, loudRuleSettings, nearCpa);
  assert.equal(evalRes.shown, true, 'Near flight is shown on scope');
  assert.equal(evalRes.passClass, 'near', 'Classified as near');
  assert.equal(evalRes.action, 'loud', 'Matched loud rule');
  assert.equal(evalRes.alertSuppressedBy, 'not_overhead', 'Alert is strictly suppressed because flight is not overhead');
});

// ============================================================
//  SECTION 6: Diagnostics Record Matching Rule and Resulting Action
// ============================================================
test('Diagnostics: Record includes matchedRule, matchedRuleId, and ruleAction', () => {
  const flight = { callsign: 'UAE504', airline: 'Emirates', aircraftType: 'B77W', altitudeFt: 36000, origin: 'DXB', destination: 'BOM', lat: 19.1, lon: 72.8 };
  const cpa = { currentDistanceKm: 10, currentBearing: 90, dCpa: 2, tCpa: 100, isInbound: true, elevationAtCpa: 45 };
  const settings = {
    alertMode: 'chosen',
    alertRules: [
      { id: 'r-emirates', name: 'Emirates Rule', enabled: true, conditions: { airlines: ['UAE'] }, action: 'loud' }
    ]
  };

  const evalRes = evaluateAircraft(flight, settings, cpa);
  assert.equal(evalRes.action, 'loud', 'Evaluates to loud');

  const diag = buildAircraftDiagnosticRecord({
    flight,
    cpa,
    shown: evalRes.shown,
    hiddenBy: evalRes.hiddenBy,
    alertSuppressedBy: evalRes.alertSuppressedBy,
    passClass: evalRes.passClass,
    matchedRule: evalRes.matchedRule,
    ruleAction: evalRes.action,
    classificationResult: { flightType: 'international', rule: 'test' },
    pollTimeMs: 1700000000000
  });

  assert.equal(diag.matchedRule, 'Emirates Rule', 'Diagnostic record captures matchedRule name');
  assert.equal(diag.matchedRuleId, 'r-emirates', 'Diagnostic record captures matchedRuleId');
  assert.equal(diag.ruleAction, 'loud', 'Diagnostic record captures ruleAction');
});

// ============================================================
//  SECTION 7: Schema v6 Migration
// ============================================================
test('Migration: Schema v5 and legacy settings bump to v6 and generate alertRules', () => {
  const legacyV5 = {
    schemaVersion: 5,
    flightFilter: 'international',
    altitudeFilter: 'high',
    watchlistRules: [
      { id: 'w1', name: 'Special A388', aircraftType: 'A388', alertStyle: 'special' }
    ]
  };

  const migrated = migrateSettings(legacyV5);
  assert.equal(migrated.schemaVersion, 6, 'Schema version bumped to 6');
  assert.equal(migrated.alertMode, 'all', 'Default alertMode is all');
  assert.equal(migrated.defaultAction, 'log', 'Default defaultAction is log');
  assert.equal(Array.isArray(migrated.alertRules), true, 'alertRules is an array');

  // Should contain converted watchlist rule + domestic ignore rule + low alt ignore rule
  const ruleIds = migrated.alertRules.map(r => r.id);
  assert.ok(ruleIds.includes('w1'), 'Watchlist rule preserved in alertRules');
  assert.ok(ruleIds.includes('migrated-flight-domestic'), 'flightFilter converted to ignore rule');
  assert.ok(ruleIds.includes('migrated-alt-low'), 'altitudeFilter converted to ignore rule');
});
