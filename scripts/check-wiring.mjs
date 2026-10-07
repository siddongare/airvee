// ============================================================
//  AIRVEE — Static Wiring & Import Integrity Checker
//  Validates:
//  1. Relative imports and named exports exist in source modules.
//  2. Static HTML element IDs looked up by JS exist in HTML.
//  3. Imported files are part of the packaging payload allowlist.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Dynamic IDs created at runtime (e.g. inside innerHTML / cards) that cannot
// be found statically in initial popup.html or radar.html.
// Each entry includes an explanation comment.
const DYNAMIC_ELEMENT_ID_ALLOWLIST = new Set([
  // Dynamically rendered inside Live tab hero card (in renderFlightList)
  'heroCountdownVal',
  'heroCompassNeedle',
  'heroLookAngles',
  'heroLookRelative',

  // Dynamically rendered inside quiet sky recent traffic banner (in renderFlightList)
  'btnGoToLog',

  // Dynamically rendered inside Radar target inspection HUD card (in renderRadarSelectedTarget)
  'btnCloseRadarTarget',

  // Dynamically generated error fallback banner in popup.js (in renderErrorFallback)
  'initErrorFallback',

  // Dynamically rendered inside Add Rule Step 2 condition forms (in renderStep2Options)
  'inputRouteOrigin',
  'inputRouteDest',
  'selectRouteFlightType',
  'inputReg',
  'inputCallsignPrefix'
]);

// Packaging allowlist from scripts/package.mjs
const PACKAGING_ALLOWLIST_FILES = new Set([
  'manifest.json',
  'background.js',
  'popup.html',
  'popup.js',
  'radar.html',
  'radar.js',
  'offscreen.html',
  'offscreen.js',
  'styles.css',
  'rare_aircraft.json'
]);

const PACKAGING_ALLOWLIST_DIRS = [
  'fonts',
  'icons',
  'lib',
  'providers'
];

function isPathInPackagingAllowlist(relPath) {
  // Normalize Windows/POSIX separators to POSIX
  const norm = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (PACKAGING_ALLOWLIST_FILES.has(norm)) {
    return true;
  }
  for (const dir of PACKAGING_ALLOWLIST_DIRS) {
    if (norm === dir || norm.startsWith(`${dir}/`)) {
      return true;
    }
  }
  return false;
}

export function runWiringCheck({ projectRoot = rootDir, silent = false } = {}) {
  const errors = [];

  // Find all extension JS files to check
  const entryFiles = ['background.js', 'popup.js', 'radar.js', 'offscreen.js'];
  const extDirs = ['lib', 'providers'];

  const allJsFiles = [];
  for (const f of entryFiles) {
    const full = path.join(projectRoot, f);
    if (fs.existsSync(full)) allJsFiles.push(full);
  }
  for (const d of extDirs) {
    const fullDir = path.join(projectRoot, d);
    if (fs.existsSync(fullDir)) {
      for (const entry of fs.readdirSync(fullDir)) {
        if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
          allJsFiles.push(path.join(fullDir, entry));
        }
      }
    }
  }

  // 1 & 3: Check imports, named exports, and packaging allowlist
  for (const file of allJsFiles) {
    const relFile = path.relative(projectRoot, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf8');

    // Parse import statements: import ... from '...'
    const importRegex = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const clause = match[1].trim();
      const importPath = match[2];

      // Only check local relative imports
      if (!importPath.startsWith('.')) continue;

      const resolved = path.resolve(path.dirname(file), importPath);
      const relImportPath = path.relative(projectRoot, resolved).replace(/\\/g, '/');

      // Check file exists
      if (!fs.existsSync(resolved)) {
        errors.push(`[IMPORT ERROR] ${relFile} imports non-existent file: ${importPath}`);
        continue;
      }

      // Check (3): Imported path is in packaging allowlist
      if (!isPathInPackagingAllowlist(relImportPath)) {
        errors.push(`[PACKAGING ERROR] ${relFile} imports ${importPath} (${relImportPath}) which is NOT in packaging allowlist`);
      }

      // Check (1): Named exports
      if (clause.startsWith('{') && clause.endsWith('}')) {
        const rawNamed = clause.slice(1, -1);
        const namedList = rawNamed.split(',').map(s => s.trim()).filter(Boolean).map(s => {
          const parts = s.split(/\s+as\s+/);
          return parts[0].trim();
        });

        const targetContent = fs.readFileSync(resolved, 'utf8');
        for (const name of namedList) {
          const exportRegex = new RegExp(`export\\s+(?:(?:async\\s+)?function\\s+\\*?|const\\s+|let\\s+|class\\s+)?\\b${name}\\b`);
          const exportNamedRegex = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`);
          if (!exportRegex.test(targetContent) && !exportNamedRegex.test(targetContent)) {
            errors.push(`[EXPORT ERROR] ${relFile} imports '${name}' from ${importPath}, but '${name}' is not exported by ${relImportPath}`);
          }
        }
      }
    }
  }

  // 2. Check element IDs looked up in JS against HTML
  const htmlPairs = [
    { js: 'popup.js', html: 'popup.html' },
    { js: 'radar.js', html: 'radar.html' }
  ];

  for (const pair of htmlPairs) {
    const jsPath = path.join(projectRoot, pair.js);
    const htmlPath = path.join(projectRoot, pair.html);
    if (!fs.existsSync(jsPath) || !fs.existsSync(htmlPath)) continue;

    const jsCode = fs.readFileSync(jsPath, 'utf8');
    const htmlCode = fs.readFileSync(htmlPath, 'utf8');

    // Extract all IDs from HTML
    const htmlIds = new Set();
    const idRegex = /id=['"]([^'"]+)['"]/g;
    let m;
    while ((m = idRegex.exec(htmlCode)) !== null) {
      htmlIds.add(m[1]);
    }

    // Extract string-literal IDs looked up in JS:
    // $('#...'), querySelector('#...'), getElementById('...')
    const lookupRegex = /(?:\$|querySelector)\s*\(\s*['"]#([a-zA-Z0-9_-]+)['"]|getElementById\s*\(\s*['"]([a-zA-Z0-9_-]+)['"]/g;
    while ((m = lookupRegex.exec(jsCode)) !== null) {
      const id = m[1] || m[2];
      if (!id) continue;
      if (DYNAMIC_ELEMENT_ID_ALLOWLIST.has(id)) continue;
      if (!htmlIds.has(id)) {
        errors.push(`[ELEMENT ID ERROR] ${pair.js} looks up element #${id}, but it is missing in ${pair.html}`);
      }
    }
  }

  if (!silent) {
    if (errors.length > 0) {
      console.error('Wiring check failed with errors:');
      for (const err of errors) console.error(`  - ${err}`);
    } else {
      console.log('✓ Wiring check passed: all imports, exports, HTML IDs, and package paths verified.');
    }
  }

  return errors;
}

// Direct execution CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const errors = runWiringCheck();
  if (errors.length > 0) {
    process.exit(1);
  }
}
