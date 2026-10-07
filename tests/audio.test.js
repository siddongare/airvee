// ============================================================
//  AIRVEE — Audio & Quiet Hours Unit Tests
//  Run via: node tests/audio.test.js
// ============================================================

import { isQuietHours, getCalendarDayKey } from '../lib/audio.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('\n--- 1. Calendar Day Key (Deduplication) ---');
{
  const d1 = new Date('2026-10-05T08:30:00Z');
  const key1 = getCalendarDayKey(d1);
  assert(key1 === '2026-10-05', `Calendar key for 2026-10-05 is ${key1}`);

  const d2 = new Date('2026-01-01T00:00:00Z');
  const key2 = getCalendarDayKey(d2);
  assert(key2 === '2026-01-01', `Calendar key with zero padding is ${key2}`);
}

console.log('\n--- 2. Quiet Hours Logic ---');
{
  // Disabled
  assert(
    isQuietHours({ quietHoursEnabled: false, quietHoursStart: '23:00', quietHoursEnd: '07:00' }) === false,
    'Disabled quiet hours returns false'
  );

  // Missing time strings
  assert(
    isQuietHours({ quietHoursEnabled: true, quietHoursStart: '', quietHoursEnd: '' }) === false,
    'Empty quiet hours returns false'
  );

  // Test custom time mock
  function testQuietTime(currentH, currentM, start, end) {
    const origDate = global.Date;
    class MockDate extends origDate {
      getHours() { return currentH; }
      getMinutes() { return currentM; }
    }
    global.Date = MockDate;
    const res = isQuietHours({ quietHoursEnabled: true, quietHoursStart: start, quietHoursEnd: end });
    global.Date = origDate;
    return res;
  }

  // Overnight window: 23:00 to 07:00
  assert(testQuietTime(23, 30, '23:00', '07:00') === true, '23:30 is in overnight quiet hours 23:00-07:00');
  assert(testQuietTime(2, 0, '23:00', '07:00') === true, '02:00 is in overnight quiet hours 23:00-07:00');
  assert(testQuietTime(6, 59, '23:00', '07:00') === true, '06:59 is in overnight quiet hours 23:00-07:00');
  assert(testQuietTime(7, 0, '23:00', '07:00') === false, '07:00 is outside quiet hours 23:00-07:00');
  assert(testQuietTime(12, 0, '23:00', '07:00') === false, '12:00 is outside quiet hours 23:00-07:00');
  assert(testQuietTime(22, 59, '23:00', '07:00') === false, '22:59 is outside quiet hours 23:00-07:00');

  // Daytime window: 13:00 to 15:00
  assert(testQuietTime(14, 0, '13:00', '15:00') === true, '14:00 is inside daytime quiet hours 13:00-15:00');
  assert(testQuietTime(16, 0, '13:00', '15:00') === false, '16:00 is outside daytime quiet hours 13:00-15:00');
}

console.log(`\n========================================`);
console.log(`AUDIO TEST SUMMARY: ${passed} passed, ${failed} failed.`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}
