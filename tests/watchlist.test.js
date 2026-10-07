// ============================================================
//  AIRVEE — Watchlist & Rare Alerts Unit Tests
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isInherentlyRare,
  isCargoAircraft,
  isMilitaryAircraft,
  isRareForMe,
  matchFlightAgainstRule,
  evaluateFlightWatchlist,
  DEFAULT_INHERENTLY_RARE_TYPES
} from '../lib/watchlist.js';
import { generateSpecialChimeWavDataUri } from '../lib/audio.js';

test('Watchlist: Inherently rare aircraft types list matches recognized classics', () => {
  assert.equal(isInherentlyRare('A388'), true, 'A388 is inherently rare');
  assert.equal(isInherentlyRare('B748'), true, 'B748 is inherently rare');
  assert.equal(isInherentlyRare('A225'), true, 'A225 is inherently rare');
  assert.equal(isInherentlyRare('C17'), true, 'C17 is inherently rare');
  assert.equal(isInherentlyRare('B744'), true, 'B744 is inherently rare');

  // Common passenger aircraft are NOT inherently rare
  assert.equal(isInherentlyRare('A320'), false, 'A320 is common');
  assert.equal(isInherentlyRare('B738'), false, 'B738 is common');
  assert.equal(isInherentlyRare('A20N'), false, 'A20N is common');
});

test('Watchlist: Military vs Cargo aircraft classification strictly separates military from civilian freighters', () => {
  // Military transports are identified as military and NOT cargo
  const c17 = { aircraftType: 'C17', callsign: 'RCH311' };
  const c130 = { aircraftType: 'C130', airline: 'Royal Air Force' };
  const il76Mil = { aircraftType: 'IL76', callsign: 'IFC442' };
  const fighter = { aircraftType: 'F16', callsign: 'VIPER01' };

  assert.equal(isMilitaryAircraft(c17), true, 'C17 is military');
  assert.equal(isCargoAircraft(c17), false, 'C17 is NOT civilian cargo');

  assert.equal(isMilitaryAircraft(c130), true, 'C130 is military');
  assert.equal(isCargoAircraft(c130), false, 'C130 is NOT civilian cargo');

  assert.equal(isMilitaryAircraft(il76Mil), true, 'Indian Air Force IL76 is military');
  assert.equal(isCargoAircraft(il76Mil), false, 'Military IL76 is NOT civilian cargo');

  assert.equal(isMilitaryAircraft(fighter), true, 'F16 is military');
  assert.equal(isCargoAircraft(fighter), false, 'F16 is NOT civilian cargo');

  // Civilian freighters are identified as cargo and NOT military
  const b77f = { aircraftType: 'B77F', airlineIcao: 'FDX', callsign: 'FDX99' };
  const b744f = { aircraftType: 'B744F', airline: 'Cargolux', airlineIcao: 'CLX' };
  const ups763 = { aircraftType: 'B763F', callsign: 'UPS123' };

  assert.equal(isMilitaryAircraft(b77f), false, 'FedEx B77F is NOT military');
  assert.equal(isCargoAircraft(b77f), true, 'FedEx B77F is civilian cargo');

  assert.equal(isMilitaryAircraft(b744f), false, 'Cargolux B744F is NOT military');
  assert.equal(isCargoAircraft(b744f), true, 'Cargolux B744F is civilian cargo');

  assert.equal(isMilitaryAircraft(ups763), false, 'UPS B763F is NOT military');
  assert.equal(isCargoAircraft(ups763), true, 'UPS B763F is civilian cargo');
});

test('Watchlist: Cargo aircraft classification correctly identifies freighters', () => {
  // Variant ending with F
  assert.equal(isCargoAircraft({ aircraftType: 'B744F' }), true);
  assert.equal(isCargoAircraft({ aircraftType: 'B77F' }), true);
  assert.equal(isCargoAircraft({ aircraftType: 'A321F' }), true);
  assert.equal(isCargoAircraft({ aircraftType: 'B738BCF' }), true);

  // Dedicated cargo airline
  assert.equal(isCargoAircraft({ aircraftType: 'B77W', airlineIcao: 'FDX' }), true);
  assert.equal(isCargoAircraft({ aircraftType: 'B763', callsign: 'UPS123' }), true);
  assert.equal(isCargoAircraft({ aircraftType: 'B748', airline: 'Cargolux' }), true);

  // Standard passenger flight
  assert.equal(isCargoAircraft({ aircraftType: 'A320', airlineIcao: 'IGO', callsign: 'IGO1115' }), false);
  assert.equal(isCargoAircraft({ aircraftType: 'B77W', airlineIcao: 'UAE', callsign: 'UAE394' }), false);
});

test('Watchlist: Rare-for-me classification correctly counts sightings and respects threshold', () => {
  const commonFlight = { aircraftType: 'A320', registration: 'VT-IFP' };

  // Seen 0 times (< 2) -> Rare for me!
  assert.equal(isRareForMe(commonFlight, { typeCount: 0, regCount: 0 }, 2), true);

  // Seen 1 time (< 2) -> Rare for me!
  assert.equal(isRareForMe(commonFlight, { typeCount: 1, regCount: 1 }, 2), true);

  // Seen 2 times (>= 2) -> Not rare anymore
  assert.equal(isRareForMe(commonFlight, { typeCount: 2, regCount: 2 }, 2), false);

  // Inherently rare flight is always rare regardless of sighting count
  const a380Flight = { aircraftType: 'A388', registration: 'A6-EEA' };
  assert.equal(isRareForMe(a380Flight, { typeCount: 10, regCount: 5 }, 2), true);
});

test('Watchlist: Mock flights are strictly excluded from rare and watchlist matching', () => {
  const mockA380 = {
    aircraftType: 'A388',
    callsign: 'MOCK101',
    isMock: true,
    source: 'mock',
    distance: 2.0
  };

  // Rare check must reject mock flight
  assert.equal(isRareForMe(mockA380, { typeCount: 0, regCount: 0 }, 2), false);

  const rule = {
    id: 'r1',
    enabled: true,
    aircraftType: 'A388',
    alertStyle: 'special'
  };

  // Rule match must reject mock flight
  const match = matchFlightAgainstRule(mockA380, rule);
  assert.equal(match, null, 'Mock flights never match real watchlist rules');
});

test('Watchlist: Rule matching by aircraft type (supports comma-separated list)', () => {
  const rule = {
    id: 'r_types',
    enabled: true,
    aircraftType: 'A388, B748, B744',
    alertStyle: 'special'
  };

  const f1 = { aircraftType: 'A388', distance: 3 };
  const f2 = { aircraftType: 'B748', distance: 4 };
  const f3 = { aircraftType: 'A320', distance: 2 };

  assert.ok(matchFlightAgainstRule(f1, rule) !== null, 'A388 matches');
  assert.ok(matchFlightAgainstRule(f2, rule) !== null, 'B748 matches');
  assert.equal(matchFlightAgainstRule(f3, rule), null, 'A320 does not match');
});

test('Watchlist: Rule matching by airline and callsign prefix', () => {
  const airlineRule = {
    id: 'r_airline',
    enabled: true,
    airline: 'UAE, Emirates',
    alertStyle: 'normal'
  };

  assert.ok(matchFlightAgainstRule({ airlineIcao: 'UAE', distance: 3 }, airlineRule) !== null);
  assert.ok(matchFlightAgainstRule({ airline: 'Emirates', distance: 3 }, airlineRule) !== null);
  assert.ok(matchFlightAgainstRule({ callsign: 'UAE394', distance: 3 }, airlineRule) !== null);
  assert.equal(matchFlightAgainstRule({ airlineIcao: 'BAW', callsign: 'BAW143', distance: 3 }, airlineRule), null);

  const prefixRule = {
    id: 'r_prefix',
    enabled: true,
    callsignPrefix: 'ETH, EK39',
    alertStyle: 'special'
  };

  assert.ok(matchFlightAgainstRule({ callsign: 'ETH500', distance: 3 }, prefixRule) !== null);
  assert.ok(matchFlightAgainstRule({ flightNumber: 'EK394', distance: 3 }, prefixRule) !== null);
  assert.equal(matchFlightAgainstRule({ callsign: 'AIC101', distance: 3 }, prefixRule), null);
});

test('Watchlist: Rule matching by specific registration', () => {
  const regRule = {
    id: 'r_reg',
    enabled: true,
    registration: 'A6-EEA',
    alertStyle: 'special'
  };

  assert.ok(matchFlightAgainstRule({ registration: 'A6-EEA', distance: 3 }, regRule) !== null);
  assert.ok(matchFlightAgainstRule({ registration: 'A6EEA', distance: 3 }, regRule) !== null);
  assert.equal(matchFlightAgainstRule({ registration: 'VT-EXR', distance: 3 }, regRule), null);
});

test('Watchlist: Cargo only, Military only, and Passenger only filters', () => {
  const cargoRule = {
    id: 'r_cargo',
    enabled: true,
    cargoFilter: 'cargo_only',
    alertStyle: 'normal'
  };

  const milRule = {
    id: 'r_mil',
    enabled: true,
    cargoFilter: 'military_only',
    alertStyle: 'special'
  };

  const passRule = {
    id: 'r_pass',
    enabled: true,
    cargoFilter: 'passenger_only',
    alertStyle: 'normal'
  };

  const cargoFlight = { aircraftType: 'B77F', airlineIcao: 'FDX', distance: 3 };
  const milFlight = { aircraftType: 'C17', callsign: 'RCH101', distance: 3 };
  const paxFlight = { aircraftType: 'A320', airlineIcao: 'IGO', distance: 3 };

  // Cargo Rule
  assert.ok(matchFlightAgainstRule(cargoFlight, cargoRule) !== null, 'Cargo matches cargo_only');
  assert.equal(matchFlightAgainstRule(milFlight, cargoRule), null, 'Military rejected by cargo_only');
  assert.equal(matchFlightAgainstRule(paxFlight, cargoRule), null, 'Pax rejected by cargo_only');

  // Military Rule
  assert.ok(matchFlightAgainstRule(milFlight, milRule) !== null, 'Military matches military_only');
  assert.equal(matchFlightAgainstRule(cargoFlight, milRule), null, 'Cargo rejected by military_only');
  assert.equal(matchFlightAgainstRule(paxFlight, milRule), null, 'Pax rejected by military_only');

  // Passenger Rule
  assert.ok(matchFlightAgainstRule(paxFlight, passRule) !== null, 'Pax matches passenger_only');
  assert.equal(matchFlightAgainstRule(cargoFlight, passRule), null, 'Cargo rejected by passenger_only');
  assert.equal(matchFlightAgainstRule(milFlight, passRule), null, 'Military rejected by passenger_only');
});

test('Watchlist: Per-rule custom overhead threshold allows wider range for specific planes', () => {
  const wideA380Rule = {
    id: 'r_wide',
    enabled: true,
    aircraftType: 'A388',
    overheadThresholdKm: 15, // 15 km threshold for A380
    alertStyle: 'special'
  };

  const context = { globalOverheadThresholdKm: 5 };

  // An A380 at 12 km distance: outside global 5 km, but inside rule's 15 km threshold!
  const a380At12km = { aircraftType: 'A388', distance: 12.0, dCpa: 12.0 };
  const match = matchFlightAgainstRule(a380At12km, wideA380Rule, context);
  assert.ok(match !== null, 'A380 at 12 km matches wide rule threshold');
  assert.equal(match.overheadThresholdKm, 15);

  // A plane at 18 km: outside rule's 15 km threshold
  const a380At18km = { aircraftType: 'A388', distance: 18.0, dCpa: 18.0 };
  assert.equal(matchFlightAgainstRule(a380At18km, wideA380Rule, context), null);
});

test('Watchlist: Multiple rules evaluation picks highest priority alert style', () => {
  const ruleNormal = { id: 'r1', enabled: true, airline: 'UAE', alertStyle: 'normal' };
  const ruleSpecial = { id: 'r2', enabled: true, aircraftType: 'A388', alertStyle: 'special', ignoreQuietHours: true };

  const flight = { airlineIcao: 'UAE', aircraftType: 'A388', distance: 3 };
  const evalResult = evaluateFlightWatchlist(flight, [ruleNormal, ruleSpecial]);

  assert.ok(evalResult !== null);
  assert.equal(evalResult.alertStyle, 'special', 'Picks Special over Normal');
  assert.equal(evalResult.ignoreQuietHours, true, 'Propagates ignoreQuietHours');
  assert.equal(evalResult.tag, 'RARE');
});

test('Watchlist Audio: Special alert chime generates valid WAV header', () => {
  const wavUri = generateSpecialChimeWavDataUri();
  assert.ok(wavUri.startsWith('data:audio/wav;base64,'), 'Generates base64 WAV data URI');
  assert.ok(wavUri.length > 500, 'WAV data contains sufficient bytes');
});
