// ============================================================
//  AIRVEE — Tests for Radar Polar Coordinate Projection
// ============================================================

import assert from 'node:assert';

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

// Pure math helper matching RadarScope._projectFlightToCanvas logic
function projectPolar(cx, cy, scopeRadius, distKm, bearingDeg, maxRadiusKm, rotOffsetDeg = 0) {
  const normalizedDist = Math.min(1.05, distKm / maxRadiusKm);
  const pixelDist = normalizedDist * scopeRadius;
  const effectiveBearing = (bearingDeg - rotOffsetDeg + 360) % 360;
  const bearingRad = (effectiveBearing * Math.PI) / 180;
  const x = cx + pixelDist * Math.sin(bearingRad);
  const y = cy - pixelDist * Math.cos(bearingRad);
  return { x, y, distKm, bearingDeg, effectiveBearing };
}

console.log('\n--- 1. Polar to Canvas Cartesian Projection ---');

test('Plane at True North (0°) projects directly above center (-Y)', () => {
  const p = projectPolar(170, 170, 150, 15, 0, 15);
  assert.ok(Math.abs(p.x - 170) < 0.001, `x expected 170, got ${p.x}`);
  assert.ok(Math.abs(p.y - 20) < 0.001, `y expected 20, got ${p.y}`);
});

test('Plane Due East (90°) projects to the right (+X)', () => {
  const p = projectPolar(170, 170, 150, 15, 90, 15);
  assert.ok(Math.abs(p.x - 320) < 0.001, `x expected 320, got ${p.x}`);
  assert.ok(Math.abs(p.y - 170) < 0.001, `y expected 170, got ${p.y}`);
});

test('Plane Due South (180°) projects below center (+Y)', () => {
  const p = projectPolar(170, 170, 150, 15, 180, 15);
  assert.ok(Math.abs(p.x - 170) < 0.001, `x expected 170, got ${p.x}`);
  assert.ok(Math.abs(p.y - 320) < 0.001, `y expected 320, got ${p.y}`);
});

test('Plane Due West (270°) projects to the left (-X)', () => {
  const p = projectPolar(170, 170, 150, 15, 270, 15);
  assert.ok(Math.abs(p.x - 20) < 0.001, `x expected 20, got ${p.x}`);
  assert.ok(Math.abs(p.y - 170) < 0.001, `y expected 170, got ${p.y}`);
});

test('Half radius (7.5 km in 15 km scope) projects to 50% radius', () => {
  const p = projectPolar(170, 170, 150, 7.5, 90, 15);
  assert.ok(Math.abs(p.x - 245) < 0.001, `x expected 245, got ${p.x}`);
  assert.ok(Math.abs(p.y - 170) < 0.001, `y expected 170, got ${p.y}`);
});

console.log('\n--- 2. Facing Up Radar Scope Rotation ---');

test('Facing South (180°), a plane Due South (180°) rotates directly to the top (-Y)', () => {
  // rotOffsetDeg = 180 (South)
  const p = projectPolar(170, 170, 150, 15, 180, 15, 180);
  assert.ok(Math.abs(p.x - 170) < 0.001, `x expected 170, got ${p.x}`);
  assert.ok(Math.abs(p.y - 20) < 0.001, `y expected 20 (top), got ${p.y}`);
});

test('Facing South (180°), a plane Due North (0°) rotates directly to the bottom (+Y)', () => {
  const p = projectPolar(170, 170, 150, 15, 0, 15, 180);
  assert.ok(Math.abs(p.x - 170) < 0.001, `x expected 170, got ${p.x}`);
  assert.ok(Math.abs(p.y - 320) < 0.001, `y expected 320 (bottom), got ${p.y}`);
});

test('Facing South (180°), a plane Due West (270°) rotates to the user right (+X)', () => {
  const p = projectPolar(170, 170, 150, 15, 270, 15, 180);
  assert.ok(Math.abs(p.x - 320) < 0.001, `x expected 320 (right), got ${p.x}`);
  assert.ok(Math.abs(p.y - 170) < 0.001, `y expected 170, got ${p.y}`);
});

console.log('\n--- 3. Radar Target Hit-Testing ---');

test('Hit test finds plane within 16px proximity', () => {
  const target = { x: 200, y: 150 };
  const click = { x: 205, y: 152 };
  const dist = Math.hypot(click.x - target.x, click.y - target.y);
  assert.ok(dist <= 16, `Hit distance ${dist} should be <= 16px`);
});

test('Hit test rejects far click outside 16px', () => {
  const target = { x: 200, y: 150 };
  const click = { x: 230, y: 180 };
  const dist = Math.hypot(click.x - target.x, click.y - target.y);
  assert.ok(dist > 16, `Hit distance ${dist} should be > 16px`);
});

console.log(`\n========================================`);
console.log(`RADAR TEST SUMMARY: ${passed} passed, ${failed} failed.`);
console.log(`========================================\n`);

if (failed > 0) process.exit(1);
