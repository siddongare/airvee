// ============================================================
//  AIRVEE — Cockpit Minimal Controller
//  - Fixed 380x590 layout with fixed 52px bottom bar
//  - Embedded Airline Insignias & Real Flights
//  - Interactive Micro-interactions & Tactile Feedback
//  - Complete 6-module Stats Analytics Restoration
//  - Zero NaN values & aesthetic font stack
// ============================================================

import {
  deadReckonPosition,
  formatLookDirection,
  parseCoordinate,
  parseCoordinatePair,
  formatCoordinateForDisplay,
  isValidCoordinate,
  bearingToCompass,
  getRelativeDirection,
  classifyPass,
  formatOverheadRowSubline
} from './lib/geo.js';
import { playAirportDoubleChime, playWavFallbackChime } from './lib/audio.js';
import {
  getFlightLogs,
  getFlightStats,
  getLifeListStats,
  checkIsFirstTimeSeen,
  clearAllLogs
} from './lib/db.js';
import { RadarScope } from './lib/radar.js';
import { getAirlineLogoHtml, getAirlineMonogramBadge, resolveAirlineMonogram } from './lib/airline-logos.js';
import { evaluateFlightWatchlist, isInherentlyRare, isMilitaryAircraft, isCargoAircraft, DEFAULT_INHERENTLY_RARE_TYPES } from './lib/watchlist.js';
import { predictLikelyFlightsToday, computeHeatmapData } from './lib/schedule.js';
import { calculateSunElevation, classifyVisibility } from './lib/visibility.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DEFAULTS = {
  schemaVersion: 5,
  latitude: 21.1458,
  longitude: 79.0882,
  groundElevationM: 310,
  radiusKm: 30,
  overheadThresholdKm: 5,
  alertsEnabled: true,
  soundEnabled: true,
  flightFilter: 'all',
  userFacing: 'S',
  chimeVolume: 80,
  minElevationDeg: 15,
  quietHoursEnabled: false,
  quietHoursStart: '23:00',
  quietHoursEnd: '07:00',
  unitDistance: 'km',
  unitSpeed: 'kt',
  unitAltitude: 'ft',
  mockProviderEnabled: false,
  rareSeenThreshold: 2,
  watchlistRules: [],
  showAircraftPhotos: false,
  radarOrientation: 'facing_up'
};

export function migrateSettings(rawSettings) {
  if (!rawSettings) return { ...DEFAULTS };
  const v = rawSettings.schemaVersion || 1;
  const migrated = { ...rawSettings };
  if (v < 2) {
    migrated.schemaVersion = 2;
    if (migrated.unitDistance === undefined) migrated.unitDistance = 'km';
    if (migrated.unitSpeed === undefined) migrated.unitSpeed = 'kt';
    if (migrated.unitAltitude === undefined) migrated.unitAltitude = 'ft';
    if (migrated.groundElevationM === undefined) migrated.groundElevationM = 310;
  }
  if (v < 3) {
    if (migrated.overheadThresholdKm === undefined) {
      migrated.overheadThresholdKm = 5;
    }
  }
  if (v < 4) {
    if (migrated.rareSeenThreshold === undefined) migrated.rareSeenThreshold = 2;
    if (migrated.watchlistRules === undefined) migrated.watchlistRules = [];
  }
  if (v < 5) {
    if (migrated.showAircraftPhotos === undefined) migrated.showAircraftPhotos = false;
  }
  if (migrated.mockProviderEnabled === undefined) {
    migrated.mockProviderEnabled = false;
  }
  if (migrated.radarOrientation === undefined) {
    migrated.radarOrientation = 'facing_up';
  }
  migrated.schemaVersion = 5;
  return { ...DEFAULTS, ...migrated };
}

let currentSettings = { ...DEFAULTS };
let currentFlights = [];
let expandedFlightId = null;
let expandedLogId = null;
let currentActiveTab = 'live';
let currentLogFilter = 'all'; // 'all' | 'overhead' | 'nearby'
let currentCollectionScope = 'overhead'; // 'overhead' | 'nearby'
let currentCollectionCat = 'airlines'; // 'airlines' | 'types' | 'registrations'
let cachedLifeListStats = null;
let logSearchDebounceTimer = null;
let popupRadarScope = null;
let pollInterval = null;
let countdownInterval = null;

const TAB_NAMES = ['live', 'radar', 'log', 'stats', 'settings'];

export function updateNavIndicator() {
  const indicator = $('#navIndicator');
  if (!indicator) return;
  const idx = TAB_NAMES.indexOf(currentActiveTab);
  if (idx !== -1) {
    indicator.style.transform = `translateX(${idx * 100}%)`;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  renderSettings();
  bindEvents();
  await refreshFlights();
  updateCockpitHeader(currentActiveTab);
  updateNavIndicator();

  // Poll update every 8 seconds
  pollInterval = setInterval(refreshFlights, 8000);

  // One-time reset for mock-contaminated peak traffic stat
  try {
    const { maxSimultaneousResetV1 } = await chrome.storage.local.get('maxSimultaneousResetV1');
    if (!maxSimultaneousResetV1) {
      await chrome.storage.local.set({
        maxSimultaneousPlanes: 0,
        maxSimultaneousAt: null,
        maxSimultaneousResetV1: true
      });
    }
  } catch (e) {}

  // Live countdown ticker every 1 second
  countdownInterval = setInterval(tickCountdowns, 1000);
});

// ============================================================
//  Settings Persistence (Full Precision Floats)
// ============================================================

async function loadSettings() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    currentSettings = migrateSettings(settings);
    if (!settings || settings.schemaVersion !== currentSettings.schemaVersion) {
      await chrome.storage.local.set({ settings: currentSettings });
    }
  } catch (e) {
    console.warn('Airvee: Settings load failed:', e.message);
  }
}

async function saveSettings() {
  try {
    await chrome.storage.local.set({ settings: { ...currentSettings } });
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }).catch(() => {});
  } catch (e) {
    console.warn('Airvee: Settings save failed:', e.message);
  }
}

function renderSettings() {
  if ($('#latitude')) {
    $('#latitude').value = formatCoordinateForDisplay(currentSettings.latitude);
  }
  if ($('#longitude')) {
    $('#longitude').value = formatCoordinateForDisplay(currentSettings.longitude);
  }
  if ($('#userFacing')) {
    $('#userFacing').value = currentSettings.userFacing || 'S';
    const facingLabel = $('#radarFacingLabel');
    if (facingLabel) facingLabel.textContent = currentSettings.userFacing || 'S';
  }
  if ($('#radiusDisplay')) {
    $('#radiusDisplay').textContent = `${currentSettings.radiusKm} km`;
  }
  if ($('#overheadThresholdDisplay')) {
    $('#overheadThresholdDisplay').textContent = `${currentSettings.overheadThresholdKm} km`;
  }
  if ($('#radarOrientationDisplay')) {
    $('#radarOrientationDisplay').textContent = currentSettings.radarOrientation === 'north_up'
      ? 'North up (0°)'
      : `Facing up (${currentSettings.userFacing || 'S'})`;
  }
  const facingLabel = $('#radarFacingLabel');
  if (facingLabel) {
    facingLabel.textContent = currentSettings.radarOrientation === 'north_up'
      ? 'NORTH UP (N)'
      : `FACING UP (${currentSettings.userFacing || 'S'})`;
  }
  if ($('#alertsEnabled')) {
    $('#alertsEnabled').checked = Boolean(currentSettings.alertsEnabled);
  }
  if ($('#soundEnabled')) {
    $('#soundEnabled').checked = Boolean(currentSettings.soundEnabled);
  }

  const rules = currentSettings.watchlistRules || [];
  const activeCount = rules.filter(r => r.enabled !== false).length;
  if ($('#watchlistCountDisplay')) {
    $('#watchlistCountDisplay').textContent = `${activeCount} active · ${rules.length} total`;
  }
  if ($('#rareThresholdDisplay')) {
    $('#rareThresholdDisplay').textContent = `< ${currentSettings.rareSeenThreshold || 2} passes`;
  }

  updateMockBannerVisibility();
}

function updateMockBannerVisibility() {
  const banner = $('#mockDataBanner');
  if (banner) {
    banner.style.display = currentSettings.mockProviderEnabled ? 'flex' : 'none';
  }
}

// ============================================================
//  Event Binding
// ============================================================

function bindEvents() {
  bindWatchlistEvents();
  const handleCoordInput = () => {
    const latStr = $('#latitude').value;
    const lonStr = $('#longitude').value;

    const pairInLat = parseCoordinatePair(latStr);
    if (pairInLat) {
      currentSettings.latitude = pairInLat.lat;
      currentSettings.longitude = pairInLat.lon;
      $('#latitude').value = formatCoordinateForDisplay(pairInLat.lat);
      $('#longitude').value = formatCoordinateForDisplay(pairInLat.lon);
      saveSettings();
      triggerQuickPoll();
      return;
    }

    const pairInLon = parseCoordinatePair(lonStr);
    if (pairInLon) {
      currentSettings.latitude = pairInLon.lat;
      currentSettings.longitude = pairInLon.lon;
      $('#latitude').value = formatCoordinateForDisplay(pairInLon.lat);
      $('#longitude').value = formatCoordinateForDisplay(pairInLon.lon);
      saveSettings();
      triggerQuickPoll();
      return;
    }

    const pLat = parseCoordinate(latStr);
    const pLon = parseCoordinate(lonStr);
    let changed = false;

    if (pLat !== null && isValidCoordinate(pLat, currentSettings.longitude)) {
      currentSettings.latitude = pLat;
      changed = true;
    }
    if (pLon !== null && isValidCoordinate(currentSettings.latitude, pLon)) {
      currentSettings.longitude = pLon;
      changed = true;
    }

    if (changed) {
      saveSettings();
      triggerQuickPoll();
    }
  };

  $('#latitude').addEventListener('change', handleCoordInput);
  $('#longitude').addEventListener('change', handleCoordInput);
  $('#latitude').addEventListener('paste', () => setTimeout(handleCoordInput, 10));
  $('#longitude').addEventListener('paste', () => setTimeout(handleCoordInput, 10));

  // I Face selector
  $('#userFacing').addEventListener('change', (e) => {
    currentSettings.userFacing = e.target.value;
    saveSettings();
    renderSettings();
    renderFlightList();
    if (popupRadarScope) {
      popupRadarScope.setOptions({
        userFacing: currentSettings.userFacing,
        orientation: currentSettings.radarOrientation || 'facing_up'
      });
      popupRadarScope.setFlights(currentFlights);
    }
  });

  // Radar Orientation toggle handler
  const toggleRadarOrientation = () => {
    currentSettings.radarOrientation = currentSettings.radarOrientation === 'north_up' ? 'facing_up' : 'north_up';
    saveSettings();
    renderSettings();
    if (popupRadarScope) {
      popupRadarScope.setOptions({
        userFacing: currentSettings.userFacing,
        orientation: currentSettings.radarOrientation
      });
      popupRadarScope.setFlights(currentFlights);
    }
  };

  $('#rowRadarOrientation')?.addEventListener('click', toggleRadarOrientation);
  $('#btnRadarOrientation')?.addEventListener('click', toggleRadarOrientation);

  // Radius row click prompt
  $('#rowRadius').addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const current = currentSettings.radiusKm;
    const input = prompt('Enter detection radius in km (5 - 50):', current);
    const val = parseInt(input, 10);
    if (!isNaN(val) && val >= 5 && val <= 50) {
      currentSettings.radiusKm = val;
      $('#radiusDisplay').textContent = `${val} km`;
      saveSettings();
      refreshFlights();
    }
  });

  // Overhead Threshold row click prompt
  $('#rowThreshold').addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const current = currentSettings.overheadThresholdKm;
    const input = prompt('Enter overhead threshold distance in km (1 - 25):', current);
    const val = parseInt(input, 10);
    if (!isNaN(val) && val >= 1 && val <= 25) {
      currentSettings.overheadThresholdKm = val;
      $('#overheadThresholdDisplay').textContent = `${val} km`;
      saveSettings();
      renderFlightList();
    }
  });

  // Toggles
  $('#alertsEnabled').addEventListener('change', (e) => {
    currentSettings.alertsEnabled = e.target.checked;
    saveSettings();
  });

  $('#soundEnabled').addEventListener('change', (e) => {
    currentSettings.soundEnabled = e.target.checked;
    saveSettings();
  });


  $('#testChimeBtn').addEventListener('click', handleTestChime);

  // Tab navigation
  $$('.main-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Log Search Input & Clear Button
  const logSearch = $('#logSearchInput');
  const clearBtn = $('#logSearchClear');
  if (logSearch) {
    logSearch.addEventListener('input', () => {
      if (clearBtn) clearBtn.style.display = logSearch.value.length > 0 ? 'flex' : 'none';
      clearTimeout(logSearchDebounceTimer);
      logSearchDebounceTimer = setTimeout(renderLogView, 150);
    });
  }

  if (clearBtn && logSearch) {
    clearBtn.addEventListener('click', () => {
      logSearch.value = '';
      clearBtn.style.display = 'none';
      logSearch.focus();
      renderLogView();
    });
  }

  // Log Segment Filter Buttons
  $$('.log-segment-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.log-segment-btn[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLogFilter = btn.dataset.filter || 'all';
      renderLogView();
    });
  });

  // Clear Flight Log & Peak Traffic Stat
  const btnClearLog = $('#btnClearLog');
  if (btnClearLog) {
    btnClearLog.addEventListener('click', async () => {
      if (!window.confirm('Clear all logged flight passes and reset peak traffic count?')) {
        return;
      }
      try {
        await clearAllLogs();
        await chrome.storage.local.set({
          maxSimultaneousPlanes: 0,
          maxSimultaneousAt: null
        });
        await renderLogView();
        if (currentActiveTab === 'stats') {
          await renderStatsView();
        }
      } catch (err) {
        console.warn('Airvee: Failed to clear flight log:', err);
      }
    });
  }

  // Collection Scope Toggle (Overhead only vs All nearby)
  const btnScopeOverhead = $('#btnScopeOverhead');
  const btnScopeNearby = $('#btnScopeNearby');
  if (btnScopeOverhead && btnScopeNearby) {
    btnScopeOverhead.addEventListener('click', async () => {
      btnScopeOverhead.classList.add('active');
      btnScopeNearby.classList.remove('active');
      currentCollectionScope = 'overhead';
      await renderStatsView();
    });
    btnScopeNearby.addEventListener('click', async () => {
      btnScopeNearby.classList.add('active');
      btnScopeOverhead.classList.remove('active');
      currentCollectionScope = 'nearby';
      await renderStatsView();
    });
  }

  // Collection Category Tabs (Airlines / Types / Registrations)
  $$('.col-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.col-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCollectionCat = btn.dataset.cat || 'airlines';
      renderCollectionDeck();
    });
  });

  // Disable Mock button in banner
  const btnDisableMock = $('#btnDisableMock');
  if (btnDisableMock) {
    btnDisableMock.addEventListener('click', async () => {
      currentSettings.mockProviderEnabled = false;
      await saveSettings();
      updateMockBannerVisibility();
      await triggerQuickPoll();
    });
  }

  // Version 5-click toggle for mock mode
  const versionTag = $('#settingsVersionTag');
  if (versionTag) {
    let clickCount = 0;
    let timer = null;
    versionTag.addEventListener('click', () => {
      clickCount++;
      clearTimeout(timer);
      timer = setTimeout(() => { clickCount = 0; }, 2500);

      if (clickCount >= 5) {
        clickCount = 0;
        currentSettings.mockProviderEnabled = !currentSettings.mockProviderEnabled;
        saveSettings().then(async () => {
          updateMockBannerVisibility();
          await triggerQuickPoll();
        });
      }
    });
  }
}

async function handleTestChime() {
  const btn = $('#testChimeBtn');
  btn.style.color = 'var(--accent)';

  try {
    await playAirportDoubleChime(currentSettings.chimeVolume || 80);
  } catch (err) {
    try {
      await playWavFallbackChime(currentSettings.chimeVolume || 80);
    } catch (e) {}
  }

  setTimeout(() => { btn.style.color = ''; }, 600);
}

async function triggerQuickPoll() {
  try {
    await chrome.runtime.sendMessage({ type: 'FORCE_POLL' });
    await sleep(800);
    await refreshFlights();
  } catch (e) {}
}

// ============================================================
//  Flight Polling & Live Data Processing
// ============================================================

async function refreshFlights() {
  try {
    const data = await chrome.storage.local.get([
      'nearbyFlights', 'lastPollTime', 'lastPollStatus', 'lastPollSource', 'providerStatus'
    ]);

    currentFlights = data.nearbyFlights || [];
    await renderFlightList();

    if (popupRadarScope) {
      popupRadarScope.setOptions({
        maxRadiusKm: currentSettings.radiusKm,
        userFacing: currentSettings.userFacing,
        orientation: currentSettings.radarOrientation || 'facing_up'
      });
      popupRadarScope.setFlights(currentFlights);
    }

    updateCockpitHeader(currentActiveTab);
  } catch (e) {
    console.warn('Airvee: Flight refresh error:', e.message);
  }
}

function tickCountdowns() {
  const now = Date.now();
  let hasUpdates = false;

  currentFlights.forEach(f => {
    const elapsedSeconds = f.lastSeen ? Math.max(0, (now - f.lastSeen) / 1000) : 0;
    const dr = deadReckonPosition(
      f,
      elapsedSeconds,
      currentSettings.latitude,
      currentSettings.longitude,
      0,
      currentSettings.radiusKm
    );

    f.distance = Math.round(dr.distanceKm * 10) / 10;
    f.eta = dr.tCpa > 0 ? Math.round(dr.tCpa) : null;
    f.dCpa = Math.round(dr.dCpa * 10) / 10;
    f.passesOverhead = dr.passesOverhead;
    f.bearingAtCpa = Math.round(dr.bearing);
    f.elevationAtCpa = Math.round(dr.elevation);
    f.passClassification = classifyPass(f, currentSettings);

    hasUpdates = true;
  });

  if (hasUpdates) {
    // 1. Hero Block (active only if hero exists and is overhead)
    const heroCountdown = $('#heroCountdownVal');
    const heroBlock = $('.hero-block');
    if (heroCountdown && heroBlock && heroBlock.dataset.heroId) {
      const hf = currentFlights.find(x => String(x.id) === String(heroBlock.dataset.heroId));
      if (hf && hf.passClassification === 'overhead' && hf.eta !== null && hf.eta > 0) {
        heroCountdown.textContent = formatETA(hf.eta);
        const isUrgent = hf.eta <= 60;
        heroCountdown.classList.toggle('overhead-urgent', isUrgent);

        const bearingVal = (typeof hf.bearingAtCpa === 'number' && !isNaN(hf.bearingAtCpa)) ? hf.bearingAtCpa : 0;
        const needle = $('#heroCompassNeedle');
        if (needle) {
          needle.style.transform = `rotate(${bearingVal}deg)`;
        }

        const lookAngles = $('#heroLookAngles');
        if (lookAngles) {
          const compass = bearingToCompass(bearingVal, false);
          const rawElev = hf.elevationAtCpa != null ? hf.elevationAtCpa : hf.currentElevation;
          const elev = (typeof rawElev === 'number' && !isNaN(rawElev)) ? Math.max(0, Math.round(rawElev)) : 25;
          lookAngles.textContent = `${compass}  ·  ${elev}°  up`;
        }

        const lookRel = $('#heroLookRelative');
        if (lookRel) {
          const rel = getRelativeDirection(bearingVal, currentSettings.userFacing) || 'Ahead';
          lookRel.textContent = capitalize(rel);
        }
      }
    }

    // 2. Row Countdowns
    $$('.flight-row-item').forEach(row => {
      const id = row.dataset.id;
      const f = currentFlights.find(x => String(x.id) === String(id));
      if (!f) return;

      const etaEl = row.querySelector('.row-countdown');
      if (etaEl) {
        if (f.passClassification === 'overhead' && f.eta !== null && f.eta > 0) {
          etaEl.textContent = formatETA(f.eta);
        } else {
          // Near flight: show distance / status instead of countdown
          etaEl.textContent = `${Math.round(f.distance)} km`;
        }
      }

      const sublineEl = row.querySelector('.row-subline');
      if (sublineEl) {
        if (f.passClassification === 'overhead') {
          sublineEl.textContent = formatOverheadRowSubline(f);
        } else {
          sublineEl.textContent = `${esc(f.aircraftType || 'Aircraft')}  ·  ${formatNearFlightStatus(f)}`;
        }
      }
    });

    // 3. Radar scope flight sync
    if (popupRadarScope && currentActiveTab === 'radar') {
      popupRadarScope.setFlights(currentFlights);
    }
  }
}

// ============================================================
//  Dynamic Header (Cockpit Minimal)
// ============================================================

export function updateCockpitHeader(tabName) {
  const titleEl = $('#headerTitle');
  const statusBadge = $('#statusBadge');
  const statusText = $('#sourceStatus');

  if (!titleEl) return;

  titleEl.className = 'header-brand mono';

  if (tabName === 'live') {
    titleEl.textContent = 'AIRVEE';
    if (statusBadge) statusBadge.style.display = 'flex';
    if (statusText) {
      const src = currentSettings.mockProviderEnabled ? 'MOCK' : 'FR24';
      statusText.textContent = `${src} · 15 S`;
    }
  } else if (tabName === 'radar') {
    titleEl.className = 'header-brand sub-header mono';
    titleEl.textContent = `RADAR · ${currentSettings.radiusKm} KM`;
    if (statusBadge) statusBadge.style.display = 'flex';
    const count = currentFlights.length;
    if (statusText) statusText.textContent = `${count} TARGET${count === 1 ? '' : 'S'}`;
    const dot = statusBadge.querySelector('.status-dot');
    if (dot) dot.style.display = 'none';
  } else if (tabName === 'log') {
    titleEl.className = 'header-brand large-title';
    titleEl.textContent = 'Log';
    if (statusBadge) statusBadge.style.display = 'flex';
    if (statusText) statusText.textContent = 'OVERHEAD LOG';
    const dot = statusBadge.querySelector('.status-dot');
    if (dot) dot.style.display = 'none';
  } else if (tabName === 'stats') {
    titleEl.className = 'header-brand large-title';
    titleEl.textContent = 'Stats';
    if (statusBadge) statusBadge.style.display = 'none';
  } else if (tabName === 'settings') {
    titleEl.className = 'header-brand large-title';
    titleEl.textContent = 'Settings';
    if (statusBadge) statusBadge.style.display = 'none';
  }

  // Restore green dot on live tab
  if (tabName === 'live' && statusBadge) {
    const dot = statusBadge.querySelector('.status-dot');
    if (dot) dot.style.display = 'block';
  }
}


// ============================================================
//  SCREEN 1: Live Feed with Hero & Nearby Rows
// ============================================================

async function renderFlightList() {
  const container = $('#flightList');
  if (!container) return;

  // Retrieve logs for predictions and recent passes
  let allRecentLogs = [];
  let stats = null;
  try {
    allRecentLogs = await getFlightLogs({ limit: 500, sortOrder: 'desc' });
    stats = await getFlightStats();
  } catch (e) {}

  const likelyPredictions = predictLikelyFlightsToday(allRecentLogs, Date.now());
  const likelySectionHtml = buildLikelyTodaySectionHtml(likelyPredictions);

  // Real flights only. When none in range, show rich symmetrical Cockpit Scanner & Recent Passes!
  if (currentFlights.length === 0) {
    const recentLogs = allRecentLogs.slice(0, 3);
    const lastPlane = recentLogs[0] || null;
    const todayPasses = stats ? (stats.totalFlights || 0) : recentLogs.length;

    let recentPassesHtml = '';
    if (recentLogs.length > 0) {
      recentPassesHtml = `
        <div class="recent-traffic-header">
          <span class="recent-traffic-title mono">RECENT OVERHEAD PASSES</span>
          <span class="recent-traffic-link mono" id="btnGoToLog">View all log →</span>
        </div>
        <div class="recent-rows-list">
          ${recentLogs.map(r => buildRecentLogRowHtml(r)).join('')}
        </div>
      `;
    } else {
      recentPassesHtml = `
        <div class="recent-traffic-header">
          <span class="recent-traffic-title mono">AIRSPACE MONITOR</span>
        </div>
        <div class="watchlist-rule-card" style="padding:14px; text-align:center; justify-content:center;">
          <span class="mono" style="font-size:11px; color:var(--text-secondary); line-height:1.5;">
            Transponder detection active within ${currentSettings.radiusKm} km.<br>
            Audio chime & look directions will trigger on overhead approach.
          </span>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="quiet-scanner-container">
        <!-- Radar Scanner Hero Widget -->
        <div class="quiet-scanner-hero">
          <div class="quiet-radar-bezel">
            <div class="quiet-radar-ring-1"></div>
            <div class="quiet-radar-ring-2"></div>
            <div class="quiet-radar-axis-v"></div>
            <div class="quiet-radar-axis-h"></div>
            <div class="quiet-radar-sweep"></div>
            <div class="quiet-radar-center-dot"></div>
          </div>
          <div class="quiet-headline mono">QUIET SKY · ALL CLEAR</div>
          <div class="quiet-subline mono">
            Scanning ${currentSettings.radiusKm} km scope · ${currentSettings.groundElevationM || 310}m ground elevation
          </div>
        </div>

        <!-- Symmetrical 3-Capsule Cockpit Telemetry Bar -->
        <div class="quiet-telemetry-grid">
          <div class="quiet-capsule">
            <span class="capsule-label mono">RANGE</span>
            <span class="capsule-val mono">${currentSettings.radiusKm} KM</span>
          </div>
          <div class="quiet-capsule">
            <span class="capsule-label mono">YOU FACE</span>
            <span class="capsule-val mono">${currentSettings.userFacing || 'SOUTH'}</span>
          </div>
          <div class="quiet-capsule">
            <span class="capsule-label mono">TOTAL LOG</span>
            <span class="capsule-val mono">${todayPasses} PASS${todayPasses === 1 ? '' : 'ES'}</span>
          </div>
        </div>

        <!-- Recent Overhead Traffic List -->
        ${recentPassesHtml}

        <!-- Learned Schedule Predictions ("Likely Today") -->
        ${likelySectionHtml}
      </div>
    `;

    // Wire up "View all log" click
    $('#btnGoToLog')?.addEventListener('click', () => {
      switchTab('log');
    });

    // Wire up expand click on recent flight rows
    container.querySelectorAll('.flight-row-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        if (expandedFlightId === id) {
          expandedFlightId = null;
          item.classList.remove('expanded');
        } else {
          expandedFlightId = id;
          container.querySelectorAll('.flight-row-item').forEach(el => el.classList.remove('expanded'));
          item.classList.add('expanded');
        }
      });
    });

    return;
  }

  // Partition current flights into overhead and near you
  const overheadFlights = [];
  const nearFlights = [];

  for (const f of currentFlights) {
    const classification = f.passClassification || classifyPass(f, currentSettings);
    f.passClassification = classification;
    if (classification === 'overhead') {
      overheadFlights.push(f);
    } else {
      nearFlights.push(f);
    }
  }

  // Sort overhead flights:
  // Hero is soonest overhead flight (lowest valid eta)
  // For any further overhead flights: sorted by watchlist "special" first, then by ETA
  overheadFlights.sort((a, b) => {
    const aEta = (a.eta !== null && a.eta > 0) ? a.eta : 999999;
    const bEta = (b.eta !== null && b.eta > 0) ? b.eta : 999999;
    return aEta - bEta;
  });

  const hero = overheadFlights.length > 0 ? overheadFlights[0] : null;
  const furtherOverhead = overheadFlights.slice(1);
  furtherOverhead.sort((a, b) => {
    const aSpecial = a.alertStyle === 'special' || a.watchlistTag === 'RARE' || a.isWatchlist;
    const bSpecial = b.alertStyle === 'special' || b.watchlistTag === 'RARE' || b.isWatchlist;
    if (aSpecial && !bSpecial) return -1;
    if (!aSpecial && bSpecial) return 1;
    const aEta = (a.eta !== null && a.eta > 0) ? a.eta : 999999;
    const bEta = (b.eta !== null && b.eta > 0) ? b.eta : 999999;
    return aEta - bEta;
  });

  // Sort near flights by current distance
  nearFlights.sort((a, b) => {
    const aDist = a.distance != null ? a.distance : 999;
    const bDist = b.distance != null ? b.distance : 999;
    return aDist - bDist;
  });

  let html = '';

  if (hero) {
    const etaText = (hero.eta !== null && hero.eta > 0) ? formatETA(hero.eta) : '';
    const isUrgent = hero.eta !== null && hero.eta > 0 && hero.eta <= 60;
    const bearingVal = (typeof hero.bearingAtCpa === 'number' && !isNaN(hero.bearingAtCpa)) ? hero.bearingAtCpa : 0;
    const compassWord = bearingToCompass(bearingVal, false);
    const rawElev = hero.elevationAtCpa != null ? hero.elevationAtCpa : hero.currentElevation;
    const elev = (typeof rawElev === 'number' && !isNaN(rawElev)) ? Math.max(0, Math.round(rawElev)) : 25;
    const rel = getRelativeDirection(bearingVal, currentSettings.userFacing) || 'Ahead';
    const heroLogo = getAirlineMonogramBadge(hero);
    const heroVis = getFlightVisibilityInfo(hero);

    html += `
      <!-- Hero Inbound Block -->
      <div class="hero-block" data-hero-id="${hero.id}">
        <div class="hero-eyebrow mono">OVERHEAD IN</div>
        <div class="hero-countdown mono ${isUrgent ? 'overhead-urgent' : ''}" id="heroCountdownVal">${etaText}</div>

        <div class="hero-flight-name">
          ${heroLogo}
          <span class="airline-white">${esc(formatAirlineName(hero.airline, hero.callsign))}</span>
          <span class="flight-code-dim">${esc(hero.flightNumber || hero.callsign)}</span>${getWatchlistTagHtml(hero)}
        </div>

        <div class="hero-subline mono">
          ${esc(hero.origin || 'DEP')} → ${esc(hero.destination || 'ARR')}  ·  ${esc(hero.aircraftType || 'Aircraft')}  ·  ${(hero.altitude || 0).toLocaleString()} ft
        </div>

        <!-- Direction Look Widget -->
        <div class="hero-look-widget">
          <div class="compass-dial">
            <div class="compass-tick tick-n"></div>
            <div class="compass-tick tick-e"></div>
            <div class="compass-tick tick-s"></div>
            <div class="compass-tick tick-w"></div>
            <div class="compass-needle-arm" id="heroCompassNeedle" style="transform: rotate(${bearingVal}deg);">
              <div class="needle-tip-dot"></div>
              <div class="needle-line"></div>
              <div class="needle-pivot-dot"></div>
            </div>
          </div>

          <div class="look-meta-block">
            <div class="look-label mono">LOOK</div>
            <div class="look-angle-main mono" id="heroLookAngles">${compassWord}  ·  ${elev}°  up</div>
            <div class="look-relative-sub" id="heroLookRelative">${capitalize(rel)}</div>
          </div>
        </div>

        <!-- Optical Visibility Hint -->
        <div class="hero-visibility-hint mono">
          <span class="vis-indicator ${heroVis.contrast}"></span>
          <span class="vis-hint-text">${esc(heroVis.hint)}</span>
        </div>
      </div>
    `;

    if (furtherOverhead.length > 0) {
      html += `
        <div class="live-section-title mono">OVERHEAD</div>
        <div class="overhead-rows-list">
          ${furtherOverhead.map(f => buildOverheadFlightRowHtml(f)).join('')}
        </div>
      `;
    }
  } else {
    // If nothing is overhead, show no hero. Show a calm line "No overhead pass expected"
    html += `
      <div class="calm-overhead-line mono">No overhead pass expected</div>
    `;
  }

  // Section NEAR YOU: neutral styling, sorted by current distance
  if (nearFlights.length > 0) {
    html += `
      <div class="live-section-title mono">NEAR YOU</div>
      <div class="nearby-rows-list">
        ${nearFlights.map(f => buildNearFlightRowHtml(f)).join('')}
      </div>
    `;
  }

  // Learned Schedule Predictions ("Likely Today")
  html += likelySectionHtml;

  container.innerHTML = html;

  $$('.flight-row-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      if (expandedFlightId === id) {
        expandedFlightId = null;
        item.classList.remove('expanded');
      } else {
        expandedFlightId = id;
        $$('.flight-row-item').forEach(el => el.classList.remove('expanded'));
        item.classList.add('expanded');
      }
    });
  });
}

function getFlightVisibilityInfo(f) {
  if (f && f.visibilityHint) {
    return {
      hint: f.visibilityHint,
      contrast: f.visibilityContrast || 'high'
    };
  }
  const sunElev = calculateSunElevation(currentSettings.latitude, currentSettings.longitude, new Date());
  const res = classifyVisibility(f || {}, { sunElevation: sunElev, cloudData: { cloudCover: 10 } });
  return {
    hint: res.hint,
    contrast: res.contrast
  };
}

function buildOverheadFlightRowHtml(f) {
  const isExpanded = expandedFlightId === String(f.id);
  const etaText = (f.eta !== null && f.eta > 0) ? formatETA(f.eta) : '—';
  const logo = getAirlineMonogramBadge(f);
  const vis = getFlightVisibilityInfo(f);
  const dir = getDirectionWord(f.bearingAtCpa || 0);
  const distKm = Math.round(f.dCpa != null ? f.dCpa : (f.distance || 0));

  return `
    <div class="flight-row-item ${isExpanded ? 'expanded' : ''}" data-id="${f.id}">
      <div class="row-top-line">
        <div class="row-left-identity">
          ${logo}
          <div class="row-names">
            <span class="row-airline">${esc(formatAirlineName(f.airline, f.callsign))}</span>
            <span class="row-code">${esc(f.flightNumber || f.callsign)}</span>${getWatchlistTagHtml(f)}
          </div>
        </div>
        <div class="row-right-meta">
          <span class="row-countdown mono overhead-accent">${etaText}</span>
          <span class="row-chevron">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        </div>
      </div>
      <div class="row-subline mono">
        ${esc(formatOverheadRowSubline(f))}
      </div>

      <!-- Expandable Telemetry Drawer -->
      <div class="flight-inline-details">
        <div class="detail-cell">
          <span class="detail-k mono">ALTITUDE</span>
          <span class="detail-v mono">${(f.altitude || 0).toLocaleString()} ft</span>
        </div>
        <div class="detail-cell">
          <span class="detail-k mono">SPEED</span>
          <span class="detail-v mono">${f.speed || 0} kt</span>
        </div>
        <div class="detail-cell">
          <span class="detail-k mono">LOOK</span>
          <span class="detail-v mono">${bearingToCompass(f.bearingAtCpa || 0, false)} · ${Math.round(f.elevationAtCpa || 0)}°</span>
        </div>
        <div class="detail-cell">
          <span class="detail-k mono">PASS</span>
          <span class="detail-v mono">Overhead</span>
        </div>
        <div class="detail-visibility-bar mono">
          <span class="vis-indicator ${vis.contrast}"></span>
          <span>VISIBILITY: ${esc(vis.hint)}</span>
        </div>
      </div>
    </div>
  `;
}

function formatNearFlightStatus(f) {
  // If moving away or passed
  if (!f.isInbound || (f.tCpa != null && f.tCpa <= 0)) {
    return 'Moving away';
  }

  // If inbound with valid ETA
  if (f.eta !== null && f.eta > 0) {
    const cpaDist = Math.round(f.dCpa != null ? f.dCpa : f.distance);
    const dir = getDirectionWord(f.bearingAtCpa || 0);
    const etaStr = formatETA(f.eta);
    return `Closest ${cpaDist} km ${dir} in ${etaStr}`;
  }

  // Stationary / no ETA
  return `${Math.round(f.distance || 0)} km away`;
}

function buildNearFlightRowHtml(f) {
  const isExpanded = expandedFlightId === String(f.id);
  const statusText = formatNearFlightStatus(f);
  const logo = getAirlineMonogramBadge(f, { neutral: true });
  const vis = getFlightVisibilityInfo(f);
  const currentDist = Math.round(f.distance != null ? f.distance : 0);

  return `
    <div class="flight-row-item near-flight ${isExpanded ? 'expanded' : ''}" data-id="${f.id}">
      <div class="row-top-line">
        <div class="row-left-identity">
          ${logo}
          <div class="row-names">
            <span class="row-airline">${esc(formatAirlineName(f.airline, f.callsign))}</span>
            <span class="row-code">${esc(f.flightNumber || f.callsign)}</span>${getWatchlistTagHtml(f, { neutral: true })}
          </div>
        </div>
        <div class="row-right-meta">
          <span class="row-distance mono">${currentDist} km</span>
          <span class="row-chevron">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        </div>
      </div>
      <div class="row-subline mono">
        ${esc(f.aircraftType || 'Aircraft')}  ·  ${statusText}
      </div>

      <!-- Expandable Telemetry Drawer -->
      <div class="flight-inline-details">
        <div class="detail-cell">
          <span class="detail-k mono">ALTITUDE</span>
          <span class="detail-v mono">${(f.altitude || 0).toLocaleString()} ft</span>
        </div>
        <div class="detail-cell">
          <span class="detail-k mono">SPEED</span>
          <span class="detail-v mono">${f.speed || 0} kt</span>
        </div>
        <div class="detail-cell">
          <span class="detail-k mono">LOOK</span>
          <span class="detail-v mono">${bearingToCompass(f.bearingAtCpa || f.currentBearing || 0, false)} · ${Math.round(f.elevationAtCpa || f.currentElevation || 0)}°</span>
        </div>
        <div class="detail-cell">
          <span class="detail-k mono">PASS</span>
          <span class="detail-v mono">Near</span>
        </div>
        <div class="detail-visibility-bar mono">
          <span class="vis-indicator ${vis.contrast}"></span>
          <span>VISIBILITY: ${esc(vis.hint)}</span>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
//  SCREEN 3: Log View with Search & Filter
// ============================================================

async function renderLogView() {
  const container = $('#logListDeck');
  if (!container) return;

  const query = $('#logSearchInput') ? $('#logSearchInput').value.trim() : '';

  let logs = [];
  try {
    logs = await getFlightLogs({ query, sortBy: 'timestamp', sortOrder: 'desc', limit: 60 });
  } catch (err) {}

  // Apply Segment Filter
  if (currentLogFilter === 'overhead') {
    const thresh = currentSettings.overheadThresholdKm || 5;
    logs = logs.filter(r => (r.closestDistance != null ? r.closestDistance : 0) <= thresh);
  } else if (currentLogFilter === 'nearby') {
    const thresh = currentSettings.overheadThresholdKm || 5;
    logs = logs.filter(r => (r.closestDistance != null ? r.closestDistance : 0) > thresh);
  }

  // Update header text with filtered count
  const statusText = $('#sourceStatus');
  if (statusText && currentActiveTab === 'log') {
    statusText.textContent = `${logs.length} RECORD${logs.length === 1 ? '' : 'S'}`;
  }

  if (logs.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card" style="padding: 40px 0;">
        <div class="empty-title mono">No matching flights</div>
        <div class="empty-subline mono">Aircraft detected in your scope will log here automatically</div>
      </div>
    `;
    return;
  }

  container.innerHTML = logs.map(r => buildLogRowHtml(r)).join('');

  $$('.log-row-item').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      if (expandedLogId === id) {
        expandedLogId = null;
        row.classList.remove('expanded');
      } else {
        expandedLogId = id;
        $$('.log-row-item').forEach(el => el.classList.remove('expanded'));
        row.classList.add('expanded');
      }
    });
  });
}

function buildLogRowHtml(r) {
  const isExpanded = expandedLogId === String(r.id);
  const timeStr = r.timestamp ? formatLogTime(new Date(r.timestamp)) : '—';
  const cpaDist = r.closestDistance != null ? r.closestDistance : 0;
  const isOverhead = cpaDist <= (currentSettings.overheadThresholdKm || 5);
  const distStr = `${cpaDist.toFixed(1)} km`;
  const logo = getAirlineMonogramBadge(r);
  const displayAirline = formatAirlineName(r.airline, r.callsign || r.flightNumber, r.aircraftType);

  const routeStr = (r.origin && r.destination)
    ? `${r.origin} → ${r.destination} · ${r.aircraftType || 'Aircraft'}`
    : `${r.aircraftType || 'Aircraft'}`;
  const altStr = (r.altitude || 0).toLocaleString() + ' ft';
  const speedStr = (r.speed || 0) + ' kt';
  const lookStr = (r.azimuthAtCpa != null && r.elevationAtCpa != null)
    ? `${bearingToCompass(r.azimuthAtCpa, false)} · ${Math.round(r.elevationAtCpa)}°`
    : '—';
  const passStr = isOverhead ? 'Overhead' : 'Nearby';
  const vis = getFlightVisibilityInfo(r);

  return `
    <div class="log-row-item ${isExpanded ? 'expanded' : ''}" data-id="${r.id}">
      <div class="log-row-top">
        <div class="log-row-left">
          <span class="log-time mono">${timeStr}</span>
          <div class="log-identity">
            ${logo}
            <span class="log-airline-name" title="${esc(displayAirline)}">${esc(displayAirline)}</span>
            <span class="log-flight-code mono">${esc(r.flightNumber || r.callsign)}</span>${getWatchlistTagHtml(r)}
          </div>
        </div>
        <div class="row-right-meta">
          <span class="log-cpa-num mono ${isOverhead ? 'overhead-alert' : ''}">${distStr}</span>
          <span class="row-chevron">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        </div>
      </div>

      <div class="log-row-subline mono">
        ${esc(routeStr)}
      </div>

      <!-- 4-Cell Telemetry Grid -->
      <div class="flight-inline-details">
        <div class="detail-cell">
          <span class="detail-k mono">ALTITUDE</span>
          <span class="detail-v mono">${altStr}</span>
        </div>
        <div class="detail-cell">
          <span class="detail-k mono">SPEED</span>
          <span class="detail-v mono">${speedStr}</span>
        </div>
        <div class="detail-cell">
          <span class="detail-k mono">LOOK</span>
          <span class="detail-v mono">${lookStr}</span>
        </div>
        <div class="detail-cell">
          <span class="detail-k mono">PASS</span>
          <span class="detail-v mono">${passStr}</span>
        </div>
        <div class="detail-visibility-bar mono">
          <span class="vis-indicator ${vis.contrast}"></span>
          <span>VISIBILITY: ${esc(vis.hint)}</span>
        </div>
      </div>
    </div>
  `;
}

function formatLogTime(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// ============================================================
//  SCREEN 4: Stats & Analytics (Full Restoration)
// ============================================================

async function renderStatsView() {
  let stats;
  try {
    stats = await getFlightStats();
  } catch (err) {
    return;
  }

  const statTotal = $('#statTotalFlights');
  if (statTotal) statTotal.textContent = stats.totalFlights || 0;

  const statRatio = $('#statRatioSub');
  if (statRatio) statRatio.textContent = `${stats.internationalCount || 0} Int'l · ${stats.domesticCount || 0} Dom`;

  const { maxSimultaneousPlanes = 0, maxSimultaneousAt = null } = await chrome.storage.local.get(['maxSimultaneousPlanes', 'maxSimultaneousAt']);
  const statMax = $('#statMaxSimultaneous');
  if (statMax) statMax.textContent = maxSimultaneousPlanes || 0;

  const statMaxSub = $('#statMaxSimultaneousSub');
  if (statMaxSub) {
    if (maxSimultaneousAt) {
      const d = new Date(maxSimultaneousAt);
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayStr = dayNames[d.getDay()] || '';
      statMaxSub.textContent = `${dayStr} ${formatLogTime(d)}`;
    } else {
      statMaxSub.textContent = '—';
    }
  }

  const rarestCode = $('#statRarestCode');
  const rarestMeta = $('#statRarestMeta');
  const rarestBadge = $('#statRarestBadge');
  if (stats.rarestAircraft && stats.rarestAircraft.type) {
    if (rarestCode) rarestCode.textContent = stats.rarestAircraft.type;
    const seatsStr = stats.rarestAircraft.typicalSeats ? ` · ~${stats.rarestAircraft.typicalSeats} seats (est)` : '';
    if (rarestMeta) rarestMeta.textContent = `Unique airframe${seatsStr}`;
    if (rarestBadge) rarestBadge.textContent = `${stats.rarestAircraft.sightings} PASS${stats.rarestAircraft.sightings > 1 ? 'ES' : ''}`;
  } else {
    if (rarestCode) rarestCode.textContent = '—';
    if (rarestMeta) rarestMeta.textContent = 'Waiting for overhead passes';
    if (rarestBadge) rarestBadge.textContent = '0 PASS';
  }

  renderHourlyChart(stats.flightsPerHour || new Array(24).fill(0));
  renderRankBars('#topAirlinesList', stats.topAirlines || []);
  const combinedRoutes = [...(stats.topDestinations || []), ...(stats.topOrigins || [])].slice(0, 5);
  renderRankBars('#topRoutesList', combinedRoutes);
  renderRankBars('#aircraftBreakdownList', stats.aircraftBreakdown || []);

  // Fetch and render Collection (Life List)
  try {
    cachedLifeListStats = await getLifeListStats({
      includeNearby: currentCollectionScope === 'nearby',
      overheadThresholdKm: currentSettings.overheadThresholdKm || 5
    });
    renderCollectionDeck();
  } catch (e) {
    console.warn('Airvee: Failed to compute life list collection:', e);
  }

  // Fetch and render 24h x 7-day Traffic Heatmap (with Heartbeat Gaps)
  try {
    const allLogs = await getFlightLogs({ limit: 10000 });
    const { heartbeatGaps = [], activeHourBuckets = {} } = await chrome.storage.local.get(['heartbeatGaps', 'activeHourBuckets']);
    const heatmapData = computeHeatmapData(allLogs, { heartbeatGaps, activeHourBuckets }, Date.now());
    renderTrafficHeatmap(heatmapData);
  } catch (e) {
    console.warn('Airvee: Failed to compute traffic heatmap:', e);
  }
}

function formatCollectionDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (isToday) return `Today ${timeStr}`;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]}, ${timeStr}`;
}

function renderCollectionDeck() {
  const container = $('#collectionListDeck');
  if (!container) return;
  if (!cachedLifeListStats) {
    container.innerHTML = '<div class="collection-empty mono">Loading collection...</div>';
    return;
  }

  const { airlines = [], aircraftTypes = [], registrations = [] } = cachedLifeListStats;

  // Update badge counts on tabs
  const bAirlines = $('#badgeColAirlines');
  const bTypes = $('#badgeColTypes');
  const bRegs = $('#badgeColRegs');
  const totalCountEl = $('#collectionTotalCount');

  if (bAirlines) bAirlines.textContent = airlines.length;
  if (bTypes) bTypes.textContent = aircraftTypes.length;
  if (bRegs) bRegs.textContent = registrations.length;

  const totalUnique = airlines.length + aircraftTypes.length + registrations.length;
  if (totalCountEl) totalCountEl.textContent = `${totalUnique} unique entries`;

  let items = [];
  if (currentCollectionCat === 'airlines') {
    items = airlines;
  } else if (currentCollectionCat === 'types') {
    items = aircraftTypes;
  } else if (currentCollectionCat === 'registrations') {
    items = registrations;
  }

  if (items.length === 0) {
    const scopeLabel = currentCollectionScope === 'nearby' ? 'in scope' : 'overhead';
    container.innerHTML = `
      <div class="collection-empty mono">
        No ${currentCollectionCat} recorded ${scopeLabel} yet.
      </div>
    `;
    return;
  }

  let html = '';
  for (const item of items) {
    if (currentCollectionCat === 'airlines') {
      const logo = getAirlineMonogramBadge(item.name, item.name, item.icao);
      const displayAirline = formatAirlineName(item.name, '');
      const firstStr = formatCollectionDate(item.firstSeen);
      const lastStr = formatCollectionDate(item.lastSeen);
      html += `
        <div class="collection-item-row" data-term="${esc(item.name)}">
          <div class="col-item-left">
            ${logo}
            <div class="col-item-names">
              <div class="col-item-title-row">
                <span class="col-item-name">${esc(displayAirline)}</span>
                ${item.icao ? `<span class="col-item-tag mono">${esc(item.icao)}</span>` : ''}
              </div>
              <span class="col-item-dates mono">First: ${firstStr} · Last: ${lastStr}</span>
            </div>
          </div>
          <div class="col-item-right">
            <span class="col-item-count mono">${item.count}×</span>
            <span class="col-item-chevron">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </div>
        </div>
      `;
    } else if (currentCollectionCat === 'types') {
      const firstStr = formatCollectionDate(item.firstSeen);
      const lastStr = formatCollectionDate(item.lastSeen);
      const seatsStr = item.typicalSeats ? ` · ~${item.typicalSeats} seats` : '';
      const typeBadge = `<span class="airline-monogram-badge" style="color:var(--accent); border-color:rgba(255, 90, 31, 0.3); background:rgba(255, 90, 31, 0.05);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.3c.4-.2.6-.6.5-1.1z"/></svg></span>`;
      html += `
        <div class="collection-item-row" data-term="${esc(item.name)}">
          <div class="col-item-left">
            ${typeBadge}
            <div class="col-item-names">
              <div class="col-item-title-row">
                <span class="col-item-name mono" style="font-weight:600; color:var(--accent);">${esc(item.name)}</span>
                <span class="col-item-tag mono">${seatsStr}</span>
              </div>
              <span class="col-item-dates mono">First: ${firstStr} · Last: ${lastStr}</span>
            </div>
          </div>
          <div class="col-item-right">
            <span class="col-item-count mono">${item.count}×</span>
            <span class="col-item-chevron">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </div>
        </div>
      `;
    } else if (currentCollectionCat === 'registrations') {
      const firstStr = formatCollectionDate(item.firstSeen);
      const lastStr = formatCollectionDate(item.lastSeen);
      const contextStr = [item.aircraftType, formatAirlineName(item.airline, '')].filter(Boolean).join(' · ');
      const regBadge = getAirlineMonogramBadge(item.airline || '', item.airline || '', item.airlineIcao || '');
      html += `
        <div class="collection-item-row" data-term="${esc(item.name)}">
          <div class="col-item-left">
            ${regBadge}
            <div class="col-item-names">
              <div class="col-item-title-row">
                <span class="col-item-name mono" style="font-weight:600;">${esc(item.name)}</span>
                ${contextStr ? `<span class="col-item-tag mono">${esc(contextStr)}</span>` : ''}
              </div>
              <span class="col-item-dates mono">First: ${firstStr} · Last: ${lastStr}</span>
            </div>
          </div>
          <div class="col-item-right">
            <span class="col-item-count mono">${item.count}×</span>
            <span class="col-item-chevron">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </div>
        </div>
      `;
    }
  }

  container.innerHTML = html;

  // Attach click handler on every row: jumps to Log tab filtered to this term!
  container.querySelectorAll('.collection-item-row').forEach(row => {
    row.addEventListener('click', () => {
      const term = row.dataset.term;
      if (term) {
        filterLogByCollectionItem(term);
      }
    });
  });
}

function filterLogByCollectionItem(term) {
  switchTab('log');
  const input = $('#logSearchInput');
  const clearBtn = $('#logSearchClear');
  if (input) {
    input.value = term;
    if (clearBtn) clearBtn.style.display = 'flex';
  }
  renderLogView();
}

function buildLikelyTodaySectionHtml(predictions) {
  if (!predictions || predictions.length === 0) {
    return '';
  }

  const content = predictions.map(p => {
      const logo = getAirlineMonogramBadge(p);
      const isPassed = p.hasPassedToday;
      let statusTag = '';
      if (isPassed) {
        statusTag = `<span class="likely-status passed-tag mono">PASSED TODAY</span>`;
      } else if (p.etaLabel) {
        statusTag = `<span class="likely-status upcoming-tag mono">${p.etaLabel}</span>`;
      } else if (p.isOverdue) {
        statusTag = `<span class="likely-status passed-tag mono">WINDOW ELAPSED</span>`;
      } else {
        statusTag = `<span class="likely-status upcoming-tag mono">SCHEDULED</span>`;
      }

      return `
        <div class="likely-row ${isPassed ? 'passed' : ''}">
          <div class="likely-time-col">
            <span class="likely-window mono">${esc(p.windowStr)}</span>
            ${statusTag}
          </div>
          <div class="likely-flight-col">
            <div class="likely-flight-line">
              ${logo}
              <span class="likely-airline">${esc(formatAirlineName(p.airline, p.flightNumber))}</span>
              <span class="likely-fn mono ${isPassed ? 'strikethrough' : ''}">${esc(p.flightNumber)}</span>
              <span class="likely-type mono">${esc(p.aircraftType)}</span>
            </div>
            <div class="likely-route-line mono">
              ${esc(p.route)} · <span class="likely-conf">${esc(p.confidenceStr)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  const badgeCount = (predictions && predictions.length > 0) ? `${predictions.length} PREDICTED` : 'LEARNED SCHEDULE';

  return `
    <div class="likely-today-section" id="likelyTodaySection">
      <div class="likely-header">
        <span class="likely-title mono">LIKELY TODAY</span>
        <span class="likely-sub mono">${badgeCount}</span>
      </div>
      <div class="likely-deck">
        ${content}
      </div>
    </div>
  `;
}

function renderTrafficHeatmap(heatmapData) {
  const container = $('#heatmapSvgContainer');
  const tooltip = $('#heatmapTooltip');
  const summarySub = $('#heatmapSummarySub');
  if (!container || !heatmapData) return;

  const { grid = [], maxCount = 0, totalPasses = 0, dayNames = [] } = heatmapData;

  if (summarySub) {
    summarySub.textContent = `${totalPasses} pass${totalPasses === 1 ? '' : 'es'} in last 7 days`;
  }

  const width = 340;
  const height = 98;
  const originX = 28;
  const originY = 14;
  const cellWidth = 11;
  const cellHeight = 9.5;
  const gap = 1.8;

  // Header Hours
  const hourLabels = [0, 4, 8, 12, 16, 20].map(h => {
    const x = originX + h * (cellWidth + gap) + 4;
    const label = String(h).padStart(2, '0');
    return `<text x="${x.toFixed(1)}" y="9" font-family="Martian Mono, monospace" font-size="8" fill="#71717A" text-anchor="middle">${label}</text>`;
  }).join('');

  // Day Row Labels & Cells
  let svgContent = `
    <defs>
      <pattern id="gapHatch" width="4" height="4" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="4" stroke="rgba(255, 255, 255, 0.18)" stroke-width="1" />
      </pattern>
    </defs>
    ${hourLabels}
  `;

  for (let d = 0; d < 7; d++) {
    const y = originY + d * (cellHeight + gap);
    const dayLabel = dayNames[d] || 'DAY';
    svgContent += `<text x="2" y="${(y + 7.5).toFixed(1)}" font-family="Martian Mono, monospace" font-size="8" fill="#71717A">${dayLabel}</text>`;

    for (let h = 0; h < 24; h++) {
      const cell = grid[d][h];
      const x = originX + h * (cellWidth + gap);

      let fill = 'rgba(255, 255, 255, 0.04)';
      let stroke = 'rgba(255, 255, 255, 0.06)';

      if (cell.isGap) {
        fill = 'url(#gapHatch)';
        stroke = 'rgba(255, 255, 255, 0.12)';
      } else if (cell.count > 0) {
        if (cell.count === maxCount && maxCount > 1) {
          fill = '#FF5A1F';
          stroke = 'rgba(255, 90, 31, 0.6)';
        } else {
          const ratio = cell.count / Math.max(maxCount, 1);
          const opacity = Math.min(0.9, Math.max(0.2, ratio * 0.85));
          fill = `rgba(250, 250, 250, ${opacity.toFixed(2)})`;
          stroke = 'transparent';
        }
      }

      svgContent += `
        <rect class="heatmap-cell" x="${x.toFixed(1)}" y="${y.toFixed(1)}"
              width="${cellWidth}" height="${cellHeight}" rx="2" ry="2"
              fill="${fill}" stroke="${stroke}" stroke-width="1"
              data-day="${dayLabel}" data-hour="${h}" data-count="${cell.count}"
              data-gap="${cell.isGap ? esc(cell.gapText) : ''}">
        </rect>
      `;
    }
  }

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%">${svgContent}</svg>`;

  // Tooltip handlers
  container.querySelectorAll('.heatmap-cell').forEach(rect => {
    rect.addEventListener('mouseenter', () => {
      const day = rect.dataset.day;
      const h = String(rect.dataset.hour).padStart(2, '0');
      const count = rect.dataset.count;
      const gap = rect.dataset.gap;

      if (tooltip) {
        if (gap) {
          tooltip.textContent = `${day} ${h}:00 · ${gap}`;
        } else {
          tooltip.textContent = `${day} ${h}:00 · ${count} pass${count === '1' ? '' : 'es'}`;
        }
        tooltip.style.display = 'block';
      }
    });

    rect.addEventListener('mouseleave', () => {
      if (tooltip) tooltip.style.display = 'none';
    });
  });
}

function renderHourlyChart(hoursArray) {
  const container = $('#hourlyChartContainer');
  const tooltip = $('#statsChartTooltip');
  if (!container) return;
  const maxVal = Math.max(...hoursArray, 1);
  const peakHour = hoursArray.indexOf(Math.max(...hoursArray));

  const peakTag = $('#statPeakHourTag');
  if (peakTag) {
    peakTag.textContent = maxVal > 1 ? `Peak: ${String(peakHour).padStart(2, '0')}:00 (${maxVal} planes)` : 'Peak: —';
  }

  const width = 340;
  const height = 80;
  const barWidth = 9;
  const gap = (width - (24 * barWidth)) / 23;

  const bars = hoursArray.map((count, hour) => {
    const barHeight = Math.max(3, (count / maxVal) * (height - 20));
    const x = hour * (barWidth + gap);
    const y = height - 16 - barHeight;
    const isPeak = count === maxVal && maxVal > 0;
    const fillColor = isPeak ? '#FF5A1F' : count > 0 ? '#FFFFFF' : 'rgba(255, 255, 255, 0.08)';

    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth}" height="${barHeight.toFixed(1)}" rx="2" fill="${fillColor}"
            data-hour="${hour}" data-count="${count}">
      </rect>
    `;
  }).join('');

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%">${bars}</svg>`;

  // Attach interactive tooltip handlers
  container.querySelectorAll('rect').forEach(rect => {
    rect.addEventListener('mouseenter', () => {
      const h = rect.dataset.hour;
      const c = rect.dataset.count;
      if (tooltip) {
        tooltip.textContent = `${String(h).padStart(2, '0')}:00 · ${c} flight${c === '1' ? '' : 's'}`;
        tooltip.style.display = 'block';
      }
    });
    rect.addEventListener('mouseleave', () => {
      if (tooltip) tooltip.style.display = 'none';
    });
  });
}

function renderRankBars(containerSel, items) {
  const container = $(containerSel);
  if (!container) return;
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="mono" style="font-size:11px; color:var(--text-tertiary); padding:4px 0;">No records yet</div>';
    return;
  }
  const maxCount = Math.max(...items.map(i => i.count), 1);
  container.innerHTML = items.map(item => {
    const pct = Math.max(8, Math.round((item.count / maxCount) * 100));
    return `
      <div class="rank-bar-row">
        <div class="rank-bar-labels">
          <span class="mono" style="color:#FFF;">${esc(item.name)}</span>
          <span class="mono" style="color:#A1A1AA;">${item.count}</span>
        </div>
        <div class="rank-track"><div class="rank-fill" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
}

// ============================================================
//  Tab Switching & Radar Engine Initialization
// ============================================================

export async function switchTab(tabName) {
  currentActiveTab = tabName;

  $$('.main-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  updateNavIndicator();
  updateCockpitHeader(tabName);

  const views = {
    live: $('#viewLive'),
    radar: $('#viewRadar'),
    log: $('#viewLog'),
    stats: $('#viewStats'),
    settings: $('#viewSettings')
  };

  Object.entries(views).forEach(([name, el]) => {
    if (el) el.classList.toggle('active', name === tabName);
  });

  if (tabName === 'radar') {
    initOrUpdateRadar();
  } else if (popupRadarScope) {
    popupRadarScope.stop();
  }

  if (tabName === 'log') {
    await renderLogView();
  } else if (tabName === 'stats') {
    await renderStatsView();
  } else if (tabName === 'settings') {
    renderSettings();
  }
}

function initOrUpdateRadar() {
  const canvas = $('#radarCanvas');
  if (!canvas) return;

  if (!popupRadarScope) {
    popupRadarScope = new RadarScope(canvas, {
      maxRadiusKm: currentSettings.radiusKm,
      userFacing: currentSettings.userFacing || 'S',
      orientation: currentSettings.radarOrientation || 'facing_up',
      units: 'km',
      onSelectFlight: (flight) => renderRadarSelectedTarget(flight)
    });
  } else {
    popupRadarScope.setOptions({
      maxRadiusKm: currentSettings.radiusKm,
      userFacing: currentSettings.userFacing || 'S',
      orientation: currentSettings.radarOrientation || 'facing_up'
    });
    popupRadarScope._setupCanvas();
  }

  popupRadarScope.setFlights(currentFlights);
  popupRadarScope.start();
}

function renderRadarSelectedTarget(flight) {
  const box = $('#radarSelectedTarget');
  if (!box) return;

  if (!flight) {
    box.style.display = 'block';
    box.innerHTML = '<div class="radar-scope-hint mono">Tap any blip to lock target &amp; inspect telemetry</div>';
    return;
  }

  box.style.display = 'block';
  const cpaLabel = flight.passesOverhead ? 'OVERHEAD' : 'NEARBY';
  const etaText = flight.eta ? formatETA(flight.eta) : '—';
  const logo = getAirlineMonogramBadge(flight);

  box.innerHTML = `
    <div class="radar-hud-card">
      <div class="hud-top-line">
        <div class="hud-identity">
          ${logo}
          <div>
            <span class="hud-callsign mono">${esc(flight.flightNumber || flight.callsign)}</span>
            <span class="hud-airline">${esc(flight.airline || '')}</span>
          </div>
        </div>
        <div class="hud-actions">
          <span class="hud-badge mono ${flight.passesOverhead ? 'overhead' : ''}">${cpaLabel}</span>
          <button class="hud-close-btn" id="btnCloseRadarTarget" title="Close">✕</button>
        </div>
      </div>
      <div class="hud-telemetry-grid">
        <div class="hud-cell">
          <span class="hud-k mono">ALT</span>
          <span class="hud-v mono">${flight.altitude ? flight.altitude.toLocaleString() + ' ft' : '—'}</span>
        </div>
        <div class="hud-cell">
          <span class="hud-k mono">SPEED</span>
          <span class="hud-v mono">${flight.speed ? flight.speed + ' kt' : '—'}</span>
        </div>
        <div class="hud-cell">
          <span class="hud-k mono">DIST</span>
          <span class="hud-v mono">${flight.distance != null ? flight.distance + ' km' : '—'}</span>
        </div>
        <div class="hud-cell">
          <span class="hud-k mono">ETA</span>
          <span class="hud-v mono">${etaText}</span>
        </div>
      </div>
    </div>
  `;

  $('#btnCloseRadarTarget')?.addEventListener('click', () => {
    box.style.display = 'none';
    if (popupRadarScope) popupRadarScope.setSelectedFlight(null);
  });
}

// ============================================================
//  Utilities
// ============================================================

function formatETA(seconds) {
  if (seconds < 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getDirectionWord(deg) {
  if (deg == null) return '';
  const compass = bearingToCompass(deg, false).toLowerCase();
  const map = {
    n: 'north', ne: 'northeast', e: 'east', se: 'southeast',
    s: 'south', sw: 'southwest', w: 'west', nw: 'northwest'
  };
  return map[compass] || compass;
}

function timeAgo(ms) {
  if (!ms) return '';
  const sec = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}


function formatAirlineName(airline, callsign, aircraftType = '') {
  const cs = String(callsign || '').trim().toUpperCase();
  const rawAir = String(airline || '').trim();
  const type = String(aircraftType || '').trim().toUpperCase();
  const mockFlight = { airline: rawAir, callsign: cs, aircraftType: type };

  // 1. Military aircraft check
  if (isMilitaryAircraft(mockFlight)) {
    if (cs.startsWith('RCH') || cs.startsWith('REACH')) return 'USAF Air Mobility';
    if (cs.startsWith('TREK') || cs.startsWith('MOOSE') || cs.startsWith('JAKE') || cs.startsWith('TOPCAT')) return 'USAF Transport';
    if (cs.startsWith('PAT')) return 'US Army Aviation';
    if (cs.startsWith('RRR') || cs.startsWith('ASCOT')) return 'Royal Air Force';
    if (cs.startsWith('ASY')) return 'Royal Australian Air Force';
    if (cs.startsWith('CFC') || cs.startsWith('CANFORCE')) return 'Canadian Armed Forces';
    if (cs.startsWith('GAF')) return 'German Air Force';
    if (cs.startsWith('FAF')) return 'French Air Force';
    if (cs.startsWith('IAM')) return 'Italian Air Force';
    if (cs.startsWith('IFC')) return 'Indian Air Force';
    if (rawAir && !rawAir.toLowerCase().includes('unknown')) return rawAir;
    return 'Military Transport';
  }

  // 2. Civilian Cargo check
  if (isCargoAircraft(mockFlight)) {
    if (rawAir && !rawAir.toLowerCase().includes('unknown')) return rawAir;
    if (cs.startsWith('FDX')) return 'FedEx Express';
    if (cs.startsWith('UPS')) return 'UPS Airlines';
    if (cs.startsWith('CLX')) return 'Cargolux';
    if (cs.startsWith('GTI')) return 'Atlas Air';
    return 'Civilian Freight';
  }

  if (!rawAir || rawAir === 'Unknown Airline' || rawAir.toLowerCase().includes('unknown')) {
    if (cs.startsWith('VT') || cs.startsWith('N') || cs.startsWith('G-') || cs.startsWith('F-') || cs.startsWith('D-') || cs.startsWith('A6-')) {
      const regClean = cs.startsWith('VT') && !cs.startsWith('VT-') ? 'VT-' + cs.slice(2) : cs;
      return `${regClean} · Private`;
    }
    if (type && isInherentlyRare(type)) {
      return 'Special Airframe';
    }
    return 'General Aviation';
  }
  return rawAir;
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ============================================================
//  Watchlist UI & Rules Manager
// ============================================================

function bindWatchlistEvents() {
  $('#rowWatchlistEditor')?.addEventListener('click', () => {
    $('#watchlistModal').style.display = 'flex';
    renderWatchlistRules();
  });

  $('#btnCloseWatchlistModal')?.addEventListener('click', () => {
    $('#watchlistModal').style.display = 'none';
  });

  $('#rowRareThreshold')?.addEventListener('click', () => {
    const current = currentSettings.rareSeenThreshold || 2;
    const input = prompt('Enter sighting threshold for "Rare for me" (1 - 20 passes):', current);
    const val = parseInt(input, 10);
    if (!isNaN(val) && val >= 1 && val <= 20) {
      currentSettings.rareSeenThreshold = val;
      saveSettings();
      renderSettings();
      refreshFlights();
    }
  });

  $('#btnAddNewRule')?.addEventListener('click', () => {
    openRuleEditor(null);
  });

  $('#btnCloseRuleEditModal')?.addEventListener('click', () => {
    $('#ruleEditModal').style.display = 'none';
  });

  $('#btnCancelRule')?.addEventListener('click', () => {
    $('#ruleEditModal').style.display = 'none';
  });

  $('#btnSaveRule')?.addEventListener('click', () => {
    saveRuleFromEditor();
  });

  $('#btnTestRule')?.addEventListener('click', () => {
    const ruleData = getRuleFormData();
    chrome.runtime.sendMessage({
      type: 'TEST_WATCHLIST_RULE',
      rule: ruleData
    }).catch(() => {});
  });
}

function renderWatchlistRules() {
  const container = $('#watchlistRulesList');
  if (!container) return;

  const rules = currentSettings.watchlistRules || [];
  if (rules.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card" style="padding: 40px 0;">
        <div class="empty-title mono" style="font-size:14px;">No rules yet</div>
        <div class="empty-subline mono">Add rules to alert when rare aircraft or specific types/airlines pass overhead.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = rules.map((r, idx) => {
    const criteria = [];
    if (r.aircraftType) criteria.push(r.aircraftType);
    if (r.airline) criteria.push(r.airline);
    if (r.registration) criteria.push(r.registration);
    if (r.callsignPrefix) criteria.push(r.callsignPrefix + '*');
    if (r.cargoFilter && r.cargoFilter !== 'any') criteria.push(r.cargoFilter === 'cargo_only' ? 'Cargo' : 'Pax');
    if (r.rareOnly) criteria.push('Rare only');
    if (r.overheadThresholdKm) criteria.push(`${r.overheadThresholdKm}km`);

    const summaryText = criteria.length > 0 ? criteria.join(' · ') : 'All flights';
    const isChecked = r.enabled !== false;
    const styleClass = r.alertStyle === 'special' ? 'special' : '';

    return `
      <div class="watchlist-rule-card" data-idx="${idx}">
        <div class="rule-info">
          <div class="rule-name-row">
            <span class="rule-name">${esc(r.name || 'Rule')}</span>
            <span class="rule-style-badge ${styleClass} mono">${esc(r.alertStyle || 'normal')}</span>
          </div>
          <span class="rule-summary mono">${esc(summaryText)}</span>
        </div>
        <div class="rule-actions">
          <label class="ios-switch" style="width:34px; height:20px;">
            <input type="checkbox" class="rule-toggle-checkbox" data-idx="${idx}" ${isChecked ? 'checked' : ''}>
            <span class="ios-track"></span>
          </label>
          <button class="btn-icon-rule btn-edit-rule mono" data-idx="${idx}" title="Edit">✎</button>
          <button class="btn-icon-rule btn-del-rule mono" data-idx="${idx}" title="Delete">✕</button>
        </div>
      </div>
    `;
  }).join('');

  // Attach card action listeners
  container.querySelectorAll('.rule-toggle-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const idx = parseInt(cb.dataset.idx, 10);
      if (currentSettings.watchlistRules[idx]) {
        currentSettings.watchlistRules[idx].enabled = e.target.checked;
        saveSettings();
        renderSettings();
        refreshFlights();
      }
    });
  });

  container.querySelectorAll('.btn-edit-rule').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const r = currentSettings.watchlistRules[idx];
      if (r) openRuleEditor({ ...r, _editIdx: idx });
    });
  });

  container.querySelectorAll('.btn-del-rule').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      if (confirm('Delete this watchlist rule?')) {
        currentSettings.watchlistRules.splice(idx, 1);
        saveSettings();
        renderWatchlistRules();
        renderSettings();
        refreshFlights();
      }
    });
  });
}

function openRuleEditor(rule) {
  const modal = $('#ruleEditModal');
  if (!modal) return;

  $('#ruleEditModalTitle').textContent = rule ? 'EDIT RULE' : 'NEW WATCHLIST RULE';
  $('#ruleEditId').value = rule ? (rule._editIdx != null ? rule._editIdx : '') : '';
  $('#ruleNameInput').value = rule ? (rule.name || '') : '';
  $('#ruleTypeInput').value = rule ? (rule.aircraftType || '') : '';
  $('#ruleAirlineInput').value = rule ? (rule.airline || '') : '';
  $('#ruleRegInput').value = rule ? (rule.registration || '') : '';
  $('#rulePrefixInput').value = rule ? (rule.callsignPrefix || '') : '';
  $('#ruleCargoSelect').value = rule ? (rule.cargoFilter || 'any') : 'any';
  $('#ruleAlertStyleSelect').value = rule ? (rule.alertStyle || 'special') : 'special';
  $('#ruleRareOnlyCheckbox').checked = rule ? Boolean(rule.rareOnly) : false;
  $('#ruleQuietHoursCheckbox').checked = rule ? Boolean(rule.ignoreQuietHours) : false;
  $('#ruleThresholdInput').value = (rule && rule.overheadThresholdKm != null) ? rule.overheadThresholdKm : '';

  modal.style.display = 'flex';
}

function getRuleFormData() {
  const threshVal = parseInt($('#ruleThresholdInput').value, 10);
  return {
    id: 'rule_' + Date.now(),
    name: $('#ruleNameInput').value.trim() || 'Custom Rule',
    aircraftType: $('#ruleTypeInput').value.trim(),
    airline: $('#ruleAirlineInput').value.trim(),
    registration: $('#ruleRegInput').value.trim(),
    callsignPrefix: $('#rulePrefixInput').value.trim(),
    cargoFilter: $('#ruleCargoSelect').value,
    alertStyle: $('#ruleAlertStyleSelect').value,
    rareOnly: $('#ruleRareOnlyCheckbox').checked,
    ignoreQuietHours: $('#ruleQuietHoursCheckbox').checked,
    overheadThresholdKm: (!isNaN(threshVal) && threshVal > 0) ? threshVal : null,
    enabled: true
  };
}

function saveRuleFromEditor() {
  const editIdxStr = $('#ruleEditId').value;
  const ruleData = getRuleFormData();

  if (!ruleData.name) {
    alert('Please enter a rule name.');
    return;
  }

  if (!currentSettings.watchlistRules) {
    currentSettings.watchlistRules = [];
  }

  if (editIdxStr !== '' && !isNaN(parseInt(editIdxStr, 10))) {
    const idx = parseInt(editIdxStr, 10);
    currentSettings.watchlistRules[idx] = {
      ...currentSettings.watchlistRules[idx],
      ...ruleData
    };
  } else {
    currentSettings.watchlistRules.push(ruleData);
  }

  saveSettings();
  $('#ruleEditModal').style.display = 'none';
  renderWatchlistRules();
  renderSettings();
  refreshFlights();
}


function getWatchlistTagHtml(flight, options = {}) {
  if (!flight) return '';
  const badges = [];
  const isNeutral = Boolean(options.neutral);

  if (flight.isNew) {
    badges.push(`<span class="badge-watchlist mono ${isNeutral ? 'neutral' : 'new'}" title="First time seen: ${esc(flight.newLabel || flight.registration || '')}">NEW</span>`);
  }

  if (flight.watchlistTag) {
    const isRare = flight.watchlistTag === 'RARE';
    const tagClass = isNeutral ? 'neutral' : (isRare ? 'rare' : 'watch');
    badges.push(`<span class="badge-watchlist mono ${tagClass}">${flight.watchlistTag}</span>`);
  } else {
    // Check dynamically if matches any rule
    const rules = currentSettings.watchlistRules || [];
    if (rules.length > 0) {
      const match = evaluateFlightWatchlist(flight, rules, {
        rareSeenThreshold: currentSettings.rareSeenThreshold || 2,
        inherentlyRareList: DEFAULT_INHERENTLY_RARE_TYPES,
        globalOverheadThresholdKm: currentSettings.overheadThresholdKm || 5
      });
      if (match) {
        const isRare = match.tag === 'RARE';
        const tagClass = isNeutral ? 'neutral' : (isRare ? 'rare' : 'watch');
        badges.push(`<span class="badge-watchlist mono ${tagClass}">${match.tag}</span>`);
      }
    } else if (flight.aircraftType && isInherentlyRare(flight.aircraftType)) {
      badges.push(`<span class="badge-watchlist mono ${isNeutral ? 'neutral' : 'rare'}">RARE</span>`);
    }
  }

  return badges.join('');
}


function buildRecentLogRowHtml(r) {
  const isExpanded = expandedFlightId === String(r.id);
  const timeStr = r.timestamp ? timeAgo(r.timestamp) : '—';
  const cpaDist = r.closestDistance != null ? r.closestDistance : 0;
  const isOverhead = cpaDist <= (currentSettings.overheadThresholdKm || 5);
  const distStr = `${cpaDist.toFixed(1)} km`;
  const logo = getAirlineMonogramBadge(r);
  const displayAirline = formatAirlineName(r.airline, r.callsign);

  const routeStr = (r.origin && r.destination && r.origin !== '—')
    ? `${r.origin} → ${r.destination} · ${r.aircraftType || 'Aircraft'} · ${distStr} pass`
    : `${r.aircraftType || 'Aircraft'} · ${distStr} pass`;

  const altStr = (r.altitude || 0).toLocaleString() + ' ft';
  const speedStr = (r.speed || 0) + ' kt';
  const lookStr = (r.azimuthAtCpa != null && r.elevationAtCpa != null)
    ? `${bearingToCompass(r.azimuthAtCpa, false)} · ${Math.round(r.elevationAtCpa)}°`
    : '—';
  const passStr = isOverhead ? 'Overhead' : 'Nearby';
  const vis = getFlightVisibilityInfo(r);

  return `
    <div class="flight-row-item ${isExpanded ? 'expanded' : ''}" data-id="${r.id}">
      <div class="row-top-line">
        <div class="row-left-identity">
          ${logo}
          <div class="row-names">
            <span class="row-airline">${esc(displayAirline)}</span>
            <span class="row-code">${esc(r.flightNumber || r.callsign)}</span>${getWatchlistTagHtml(r)}
          </div>
        </div>
        <div class="row-right-meta">
          <span class="row-countdown mono" style="color:var(--text-secondary); font-size:11px;">${timeStr}</span>
          <span class="row-chevron">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        </div>
      </div>
      <div class="row-subline mono">
        ${esc(routeStr)}
      </div>

      <!-- Expandable Telemetry Grid -->
      <div class="flight-inline-details">
        <div class="detail-cell">
          <span class="detail-k mono">ALTITUDE</span>
          <span class="detail-v mono">${altStr}</span>
        </div>
        <div class="detail-cell">
          <span class="detail-k mono">SPEED</span>
          <span class="detail-v mono">${speedStr}</span>
        </div>
        <div class="detail-cell">
          <span class="detail-k mono">LOOK</span>
          <span class="detail-v mono">${lookStr}</span>
        </div>
        <div class="detail-cell">
          <span class="detail-k mono">PASS</span>
          <span class="detail-v mono">${passStr}</span>
        </div>
        <div class="detail-visibility-bar mono">
          <span class="vis-indicator ${vis.contrast}"></span>
          <span>VISIBILITY: ${esc(vis.hint)}</span>
        </div>
      </div>
    </div>
  `;
}
