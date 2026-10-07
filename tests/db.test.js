// ============================================================
//  AIRVEE — Tests for lib/db.js (Seats, CSV & Data Aggregation)
// ============================================================

import assert from 'node:assert';
import { getTypicalSeats, AIRCRAFT_SEATS } from '../lib/db.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}:`, err.message);
    failed++;
  }
}

console.log('\n--- 1. Aircraft Typical Seats Lookup ---');

test('A388 typical seats is 525', () => {
  assert.strictEqual(getTypicalSeats('A388'), 525);
  assert.strictEqual(getTypicalSeats('a388'), 525);
});

test('B77W typical seats is 396', () => {
  assert.strictEqual(getTypicalSeats('B77W'), 396);
});

test('A359 typical seats is 315', () => {
  assert.strictEqual(getTypicalSeats('A359'), 315);
});

test('B789 typical seats is 296', () => {
  assert.strictEqual(getTypicalSeats('B789'), 296);
});

test('A320 typical seats is 168 and A20N is 180', () => {
  assert.strictEqual(getTypicalSeats('A320'), 168);
  assert.strictEqual(getTypicalSeats('A20N'), 180);
});

test('B738 typical seats is 162 and B38M is 189', () => {
  assert.strictEqual(getTypicalSeats('B738'), 162);
  assert.strictEqual(getTypicalSeats('B38M'), 189);
});

test('Unknown aircraft returns null (never fake ADS-B passengers)', () => {
  assert.strictEqual(getTypicalSeats(''), null);
  assert.strictEqual(getTypicalSeats(null), null);
  assert.strictEqual(getTypicalSeats(undefined), null);
  assert.strictEqual(getTypicalSeats('GLID'), null);
  assert.strictEqual(getTypicalSeats('UNKNOWN_XYZ'), null);
});

console.log('\n--- 2. Aircraft Table Coverage ---');

test('AIRCRAFT_SEATS contains major airliners', () => {
  assert.ok('A380' in AIRCRAFT_SEATS);
  assert.ok('B748' in AIRCRAFT_SEATS);
  assert.ok('B773' in AIRCRAFT_SEATS);
  assert.ok('A35K' in AIRCRAFT_SEATS);
  assert.ok('E190' in AIRCRAFT_SEATS);
  assert.ok('AT76' in AIRCRAFT_SEATS);
  assert.ok('DH8D' in AIRCRAFT_SEATS);
  assert.ok(Object.keys(AIRCRAFT_SEATS).length >= 40);
});

console.log(`\n========================================`);
console.log(`DB/SEATS TEST SUMMARY: ${passed} passed, ${failed} failed.`);
console.log(`========================================\n`);

if (failed > 0) process.exit(1);
