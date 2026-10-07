// ============================================================
//  AIRVEE — Alerts UI & Rule Operations Unit Tests
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIRLINES,
  AIRCRAFT_TYPES,
  CATEGORIES,
  DIRECTIONS,
  AIRLINE_GROUPS,
  PRESETS,
  formatRuleSentence,
  generateRuleNameFromConditions,
  lookupAirline,
  lookupAircraftType,
  getAirlineDisplayName,
  getAircraftDisplayName
} from '../lib/names.js';
import { evaluateAlertRules } from '../lib/alerts.js';
import { migrateSettings } from '../lib/settings-defaults.js';

test('Alerts UI: Bundled Directory Lookups', () => {
  // Airline lookup
  const ek = lookupAirline('EK');
  assert.ok(ek, 'Lookup by IATA EK returns airline');
  assert.equal(ek.name, 'Emirates');
  assert.equal(ek.icao, 'UAE');

  const uae = lookupAirline('UAE');
  assert.equal(uae.name, 'Emirates', 'Lookup by ICAO UAE');

  const et = lookupAirline('Ethiopian');
  assert.equal(et.iata, 'ET', 'Lookup by name Ethiopian');

  // Aircraft lookup
  const a380 = lookupAircraftType('A388');
  assert.ok(a380, 'Lookup A388 returns Airbus A380-800');
  assert.equal(a380.icao, 'A388');

  const b748 = lookupAircraftType('B748');
  assert.ok(b748, 'Lookup B748 returns Boeing 747-8');

  // Display names
  assert.equal(getAirlineDisplayName('UAE'), 'Emirates');
  assert.equal(getAircraftDisplayName('B77W'), 'Boeing 777-300ER');
});

test('Alerts UI: Rule Sentence Generation', () => {
  // 1. Airlines rule
  const rule1 = {
    name: 'Emirates, Ethiopian',
    enabled: true,
    conditions: { airlines: ['UAE', 'ETH'] },
    action: 'loud'
  };
  const sent1 = formatRuleSentence(rule1);
  assert.equal(sent1.title, 'Emirates, Ethiopian');
  assert.equal(sent1.subtitle, 'Loud alert');

  // 2. Cargo category rule
  const rule2 = {
    name: '',
    enabled: true,
    conditions: { category: ['cargo'] },
    action: 'alert'
  };
  const sent2 = formatRuleSentence(rule2);
  assert.equal(sent2.title, 'Cargo flights');
  assert.equal(sent2.subtitle, 'Alert');

  // 3. Wide-bodies with advanced condition
  const rule3 = {
    name: '',
    enabled: true,
    conditions: { category: ['wide-body'], rareForMe: true, overheadThresholdKm: 8 },
    action: 'loud'
  };
  const sent3 = formatRuleSentence(rule3);
  assert.equal(sent3.title, 'Wide-bodies flights');
  assert.ok(sent3.subtitle.includes('Loud alert'));
  assert.ok(sent3.subtitle.includes('only if rare for me'));
  assert.ok(sent3.subtitle.includes('within 8 km'));

  // 4. Gulf carriers group preset rule expands to member airlines
  const rule4 = {
    name: 'Gulf carriers',
    enabled: true,
    conditions: { airlines: ['gulf'] },
    action: 'loud'
  };
  const sent4 = formatRuleSentence(rule4);
  assert.ok(sent4.title.includes('Gulf carriers'), 'Mentions Gulf carriers');
  assert.ok(sent4.title.includes('Emirates') || sent4.title.includes('Qatar'), 'Shows member airlines');
});

test('Alerts UI: Presets Creation', () => {
  // Cargo preset
  const cargoPreset = PRESETS.find(p => p.id === 'cargo_only');
  assert.ok(cargoPreset, 'Cargo preset exists');
  const cargoRule = cargoPreset.createRule();
  assert.equal(cargoRule.name, 'Cargo flights');
  assert.deepEqual(cargoRule.conditions.category, ['cargo']);
  assert.equal(cargoRule.action, 'alert');

  // Wide-bodies preset
  const widePreset = PRESETS.find(p => p.id === 'wide_bodies');
  assert.ok(widePreset, 'Wide-bodies preset exists');
  const wideRule = widePreset.createRule();
  assert.equal(wideRule.name, 'Wide-body flights');
  assert.deepEqual(wideRule.conditions.category, ['wide-body']);
  assert.equal(wideRule.action, 'alert');

  // Rare aircraft preset
  const rarePreset = PRESETS.find(p => p.id === 'rare_aircraft');
  assert.ok(rarePreset, 'Rare aircraft preset exists');
  const rareRule = rarePreset.createRule();
  assert.equal(rareRule.name, 'Rare aircraft');
  assert.equal(rareRule.conditions.rareForMe, true);
  assert.equal(rareRule.action, 'loud');

  // Gulf carriers preset
  const gulfPreset = PRESETS.find(p => p.id === 'gulf_carriers');
  assert.ok(gulfPreset, 'Gulf carriers preset exists');
  const gulfRule = gulfPreset.createRule();
  assert.equal(gulfRule.name, 'Gulf carriers');
  assert.deepEqual(gulfRule.conditions.airlines, ['gulf']);
  assert.equal(gulfRule.action, 'loud');
});

test('Alerts UI: Chip Add and Remove State Logic', () => {
  let conditions = {};

  // Add airline
  conditions.airlines = ['UAE', 'ETH'];
  assert.equal(conditions.airlines.length, 2);

  // Remove airline
  conditions.airlines = conditions.airlines.filter(c => c !== 'UAE');
  assert.deepEqual(conditions.airlines, ['ETH']);

  // Add aircraft type
  conditions.aircraftTypes = ['A388', 'B748'];
  assert.equal(conditions.aircraftTypes.length, 2);

  // Remove aircraft type
  conditions.aircraftTypes = conditions.aircraftTypes.filter(t => t !== 'B748');
  assert.deepEqual(conditions.aircraftTypes, ['A388']);

  // Auto-generate name from remaining conditions
  const name = generateRuleNameFromConditions(conditions);
  assert.ok(name.includes('Ethiopian'), 'Name includes Ethiopian');
  assert.ok(name.includes('A380'), 'Name includes A380');
});

test('Alerts UI: Saving and Editing Rule through Settings Layer', () => {
  const initialSettings = migrateSettings({
    alertMode: 'chosen',
    defaultAction: 'log',
    alertRules: []
  });

  // 1. Add Rule
  const newRule = {
    id: 'test-rule-1',
    name: 'Emirates, Ethiopian',
    enabled: true,
    conditions: { airlines: ['UAE', 'ETH'] },
    action: 'alert'
  };
  initialSettings.alertRules.push(newRule);
  assert.equal(initialSettings.alertRules.length, 1);
  assert.equal(initialSettings.alertRules[0].action, 'alert');

  // 2. Edit Rule (change action to 'loud')
  const editIdx = initialSettings.alertRules.findIndex(r => r.id === 'test-rule-1');
  initialSettings.alertRules[editIdx] = {
    ...initialSettings.alertRules[editIdx],
    action: 'loud'
  };
  assert.equal(initialSettings.alertRules[0].action, 'loud');
  assert.equal(initialSettings.alertRules[0].name, 'Emirates, Ethiopian');
});

test('Alerts UI: Deleting the Last Rule in Chosen Mode Falls Back to defaultAction', () => {
  const settings = {
    alertMode: 'chosen',
    defaultAction: 'log',
    alertRules: [
      {
        id: 'rule-to-delete',
        name: 'Temporary Rule',
        enabled: true,
        conditions: { category: ['cargo'] },
        action: 'alert'
      }
    ]
  };

  const testFlight = {
    callsign: 'AIC101',
    airlineIcao: 'AIC',
    airline: 'Air India',
    aircraftType: 'A320',
    altitudeFt: 30000,
    origin: 'DEL',
    destination: 'BOM'
  };

  // Delete the rule
  settings.alertRules = [];
  assert.equal(settings.alertRules.length, 0, 'No rules remaining');

  // Evaluation in chosen mode with 0 rules
  const evalResult = evaluateAlertRules(testFlight, settings.alertRules, {
    alertMode: settings.alertMode,
    defaultAction: settings.defaultAction
  });

  assert.equal(evalResult.action, 'log', 'Falls back to defaultAction: log');
  assert.equal(evalResult.matchedRule, null, 'No rule matched');

  // If defaultAction is set to 'ignore'
  settings.defaultAction = 'ignore';
  const evalResultIgnore = evaluateAlertRules(testFlight, settings.alertRules, {
    alertMode: settings.alertMode,
    defaultAction: settings.defaultAction
  });
  assert.equal(evalResultIgnore.action, 'ignore', 'Falls back to defaultAction: ignore');
});
