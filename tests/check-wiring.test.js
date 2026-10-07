import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runWiringCheck } from '../scripts/check-wiring.mjs';

test('Wiring Check: catches missing named export in fixture', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airvee-wiring-export-test-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'lib'), { recursive: true });

    // Create a consumer file importing nonExistentFunc
    fs.writeFileSync(path.join(tmpDir, 'popup.js'), `
      import { nonExistentFunc } from './lib/helper.js';
      console.log(nonExistentFunc);
    `);

    // Create helper without that export
    fs.writeFileSync(path.join(tmpDir, 'lib', 'helper.js'), `
      export function existingFunc() { return 42; }
    `);

    // Minimal popup.html
    fs.writeFileSync(path.join(tmpDir, 'popup.html'), `<!DOCTYPE html><html><body></body></html>`);

    const errors = runWiringCheck({ projectRoot: tmpDir, silent: true });
    assert(errors.some(e => e.includes("[EXPORT ERROR]") && e.includes("nonExistentFunc")),
      `Expected error about nonExistentFunc, got: ${JSON.stringify(errors)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Wiring Check: catches missing HTML element ID in fixture', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airvee-wiring-id-test-'));
  try {
    // JS looks up #missingButton
    fs.writeFileSync(path.join(tmpDir, 'popup.js'), `
      const btn = $('#missingButton');
    `);

    // HTML only has #existingButton
    fs.writeFileSync(path.join(tmpDir, 'popup.html'), `
      <!DOCTYPE html>
      <html>
        <body>
          <button id="existingButton">Click</button>
        </body>
      </html>
    `);

    const errors = runWiringCheck({ projectRoot: tmpDir, silent: true });
    assert(errors.some(e => e.includes("[ELEMENT ID ERROR]") && e.includes("missingButton")),
      `Expected error about missingButton ID, got: ${JSON.stringify(errors)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Wiring Check: catches non-allowlisted package imports in fixture', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airvee-wiring-pkg-test-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'secret_dir'), { recursive: true });

    fs.writeFileSync(path.join(tmpDir, 'secret_dir', 'secret.js'), `
      export const SECRET = 123;
    `);

    fs.writeFileSync(path.join(tmpDir, 'popup.js'), `
      import { SECRET } from './secret_dir/secret.js';
    `);

    fs.writeFileSync(path.join(tmpDir, 'popup.html'), `<!DOCTYPE html><html><body></body></html>`);

    const errors = runWiringCheck({ projectRoot: tmpDir, silent: true });
    assert(errors.some(e => e.includes("[PACKAGING ERROR]") && e.includes("secret_dir/secret.js")),
      `Expected packaging error about secret_dir/secret.js, got: ${JSON.stringify(errors)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
