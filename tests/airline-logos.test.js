// ============================================================
//  Unit Tests for Airline Monogram Badge System
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAirlineMonogram,
  resolveAirlineKey,
  getAirlineMonogramBadge,
  getAirlineLogoHtml,
  formatNotificationAirline,
  buildFlightTrackingUrl
} from '../lib/airline-logos.js';

test('Airline Monogram: Known major airlines resolve to proper 2-letter IATA codes', () => {
  assert.equal(resolveAirlineMonogram('UAE394', 'Emirates', 'UAE'), 'EK');
  assert.equal(resolveAirlineMonogram('EK394', 'Emirates'), 'EK');
  assert.equal(resolveAirlineMonogram('IGO1115', 'IndiGo', 'IGO'), '6E');
  assert.equal(resolveAirlineMonogram('6E1115', 'IndiGo'), '6E');
  assert.equal(resolveAirlineMonogram('AIC101', 'Air India', 'AIC'), 'AI');
  assert.equal(resolveAirlineMonogram('BAW143', 'British Airways', 'BAW'), 'BA');
  assert.equal(resolveAirlineMonogram('QTR802', 'Qatar Airways', 'QTR'), 'QR');
  assert.equal(resolveAirlineMonogram('DLH456', 'Lufthansa', 'DLH'), 'LH');
  assert.equal(resolveAirlineMonogram('SIA321', 'Singapore Airlines', 'SIA'), 'SQ');
  assert.equal(resolveAirlineMonogram('UAL123', 'United Airlines', 'UAL'), 'UA');
  assert.equal(resolveAirlineMonogram('DAL789', 'Delta Air Lines', 'DAL'), 'DL');
  assert.equal(resolveAirlineMonogram('FDX99', 'FedEx', 'FDX'), 'FX');
  assert.equal(resolveAirlineMonogram('CLX55', 'Cargolux', 'CLX'), 'CV');
});

test('Airline Monogram: Resolves from flight objects and explicit IATA fields', () => {
  const flightWithIata = { airlineIata: 'EK', callsign: 'UAE501', airline: 'Emirates' };
  assert.equal(resolveAirlineMonogram(flightWithIata), 'EK');

  const flightWithoutIata = { callsign: 'AIC101', airline: 'Air India', airlineIcao: 'AIC' };
  assert.equal(resolveAirlineMonogram(flightWithoutIata), 'AI');
});

test('Airline Monogram: Falls back to first 3 letters of ICAO code if no IATA code exists', () => {
  // AHO (Air Hamburg) does not have a 2-letter IATA code
  const result = resolveAirlineMonogram('AHO123', 'Air Hamburg', 'AHO');
  assert.equal(result, 'AHO', 'Falls back to 3-letter ICAO code');
});

test('Airline Monogram: Unknown airline falls back to "--"', () => {
  assert.equal(resolveAirlineMonogram('', '', ''), '--');
  assert.equal(resolveAirlineMonogram('N12345', '', ''), '--');
  assert.equal(resolveAirlineMonogram(null), '--');
});

test('Airline Monogram Badge: Neutral variant renders clean 28x28px badge without brand colors or SVGs', () => {
  const flight = { callsign: 'UAE394', airline: 'Emirates', airlineIcao: 'UAE' };
  const badgeHtml = getAirlineMonogramBadge(flight);

  assert.ok(badgeHtml.includes('airline-monogram-badge'), 'Has airline-monogram-badge class');
  assert.ok(badgeHtml.includes('>EK<'), 'Contains IATA code EK');
  assert.ok(!badgeHtml.includes('is-cargo'), 'Neutral flight is not cargo');
  assert.ok(!badgeHtml.includes('is-watchlist'), 'Neutral flight is not watchlist');
  assert.ok(!badgeHtml.includes('<svg'), 'Zero SVGs generated');
  assert.ok(!badgeHtml.includes('<img'), 'Zero images used');
  assert.ok(!badgeHtml.includes('#D71921'), 'Zero brand colors');
});

test('Airline Monogram Badge: Cargo flights receive dashed border modifier class (is-cargo)', () => {
  const cargoFlight = {
    callsign: 'FDX123',
    airline: 'FedEx',
    airlineIcao: 'FDX',
    aircraftType: 'B77F',
    isCargo: true
  };
  const badgeHtml = getAirlineMonogramBadge(cargoFlight);

  assert.ok(badgeHtml.includes('is-cargo'), 'Cargo flight has is-cargo class for dashed border');
  assert.ok(badgeHtml.includes('>FX<'), 'Contains FedEx IATA code FX');
});

test('Airline Monogram Badge: Watchlist and rare flights receive accent orange modifier class (is-watchlist)', () => {
  const watchlistFlight = {
    callsign: 'UAE394',
    airline: 'Emirates',
    aircraftType: 'A388',
    watchlistTag: 'RARE'
  };
  const badgeHtml = getAirlineMonogramBadge(watchlistFlight);

  assert.ok(badgeHtml.includes('is-watchlist'), 'Watchlist/rare match has is-watchlist class');
  assert.ok(badgeHtml.includes('>EK<'), 'Contains Emirates IATA code EK');
});

test('Airline Monogram Badge: Flights that are both Cargo and Watchlist receive both modifier classes', () => {
  const cargoRareFlight = {
    callsign: 'CLX789',
    airline: 'Cargolux',
    airlineIcao: 'CLX',
    aircraftType: 'B748F',
    watchlistTag: 'WATCH',
    isCargo: true
  };
  const badgeHtml = getAirlineMonogramBadge(cargoRareFlight);

  assert.ok(badgeHtml.includes('is-cargo'), 'Has is-cargo modifier');
  assert.ok(badgeHtml.includes('is-watchlist'), 'Has is-watchlist modifier');
  assert.ok(badgeHtml.includes('>CV<'), 'Contains Cargolux IATA code CV');
});

test('Airline Monogram Badge: Military aircraft receive is-military class and do not get is-cargo', () => {
  const milFlight = {
    callsign: 'RCH311',
    aircraftType: 'C17'
  };
  const badgeHtml = getAirlineMonogramBadge(milFlight);

  assert.ok(badgeHtml.includes('is-military'), 'Military flight has is-military class');
  assert.ok(!badgeHtml.includes('is-cargo'), 'Military flight does NOT have is-cargo class');
  assert.ok(badgeHtml.includes('>RCH<') || badgeHtml.includes('>MIL<'), 'Shows military monogram');
});

test('Airline Monogram Badge: Unknown airline renders "--" badge', () => {
  const unknownFlight = { callsign: 'N999XX', airline: '', aircraftType: 'C172' };
  const badgeHtml = getAirlineMonogramBadge(unknownFlight);

  assert.ok(badgeHtml.includes('>--<'), 'Shows -- for unknown airline');
});

test('Notification Text Prefix: formatNotificationAirline formats monogram prefix correctly', () => {
  const emiratesFlight = { callsign: 'UAE501', flightNumber: 'EK501', airline: 'Emirates' };
  assert.equal(formatNotificationAirline(emiratesFlight), 'EK · Emirates');

  const indigoFlight = { callsign: 'IGO202', flightNumber: '6E202', airline: 'IndiGo' };
  assert.equal(formatNotificationAirline(indigoFlight), '6E · IndiGo');

  const airIndiaFlight = { callsign: 'AIC101', flightNumber: 'AI101', airline: 'Air India' };
  assert.equal(formatNotificationAirline(airIndiaFlight), 'AI · Air India');

  const unknownFlight = { callsign: 'N12345', flightNumber: '', airline: '' };
  assert.equal(formatNotificationAirline(unknownFlight), 'N12345');
});

test('Backwards-Compatibility: getAirlineLogoHtml and resolveAirlineKey work identically', () => {
  assert.equal(resolveAirlineKey('UAE394', 'Emirates'), 'EK');
  const badge = getAirlineLogoHtml('UAE394', 'Emirates');
  assert.ok(badge.includes('airline-monogram-badge'));
  assert.ok(badge.includes('>EK<'));
});

test('Notification Link: Callsign containing "?", "&", "#", and "/" cannot alter URL host or inject query parameters', () => {
  const maliciousCallsign = 'ATTACKER/TEST?admin=true&evil=1#fragment';

  // Flightradar24 URL
  const fr24Url = buildFlightTrackingUrl(maliciousCallsign, 'fr24');
  const parsedFr24 = new URL(fr24Url);
  assert.equal(parsedFr24.origin, 'https://www.flightradar24.com');
  assert.equal(parsedFr24.host, 'www.flightradar24.com');
  assert.equal(parsedFr24.search, '', 'FR24 URL must have no query parameters');
  assert.equal(parsedFr24.hash, '', 'FR24 URL must have no hash anchor');
  assert.equal(parsedFr24.pathname, `/${encodeURIComponent(maliciousCallsign)}`);

  // adsb.lol URL
  const adsbUrl = buildFlightTrackingUrl(maliciousCallsign, 'adsb_lol');
  const parsedAdsb = new URL(adsbUrl);
  assert.equal(parsedAdsb.origin, 'https://globe.adsb.lol');
  assert.equal(parsedAdsb.host, 'globe.adsb.lol');
  assert.equal(parsedAdsb.hash, '', 'adsb.lol URL must have no hash anchor');
  assert.equal(parsedAdsb.searchParams.get('callsign'), maliciousCallsign);
  assert.equal(parsedAdsb.searchParams.get('admin'), null, 'Cannot inject admin query parameter');
  assert.equal(parsedAdsb.searchParams.get('evil'), null, 'Cannot inject evil query parameter');
  assert.equal([...parsedAdsb.searchParams.keys()].length, 1, 'Only callsign parameter exists');
});
