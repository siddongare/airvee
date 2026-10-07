import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlertRules } from '../lib/alerts.js';
import { fetchMockFlightsNear } from '../providers/mock.js';
import { calculateCPA } from '../lib/geo.js';

test('Alerts Verification: Mock flights & user specified rules', async () => {
  const rules = [
    {
      id: 'rule-emirates-ethiopian',
      name: 'Emirates & Ethiopian',
      enabled: true,
      conditions: { airlines: ['UAE', 'ETH'] },
      action: 'loud'
    },
    {
      id: 'rule-cargo',
      name: 'Cargo flights',
      enabled: true,
      conditions: { category: ['cargo'] },
      action: 'alert'
    }
  ];

  const observer = { lat: 21.1458, lon: 79.0882 };
  const mockFlights = await fetchMockFlightsNear(observer.lat, observer.lon, 35);

  // Flight 1: Air India AIC101 (Overhead pass, CPA ~0km)
  const aic = mockFlights.find(f => f.callsign === 'AIC101');
  assert.ok(aic);
  const geoAic = calculateCPA(
    aic.lat, aic.lon, aic.altitudeFt, aic.groundSpeedKt, aic.trackDeg, aic.verticalRateFpm,
    observer.lat, observer.lon, 0, 5
  );
  assert.ok(geoAic.dCpa <= 5, 'AIC101 is overhead');
  assert.equal(geoAic.passesOverhead, true);

  // Evaluated in alertMode: 'chosen', defaultAction: 'log'
  const decisionAic = evaluateAlertRules(aic, rules, {
    alertMode: 'chosen',
    defaultAction: 'log',
    allowMock: true
  });
  assert.equal(decisionAic.action, 'log', 'Unmatched overhead flight falls back to log only');
  assert.equal(decisionAic.matchedRule, null);

  // Evaluated in alertMode: 'all'
  const decisionAicAll = evaluateAlertRules(aic, rules, {
    alertMode: 'all',
    defaultAction: 'log',
    allowMock: true
  });
  assert.equal(decisionAicAll.action, 'alert', 'In mode "all", unmatched overhead flight defaults to normal alert');

  // Flight 2: Emirates UAE504 (Passing 20km east, CPA ~20km)
  const uae = mockFlights.find(f => f.callsign === 'UAE504');
  assert.ok(uae);
  const geoUae = calculateCPA(
    uae.lat, uae.lon, uae.altitudeFt, uae.groundSpeedKt, uae.trackDeg, uae.verticalRateFpm,
    observer.lat, observer.lon, 0, 5
  );
  assert.ok(geoUae.dCpa > 5, 'UAE504 passes 20km away (not overhead)');
  assert.equal(geoUae.passesOverhead, false, 'UAE504 does not pass overhead');

  // Flight 2b: Emirates UAE504 overhead (e.g. within overhead range)
  const uaeOverhead = { ...uae, dCpa: 1.5 };
  const decisionUaeOverhead = evaluateAlertRules(uaeOverhead, rules, {
    alertMode: 'chosen',
    defaultAction: 'log',
    allowMock: true
  });
  assert.equal(decisionUaeOverhead.action, 'loud', 'Overhead Emirates triggers Loud alert');
  assert.equal(decisionUaeOverhead.matchedRule.id, 'rule-emirates-ethiopian');

  // Flight 3: Ethiopian flight overhead
  const ethFlight = {
    callsign: 'ETH601',
    airline: 'Ethiopian Airlines',
    airlineIcao: 'ETH',
    aircraftType: 'B788',
    lat: observer.lat,
    lon: observer.lon,
    altitudeFt: 36000,
    groundSpeedKt: 470,
    trackDeg: 180,
    dCpa: 0.8
  };
  const decisionEth = evaluateAlertRules(ethFlight, rules, {
    alertMode: 'chosen',
    defaultAction: 'log',
    allowMock: true
  });
  assert.equal(decisionEth.action, 'loud', 'Ethiopian flight triggers Loud alert');
  assert.equal(decisionEth.matchedRule.id, 'rule-emirates-ethiopian');

  // Flight 4: Cargo flight overhead (e.g. FedEx B77L)
  const cargoFlight = {
    callsign: 'FDX5920',
    airline: 'FedEx',
    airlineIcao: 'FDX',
    aircraftType: 'B77L',
    lat: observer.lat,
    lon: observer.lon,
    altitudeFt: 34000,
    groundSpeedKt: 480,
    trackDeg: 90,
    dCpa: 1.2
  };
  const decisionCargo = evaluateAlertRules(cargoFlight, rules, {
    alertMode: 'chosen',
    defaultAction: 'log',
    allowMock: true
  });
  assert.equal(decisionCargo.action, 'alert', 'Cargo flight triggers normal Alert');
  assert.equal(decisionCargo.matchedRule.id, 'rule-cargo');
});
