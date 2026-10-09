import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const imagesDir = path.join(rootDir, 'docs', 'images');

if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

// 1. Prepare flight test data for preview
const now = Date.now();
const mockNearbyFlights = [
  {
    id: 'flt_uae504',
    callsign: 'UAE504',
    flightNumber: 'EK504',
    airline: 'Emirates',
    airlineIcao: 'UAE',
    aircraftType: 'A388',
    registration: 'A6-EVS',
    origin: 'DXB',
    destination: 'BOM',
    originCity: 'Dubai',
    destCity: 'Mumbai',
    lat: 21.0513,
    lon: 79.0882,
    altitudeFt: 35000,
    altitude: 35000,
    groundSpeedKt: 460,
    trackDeg: 0,
    verticalRateFpm: -200,
    distance: 10.5,
    eta: 45,
    minDist: 0.2,
    tCpa: 45,
    dCpa: 0.2,
    bearingAtCpa: 315, // NW
    elevationAtCpa: 75,
    currentBearing: 180,
    currentElevation: 42,
    passesOverhead: true,
    passClassification: 'overhead',
    isInbound: true,
    isWatchlist: true,
    watchlistTag: 'LOUD',
    watchlistRuleName: 'Emirates A380',
    alertStyle: 'special',
    lookDirection: 'Look NW, 75° up',
    visibilityHint: 'Golden hour · belly illuminated',
    visibilityRegime: 'golden_hour',
    visibilityContrast: 'high',
    flightType: 'international',
    isMilitary: false,
    isCargo: false,
    squawk: '4215',
    lastSeen: now
  },
  {
    id: 'flt_aic101',
    callsign: 'AIC101',
    flightNumber: 'AI101',
    airline: 'Air India',
    airlineIcao: 'AIC',
    aircraftType: 'B77W',
    registration: 'VT-ALQ',
    origin: 'DEL',
    destination: 'BOM',
    originCity: 'Delhi',
    destCity: 'Mumbai',
    lat: 21.2858,
    lon: 79.1450,
    altitudeFt: 34000,
    altitude: 34000,
    groundSpeedKt: 470,
    trackDeg: 195,
    verticalRateFpm: 0,
    distance: 16.5,
    eta: 120,
    minDist: 1.8,
    tCpa: 120,
    dCpa: 1.8,
    bearingAtCpa: 250,
    elevationAtCpa: 42,
    currentBearing: 25,
    currentElevation: 30,
    passesOverhead: true,
    passClassification: 'overhead',
    isInbound: true,
    isWatchlist: false,
    alertStyle: 'normal',
    lookDirection: 'Look WSW, 42° up',
    visibilityHint: 'Clear sky · high contrast',
    visibilityRegime: 'day',
    flightType: 'domestic',
    isMilitary: false,
    isCargo: false,
    squawk: '2104',
    lastSeen: now
  },
  {
    id: 'flt_baw143',
    callsign: 'BAW143',
    flightNumber: 'BA143',
    airline: 'British Airways',
    airlineIcao: 'BAW',
    aircraftType: 'B789',
    registration: 'G-ZBKO',
    origin: 'LHR',
    destination: 'DEL',
    originCity: 'London',
    destCity: 'Delhi',
    lat: 21.2200,
    lon: 79.2450,
    altitudeFt: 38000,
    altitude: 38000,
    groundSpeedKt: 500,
    trackDeg: 110,
    verticalRateFpm: 0,
    distance: 18.0,
    eta: null,
    minDist: 14.5,
    tCpa: 130,
    dCpa: 14.5,
    bearingAtCpa: 82,
    elevationAtCpa: 12,
    currentBearing: 65,
    currentElevation: 10,
    passesOverhead: false,
    passClassification: 'near',
    isInbound: true,
    flightType: 'international',
    isMilitary: false,
    isCargo: false,
    squawk: '5512',
    lastSeen: now
  },
  {
    id: 'flt_fdx5910',
    callsign: 'FDX5910',
    flightNumber: 'FX5910',
    airline: 'FedEx Express',
    airlineIcao: 'FDX',
    aircraftType: 'B77L',
    registration: 'N884FD',
    origin: 'DXB',
    destination: 'BKK',
    originCity: 'Dubai',
    destCity: 'Bangkok',
    lat: 20.9500,
    lon: 78.9800,
    altitudeFt: 33000,
    altitude: 33000,
    groundSpeedKt: 485,
    trackDeg: 85,
    verticalRateFpm: 0,
    distance: 24.0,
    eta: null,
    minDist: 19.0,
    tCpa: 170,
    dCpa: 19.0,
    bearingAtCpa: 160,
    elevationAtCpa: 8,
    currentBearing: 215,
    currentElevation: 7,
    passesOverhead: false,
    passClassification: 'near',
    isInbound: true,
    isCargo: true,
    flightType: 'international',
    isWatchlist: true,
    watchlistRuleName: 'Cargo Freighters',
    squawk: '6720',
    lastSeen: now
  }
];

const mockSettings = {
  schemaVersion: 6,
  latitude: 21.1458,
  longitude: 79.0882,
  radiusKm: 30,
  overheadThresholdKm: 5,
  minElevationDeg: 15,
  userFacing: 'NW',
  flightFilter: 'all',
  minAltitudeFt: 0,
  maxAltitudeFt: 60000,
  unitDistance: 'km',
  unitSpeed: 'kt',
  unitAltitude: 'ft',
  cardMode: 'compact',
  showAircraftPhotos: false,
  radarOrientation: 'facing_up',
  alertMode: 'chosen',
  defaultAction: 'log',
  alertRules: [
    {
      id: 'rule-emirates-a380',
      name: 'Emirates A380',
      enabled: true,
      conditions: { airlines: ['UAE'], aircraftTypes: ['A388'] },
      action: 'loud'
    },
    {
      id: 'rule-freighters',
      name: 'Cargo Freighters',
      enabled: true,
      conditions: { category: ['cargo'] },
      action: 'alert'
    }
  ],
  soundEnabled: true,
  chimeVolume: 80,
  quietHoursEnabled: false,
  diagnosticsEnabled: false,
  mockProviderEnabled: false
};

// 2. Prepare past flight passes for IndexedDB
const samplePasses = [];
const sampleAirlines = [
  { name: 'Emirates', icao: 'UAE', cs: 'UAE504', fn: 'EK504', type: 'A388', reg: 'A6-EVS', orig: 'DXB', dest: 'BOM' },
  { name: 'Air India', icao: 'AIC', cs: 'AIC101', fn: 'AI101', type: 'B77W', reg: 'VT-ALQ', orig: 'DEL', dest: 'BOM' },
  { name: 'Qatar Airways', icao: 'QTR', cs: 'QTR556', fn: 'QR556', type: 'A359', reg: 'A7-ALC', orig: 'DOH', dest: 'DEL' },
  { name: 'Singapore Airlines', icao: 'SIA', cs: 'SIA404', fn: 'SQ404', type: 'B78X', reg: '9V-SCB', orig: 'SIN', dest: 'DEL' },
  { name: 'British Airways', icao: 'BAW', cs: 'BAW143', fn: 'BA143', type: 'B789', reg: 'G-ZBKO', orig: 'LHR', dest: 'DEL' },
  { name: 'Lufthansa', icao: 'DLH', cs: 'DLH754', fn: 'LH754', type: 'B748', reg: 'D-ABYA', orig: 'FRA', dest: 'BLR' },
  { name: 'Ethiopian Airlines', icao: 'ETH', cs: 'ETH640', fn: 'ET640', type: 'B788', reg: 'ET-AOP', orig: 'ADD', dest: 'BOM' },
  { name: 'Cathay Pacific', icao: 'CPA', cs: 'CPA697', fn: 'CX697', type: 'A35K', reg: 'B-LXA', orig: 'HKG', dest: 'DEL' },
  { name: 'IndiGo', icao: 'IGO', cs: 'IGO202', fn: '6E202', type: 'A21N', reg: 'VT-IMD', orig: 'BOM', dest: 'DEL' },
  { name: 'FedEx Express', icao: 'FDX', cs: 'FDX5910', fn: 'FX5910', type: 'B77L', reg: 'N884FD', orig: 'DXB', dest: 'BKK' }
];

for (let i = 0; i < 28; i++) {
  const item = sampleAirlines[i % sampleAirlines.length];
  const offsetHours = (i * 5.5) + (i % 3);
  const passTime = new Date(now - offsetHours * 3600000);
  const dayKey = passTime.toISOString().slice(0, 10);
  samplePasses.push({
    flightDayKey: `${item.cs}_${dayKey}_${i}`,
    flightId: `${item.cs}_${i}`,
    timestamp: passTime.getTime(),
    callsign: item.cs,
    flightNumber: item.fn,
    airline: item.name,
    airlineIcao: item.icao,
    aircraftType: item.type,
    typicalSeats: item.type === 'A388' ? 525 : (item.type === 'B748' ? 410 : (item.type === 'B77W' ? 396 : 280)),
    registration: item.reg,
    squawk: '42' + String(10 + i),
    altitude: 34000 + (i % 4) * 1000,
    speed: 470 + (i % 5) * 10,
    closestDistance: 1.2 + (i % 3) * 0.8,
    passesOverhead: true,
    azimuthAtCpa: (270 + i * 25) % 360,
    elevationAtCpa: 42 + (i % 35),
    origin: item.orig,
    destination: item.dest,
    route: `${item.orig} → ${item.dest}`,
    isRouteLikely: false,
    flightType: 'international',
    source: 'fr24',
    hourOfDay: passTime.getHours(),
    dayOfWeek: passTime.getDay(),
    dateStr: dayKey
  });
}

// 3. Create the preview injection HTML
const rawPopupHtml = fs.readFileSync(path.join(rootDir, 'popup.html'), 'utf8');

const injectionScript = `
<script>
  window.__AIRVEE_PREVIEW_MODE__ = true;
  const mockStorageData = {
    settings: ${JSON.stringify(mockSettings)},
    nearbyFlights: ${JSON.stringify(mockNearbyFlights)},
    providerStatus: { activeProvider: 'FR24', isFastPolling: false },
    lastPollTime: ${now},
    lastPollStatus: 'ok',
    lastPollSource: 'FR24',
    maxSimultaneousPlanes: 8,
    maxSimultaneousAt: ${now - 3600000 * 3}
  };

  window.chrome = {
    storage: {
      local: {
        get: (keys) => {
          if (!keys) return Promise.resolve(mockStorageData);
          if (typeof keys === 'string') return Promise.resolve({ [keys]: mockStorageData[keys] });
          if (Array.isArray(keys)) {
            const res = {};
            keys.forEach(k => res[k] = mockStorageData[k]);
            return Promise.resolve(res);
          }
          return Promise.resolve(mockStorageData);
        },
        set: (obj) => {
          Object.assign(mockStorageData, obj);
          return Promise.resolve();
        }
      }
    },
    runtime: {
      sendMessage: () => Promise.resolve(),
      onMessage: { addListener: () => {} },
      getURL: (p) => p
    },
    tabs: { create: () => {} },
    notifications: { create: () => Promise.resolve(), clear: () => Promise.resolve() }
  };

  // Seed IndexedDB
  const seedDB = () => new Promise((resolve) => {
    const req = indexedDB.open('airvee_flight_db', 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('flight_passes')) {
        const store = db.createObjectStore('flight_passes', { keyPath: 'id', autoIncrement: true });
        store.createIndex('flightDayKey', 'flightDayKey', { unique: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('airline', 'airline', { unique: false });
        store.createIndex('aircraftType', 'aircraftType', { unique: false });
        store.createIndex('origin', 'origin', { unique: false });
        store.createIndex('destination', 'destination', { unique: false });
        store.createIndex('flightType', 'flightType', { unique: false });
      }
      if (!db.objectStoreNames.contains('diagnostics_polls')) {
        db.createObjectStore('diagnostics_polls', { keyPath: 'pollTime' });
      }
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('flight_passes', 'readwrite');
      const store = tx.objectStore('flight_passes');
      const passes = ${JSON.stringify(samplePasses)};
      passes.forEach(p => store.put(p));
      tx.oncomplete = () => {
        window.__AIRVEE_DB_READY__ = true;
        resolve();
      };
    };
  });
  seedDB();
</script>
`;

const previewHtml = rawPopupHtml.replace(
  '<script type="module" src="popup.js"></script>',
  `${injectionScript}\n  <script type="module" src="popup.js"></script>`
);

// 4. Start local HTTP server
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '/preview.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(previewHtml);
  }
  const filePath = path.join(rootDir, reqPath);
  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  const ext = path.extname(filePath);
  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2'
  };
  res.setHeader('Content-Type', mimeMap[ext] || 'text/plain');
  res.end(fs.readFileSync(filePath));
});

server.listen(8089, '127.0.0.1', async () => {
  console.log('Serving Airvee preview on http://127.0.0.1:8089/preview.html');

  const userDir = path.join(os.tmpdir(), 'airvee_asset_gen_' + Date.now());
  fs.mkdirSync(userDir, { recursive: true });

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const proc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9236',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=800,900',
    '--user-data-dir=' + userDir,
    'http://127.0.0.1:8089/preview.html'
  ]);

  await new Promise(r => setTimeout(r, 2500));

  try {
    const listRes = await fetch('http://127.0.0.1:9236/json/list');
    const targets = await listRes.json();
    const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('preview.html'));

    if (!pageTarget) {
      throw new Error('Page target not found in Chrome DevTools.');
    }

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

    let msgId = 1;
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = msgId++;
      const handler = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.id === id) {
          ws.removeEventListener('message', handler);
          if (data.error) reject(new Error(data.error.message));
          else resolve(data.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    // Configure exact popup metrics at 2x HiDPI scale
    await send('Emulation.setDeviceMetricsOverride', {
      width: 380,
      height: 590,
      deviceScaleFactor: 2,
      mobile: false
    });

    // Wait for DB ready & initial render
    await send('Runtime.evaluate', {
      expression: 'new Promise(r => { const chk = () => window.__AIRVEE_DB_READY__ ? r() : setTimeout(chk, 100); chk(); })',
      awaitPromise: true
    });
    await new Promise(r => setTimeout(r, 800));

    const captureShot = async (name) => {
      const activeId = await send('Runtime.evaluate', {
        expression: "document.querySelector('.view-container.active')?.id || 'none'",
        returnByValue: true
      });
      console.log(`Capturing ${name} (active view: ${activeId.result.value})...`);

      const res = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: 380, height: 590, scale: 1 }
      });
      const filePath = path.join(imagesDir, name);
      fs.writeFileSync(filePath, Buffer.from(res.data, 'base64'));
      console.log(`✓ Saved ${name} (${(res.data.length * 0.75 / 1024).toFixed(1)} KB)`);
    };

    // 1. Live View
    await send('Runtime.evaluate', { expression: "document.querySelector('.main-tab-btn[data-tab=\"live\"]').click()" });
    await new Promise(r => setTimeout(r, 800));
    await captureShot('live.png');

    // 2. Radar View
    await send('Runtime.evaluate', { expression: "document.querySelector('.main-tab-btn[data-tab=\"radar\"]').click()" });
    await new Promise(r => setTimeout(r, 600));
    await send('Runtime.evaluate', {
      expression: "if (popupRadarScope && currentFlights.length) { popupRadarScope.setSelectedFlight(currentFlights[0].id); renderRadarSelectedTarget(currentFlights[0]); }"
    });
    await new Promise(r => setTimeout(r, 800));
    await captureShot('radar.png');

    // 3. Alerts View
    await send('Runtime.evaluate', { expression: "document.querySelector('.main-tab-btn[data-tab=\"settings\"]').click()" });
    await new Promise(r => setTimeout(r, 600));
    await send('Runtime.evaluate', { expression: "document.getElementById('rowAlertsScreen')?.click()" });
    await new Promise(r => setTimeout(r, 800));
    await captureShot('alerts.png');

    // 4. Log View
    await send('Runtime.evaluate', { expression: "document.querySelector('.main-tab-btn[data-tab=\"log\"]').click()" });
    await new Promise(r => setTimeout(r, 1000));
    await captureShot('log.png');

    // 5. Stats View
    await send('Runtime.evaluate', { expression: "document.querySelector('.main-tab-btn[data-tab=\"stats\"]').click()" });
    await new Promise(r => setTimeout(r, 1200));
    await captureShot('stats.png');

    // 6. Generate Demo GIF frames
    console.log('Capturing frames for demo.gif...');
    const frameDir = path.join(userDir, 'frames');
    fs.mkdirSync(frameDir, { recursive: true });

    let frameIdx = 0;
    const saveFrame = async () => {
      const res = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: 380, height: 590, scale: 1 }
      });
      const numStr = String(frameIdx++).padStart(3, '0');
      fs.writeFileSync(path.join(frameDir, `frame_${numStr}.png`), Buffer.from(res.data, 'base64'));
    };

    // Frame sequence: Live Tab with incoming overhead flight
    await send('Runtime.evaluate', { expression: "document.querySelector('.main-tab-btn[data-tab=\"live\"]').click()" });
    await new Promise(r => setTimeout(r, 500));
    for (let i = 0; i < 7; i++) {
      await saveFrame();
      await new Promise(r => setTimeout(r, 250));
    }

    // Frame sequence: Switch to Radar scope
    await send('Runtime.evaluate', { expression: "document.querySelector('.main-tab-btn[data-tab=\"radar\"]').click()" });
    await new Promise(r => setTimeout(r, 500));
    for (let i = 0; i < 7; i++) {
      await saveFrame();
      await new Promise(r => setTimeout(r, 250));
    }

    // Frame sequence: Switch to Alerts rules
    await send('Runtime.evaluate', { expression: "document.querySelector('.main-tab-btn[data-tab=\"settings\"]').click()" });
    await new Promise(r => setTimeout(r, 400));
    await send('Runtime.evaluate', { expression: "document.getElementById('rowAlertsScreen')?.click()" });
    await new Promise(r => setTimeout(r, 500));
    for (let i = 0; i < 7; i++) {
      await saveFrame();
      await new Promise(r => setTimeout(r, 250));
    }

    // Frame sequence: Switch to Flight Log
    await send('Runtime.evaluate', { expression: "document.querySelector('.main-tab-btn[data-tab=\"log\"]').click()" });
    await new Promise(r => setTimeout(r, 500));
    for (let i = 0; i < 7; i++) {
      await saveFrame();
      await new Promise(r => setTimeout(r, 250));
    }

    // Frame sequence: Switch to Stats Heatmap
    await send('Runtime.evaluate', { expression: "document.querySelector('.main-tab-btn[data-tab=\"stats\"]').click()" });
    await new Promise(r => setTimeout(r, 500));
    for (let i = 0; i < 7; i++) {
      await saveFrame();
      await new Promise(r => setTimeout(r, 250));
    }

    ws.close();
    proc.kill();
    server.close();

    // Compile into demo.gif with ffmpeg
    const gifPath = path.join(imagesDir, 'demo.gif');
    console.log(`Compiling ${frameIdx} frames into demo.gif with ffmpeg...`);
    const ffmpegCmd = `ffmpeg -y -framerate 4 -i "${path.join(frameDir, 'frame_%03d.png')}" -vf "fps=4,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" "${gifPath}"`;
    execSync(ffmpegCmd, { stdio: 'pipe' });

    console.log(`✓ Generated demo.gif at ${gifPath} (${(fs.statSync(gifPath).size / 1024).toFixed(1)} KB)`);

    // Clean up temp
    fs.rmSync(userDir, { recursive: true, force: true });
    console.log('All screenshots and demo GIF generated successfully!');
  } catch (err) {
    console.error('Asset generation failed:', err);
    proc.kill();
    server.close();
    process.exit(1);
  }
});
