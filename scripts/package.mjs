import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Read package.json for version
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version || '1.0.0';

const distDir = path.join(rootDir, 'dist');
const stagingDir = path.join(distDir, 'staging');
const zipFileName = `airvee-${version}.zip`;
const zipFilePath = path.join(distDir, zipFileName);

// 2. Clean and create directories
if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
if (fs.existsSync(zipFilePath)) {
  fs.rmSync(zipFilePath, { force: true });
}
fs.mkdirSync(stagingDir, { recursive: true });

// 3. Define extension payload
const filesToCopy = [
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
];

const dirsToCopy = [
  'fonts',
  'icons',
  'lib',
  'providers'
];

function copyFolderSync(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const item of fs.readdirSync(from)) {
    const srcPath = path.join(from, item);
    const destPath = path.join(to, item);
    if (fs.statSync(srcPath).isDirectory()) {
      copyFolderSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy individual files
for (const file of filesToCopy) {
  const src = path.join(rootDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(stagingDir, file));
  } else {
    console.warn(`Warning: file not found: ${file}`);
  }
}

// Copy directories
for (const dir of dirsToCopy) {
  const src = path.join(rootDir, dir);
  if (fs.existsSync(src)) {
    copyFolderSync(src, path.join(stagingDir, dir));
  } else {
    console.warn(`Warning: directory not found: ${dir}`);
  }
}

// 4. Collect and print all files in staging
const packagedFiles = [];
function collectFiles(dir, relPrefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, relPath);
    } else {
      packagedFiles.push(relPath);
    }
  }
}
collectFiles(stagingDir);

console.log(`Packaging Airvee v${version} (${packagedFiles.length} files):`);
packagedFiles.sort().forEach(f => console.log(`  + ${f}`));

// 5. Create zip archive using platform tools (no zip npm dependency)
const isWindows = process.platform === 'win32';
if (isWindows) {
  const pwshCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipFilePath}' -Force"`;
  execSync(pwshCmd, { stdio: 'inherit' });
} else {
  execSync(`cd "${stagingDir}" && zip -q -r "${zipFilePath}" .`, { stdio: 'inherit' });
}

// 6. Clean up staging folder
fs.rmSync(stagingDir, { recursive: true, force: true });

const stats = fs.statSync(zipFilePath);
console.log(`\nCreated ${zipFileName} (${(stats.size / 1024).toFixed(1)} KB) at ${zipFilePath}`);
