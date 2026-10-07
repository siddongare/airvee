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
import { playAirportDoubleChime, playSpecialAlertChime, playWavFallbackChime } from './lib/audio.js';
import {
  AIRLINES,
  AIRCRAFT_TYPES,
  CATEGORIES,
  DIRECTIONS,
  AIRLINE_GROUPS,
  PRESETS,
  formatRuleSentence,
  generateRuleNameFromConditions,
  lookupAirline,
  lookupAircraftType,
  getAirlineDisplayName,
  getAircraftDisplayName
} from './lib/names.js';
import { evaluateAlertRules } from './lib/alerts.js';
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
import {
  getDiagnosticPolls,
  clearDiagnosticPolls,
  verifyRedaction,
  generateDiagnosticsSummary,
  migrateDiagnosticsStorage
} from './lib/diagnostics.js';
import { evaluateAircraft } from './lib/filter.js';
import {
  DEFAULTS,
  migrateSettings,
  SCHEMA_VERSION
} from './lib/settings-defaults.js';

export { migrateSettings, DEFAULTS, SCHEMA_VERSION };

export function formatHeroLook(bearingVal, elevationVal, userFacing) {
  const elev = (typeof elevationVal === 'number' && !isNaN(elevationVal)) ? Math.max(0, Math.round(elevationVal)) : 25;
  if (elev >= 80) {
    return { anglesText: 'Straight up', relText: '' };
  }
  const compassWord = bearingToCompass(bearingVal, false);
  const anglesText = `${compassWord}  ·  ${elev}°  up`;
  const rel = userFacing ? getRelativeDirection(bearingVal, userFacing) : null;
  const relText = rel ? capitalize(rel) : '';
  return { anglesText, relText };
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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

function renderErrorFallback(err) {
  const container = document.querySelector('.popup-viewport') || document.body;
  const existing = document.getElementById('initErrorFallback');
  if (existing) existing.remove();

  const fallback = document.createElement('div');
  fallback.id = 'initErrorFallback';
  fallback.className = 'init-error-panel mono';
  fallback.style.cssText = 'margin:16px; padding:14px; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); border-radius:8px; color:#FCA5A5; font-size:11px; line-height:1.5; z-index:9999;';
  fallback.innerHTML = `
    <div style="font-weight:600; margin-bottom:6px; color:#EF4444;">Something went wrong loading this view</div>
    <div style="opacity:0.85; word-break:break-word;">${esc(err?.message || String(err))}</div>
  `;
  container.prepend(fallback);
}

function bindTabNavigation() {
  $$('.main-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Attach tab navigation handlers FIRST so user can always switch tabs
  try {
    bindTabNavigation();
  } catch (err) {
    console.error('Airvee: Failed to bind tab navigation:', err);
  }

  // 2. Load settings
  try {
    await loadSettings();
  } catch (err) {
    console.error('Airvee: Failed to load settings:', err);
    renderErrorFallback(err);
  }

  // 3. Render settings controls
  try {
    renderSettings();
  } catch (err) {
    console.error('Airvee: Failed to render settings:', err);
  }

  // 4. Bind interactive inputs and controls
  try {
    bindEvents();
  } catch (err) {
    console.error('Airvee: Failed to bind controls:', err);
  }

  // 5. Initial flight list refresh
  try {
    await refreshFlights();
  } catch (err) {
    console.error('Airvee: Failed to refresh flights:', err);
    renderErrorFallback(err);
  }

  // 6. Header and nav indicator update
  try {
    updateCockpitHeader(currentActiveTab);
    updateNavIndicator();
  } catch (err) {
    console.error('Airvee: Failed to update header/nav:', err);
  }

  // Poll update every 8 seconds
  pollInterval = setInterval(() => {
    refreshFlights().catch(err => console.error('Airvee: Polling error:', err));
  }, 8000);

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
  countdownInterval = setInterval(() => {
    try {
      tickCountdowns();
    } catch (err) {
      console.error('Airvee: Countdown ticker error:', err);
    }
  }, 1000);
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
    $('#userFacing').value = currentSettings.userFacing || '';
    const hintEl = $('#userFacingHint');
    if (hintEl) {
      hintEl.style.display = (!currentSettings.userFacing) ? 'block' : 'none';
    }
  }
  if ($('#radiusDisplay')) {
    $('#radiusDisplay').textContent = `${currentSettings.radiusKm} km`;
  }
  if ($('#overheadThresholdDisplay')) {
    $('#overheadThresholdDisplay').textContent = `${currentSettings.overheadThresholdKm} km`;
  }
  const isNorthUp = currentSettings.radarOrientation === 'north_up' || !currentSettings.userFacing;
  if ($('#radarOrientationDisplay')) {
    $('#radarOrientationDisplay').textContent = isNorthUp
      ? 'North up (0°)'
      : `Facing up (${currentSettings.userFacing})`;
  }
  const facingLabel = $('#radarFacingLabel');
  if (facingLabel) {
    facingLabel.textContent = isNorthUp
      ? 'NORTH UP (N)'
      : `FACING UP (${currentSettings.userFacing})`;
  }
  if ($('#alertsEnabled')) {
    $('#alertsEnabled').checked = Boolean(currentSettings.alertsEnabled);
  }
  if ($('#soundEnabled')) {
    $('#soundEnabled').checked = Boolean(currentSettings.soundEnabled);
  }
  if ($('#devMockToggle')) {
    $('#devMockToggle').checked = Boolean(currentSettings.mockProviderEnabled);
  }
  if ($('#devDiagnosticsToggle')) {
    $('#devDiagnosticsToggle').checked = Boolean(currentSettings.diagnosticsEnabled);
  }

  const alertRules = currentSettings.alertRules || [];
  const activeAlertRules = alertRules.filter(r => r.enabled !== false).length;
  const alertModeSummary = $('#alertsModeSummaryDisplay');
  if (alertModeSummary) {
    if (currentSettings.alertMode === 'chosen') {
      alertModeSummary.textContent = `${activeAlertRules} rule${activeAlertRules === 1 ? '' : 's'} ›`;
    } else {
      alertModeSummary.textContent = 'All overhead ›';
    }
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
  bindAlertsEvents();
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

  // Version 5-click reveals Developer section (remains visible until popup closes)
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
        const devSec = $('#developerSection');
        if (devSec) {
          devSec.style.display = 'block';
        }
      }
    });
  }

  // Developer Section Switches
  const devMockToggle = $('#devMockToggle');
  if (devMockToggle) {
    devMockToggle.addEventListener('change', async () => {
      currentSettings.mockProviderEnabled = devMockToggle.checked;
      await saveSettings();
      updateMockBannerVisibility();
      await triggerQuickPoll();
    });
  }

  const devDiagnosticsToggle = $('#devDiagnosticsToggle');
  if (devDiagnosticsToggle) {
    devDiagnosticsToggle.addEventListener('change', async () => {
      currentSettings.diagnosticsEnabled = devDiagnosticsToggle.checked;
      await saveSettings();
    });
  }

  // Export & Clear Diagnostics Buttons
  const btnExportDiag = $('#btnExportDiagnostics');
  if (btnExportDiag) {
    btnExportDiag.addEventListener('click', async () => {
      try {
        const diagData = await getDiagnosticPolls();
        const exportPayload = {
          exportedAt: new Date().toISOString(),
          pollCyclesCount: diagData.length,
          summary: generateDiagnosticsSummary(diagData, { radiusKm: currentSettings.radiusKm }),
          polls: diagData
        };

        if (!verifyRedaction(exportPayload)) {
          alert('Diagnostics redaction safety check failed: raw coordinates detected.');
          return;
        }

        const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `airvee-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.warn('Airvee: Failed to export diagnostics:', err);
      }
    });
  }

  const btnClearDiag = $('#btnClearDiagnostics');
  if (btnClearDiag) {
    btnClearDiag.addEventListener('click', async () => {
      if (confirm('Clear all stored diagnostics poll cycles?')) {
        await clearDiagnosticPolls();
        alert('Diagnostics buffer cleared.');
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
        const lookRel = $('#heroLookRelative');
        const rawElev = hf.elevationAtCpa != null ? hf.elevationAtCpa : hf.currentElevation;
        const { anglesText, relText } = formatHeroLook(bearingVal, rawElev, currentSettings.userFacing);
        if (lookAngles) lookAngles.textContent = anglesText;
        if (lookRel) {
          lookRel.textContent = relText;
          lookRel.style.display = relText ? '' : 'none';
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
            <span class="capsule-val mono">${currentSettings.userFacing || 'NOT SET'}</span>
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
    const evalRes = evaluateAircraft(f, currentSettings, f);
    const classification = evalRes.passClass;
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
    const rawElev = hero.elevationAtCpa != null ? hero.elevationAtCpa : hero.currentElevation;
    const { anglesText, relText } = formatHeroLook(bearingVal, rawElev, currentSettings.userFacing);
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
            <div class="look-angle-main mono" id="heroLookAngles">${anglesText}</div>
            <div class="look-relative-sub" id="heroLookRelative" style="${relText ? '' : 'display: none;'}">${relText}</div>
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

  $$('.view-container').forEach(el => {
    el.classList.remove('active');
    el.style.display = '';
  });

  if (views[tabName]) {
    views[tabName].classList.add('active');
  }

  try {
    if (tabName === 'radar') {
      initOrUpdateRadar();
    } else if (popupRadarScope) {
      popupRadarScope.stop();
    }
  } catch (err) {
    console.error('Airvee: Failed to toggle radar scope:', err);
  }

  try {
    if (tabName === 'log') {
      await renderLogView();
    } else if (tabName === 'stats') {
      await renderStatsView();
    } else if (tabName === 'settings') {
      renderSettings();
    }
  } catch (err) {
    console.error(`Airvee: Failed to render view for ${tabName}:`, err);
    renderErrorFallback(err);
  }
}

function initOrUpdateRadar() {
  const canvas = $('#radarCanvas');
  if (!canvas) return;

  if (!popupRadarScope) {
    popupRadarScope = new RadarScope(canvas, {
      maxRadiusKm: currentSettings.radiusKm,
      userFacing: currentSettings.userFacing || '',
      orientation: currentSettings.radarOrientation || 'facing_up',
      units: 'km',
      onSelectFlight: (flight) => renderRadarSelectedTarget(flight)
    });
  } else {
    popupRadarScope.setOptions({
      maxRadiusKm: currentSettings.radiusKm,
      userFacing: currentSettings.userFacing || '',
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
//  ALERTS & 3-STEP RULE BUILDER CONTROLLER
// ============================================================

let currentStep2Category = 'airline';
let editingRuleId = null;
let draftRule = {
  id: null,
  name: '',
  enabled: true,
  conditions: {},
  action: 'loud'
};

function showSubView(viewId) {
  $$('.view-container').forEach(el => {
    el.classList.remove('active');
    el.style.display = '';
  });
  const target = $(`#${viewId}`);
  if (target) {
    target.style.display = '';
    target.classList.add('active');
  }
}

function openAlertsScreen() {
  showSubView('viewAlerts');
  renderAlertsScreen();
}

function renderAlertsScreen() {
  const isChosen = currentSettings.alertMode === 'chosen';
  const allBtn = $('#btnAlertModeAll');
  const chosenBtn = $('#btnAlertModeChosen');
  if (allBtn) {
    allBtn.classList.toggle('active', !isChosen);
    allBtn.setAttribute('aria-selected', !isChosen);
  }
  if (chosenBtn) {
    chosenBtn.classList.toggle('active', isChosen);
    chosenBtn.setAttribute('aria-selected', isChosen);
  }

  const allContainer = $('#alertsModeAllContainer');
  const chosenContainer = $('#alertsModeChosenContainer');
  if (allContainer) allContainer.style.display = isChosen ? 'none' : 'block';
  if (chosenContainer) chosenContainer.style.display = isChosen ? 'block' : 'none';

  if (isChosen) {
    renderAlertRulesList();
    renderDefaultAction();
  }
}

function renderDefaultAction() {
  const el = $('#defaultActionDisplay');
  if (!el) return;
  const act = currentSettings.defaultAction || 'log';
  const label = act === 'alert' ? 'Alert ›'
    : act === 'ignore' ? 'Ignore ›'
    : 'Log only ›';
  el.textContent = label;
}

function renderAlertRulesList() {
  const listEl = $('#alertRulesList');
  if (!listEl) return;

  const rules = currentSettings.alertRules || [];
  if (rules.length === 0) {
    listEl.innerHTML = `
      <div class="alerts-empty-state mono">
        No rules yet. Overhead flights follow the Everything else setting.
      </div>
    `;
    return;
  }

  listEl.innerHTML = rules.map(rule => {
    const { title, subtitle } = formatRuleSentence(rule);
    const isChecked = rule.enabled !== false;
    return `
      <div class="alert-rule-row" data-rule-id="${esc(rule.id)}">
        <div class="alert-rule-content">
          <span class="alert-rule-title">${esc(title)}</span>
          <span class="alert-rule-subtitle mono">${esc(subtitle)}</span>
        </div>
        <label class="ios-switch rule-switch-label" onclick="event.stopPropagation();">
          <input type="checkbox" class="rule-enable-toggle" data-rule-id="${esc(rule.id)}" ${isChecked ? 'checked' : ''} aria-label="Toggle rule ${esc(title)}">
          <span class="ios-track"></span>
        </label>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.alert-rule-row').forEach(row => {
    row.addEventListener('click', () => {
      const ruleId = row.dataset.ruleId;
      openRuleEditor(ruleId);
    });
  });

  listEl.querySelectorAll('.rule-enable-toggle').forEach(toggle => {
    toggle.addEventListener('change', (e) => {
      const ruleId = toggle.dataset.ruleId;
      const rule = (currentSettings.alertRules || []).find(r => r.id === ruleId);
      if (rule) {
        rule.enabled = toggle.checked;
        saveSettings();
        renderSettings();
      }
    });
  });
}

function openNewRuleFlow() {
  editingRuleId = null;
  draftRule = {
    id: null,
    name: '',
    enabled: true,
    conditions: {},
    action: 'loud'
  };
  showSubView('viewAddRuleStep1');
}

function openRuleEditor(ruleId) {
  const rule = (currentSettings.alertRules || []).find(r => r.id === ruleId);
  if (!rule) return;

  editingRuleId = ruleId;
  draftRule = JSON.parse(JSON.stringify(rule));
  openStep3();
}

function openStep2(category) {
  currentStep2Category = category;
  showSubView('viewAddRuleStep2');

  const titleMap = {
    airline: 'Airline',
    aircraft: 'Aircraft type',
    category: 'Category',
    direction: 'Direction of travel',
    route: 'Route',
    identifier: 'Registration or callsign'
  };
  const titleEl = $('#step2HeaderTitle');
  if (titleEl) titleEl.textContent = titleMap[category] || 'Condition';

  const searchWrap = $('#step2SearchWrap');
  const searchInput = $('#step2SearchInput');
  if (searchWrap) {
    searchWrap.style.display = (category === 'airline' || category === 'aircraft') ? 'block' : 'none';
  }
  if (searchInput) {
    searchInput.value = '';
    searchInput.placeholder = category === 'airline' ? 'Search airlines' : 'Search aircraft types';
  }

  renderStep2Chips();
  renderStep2Options('');
}

function renderStep2Chips() {
  const container = $('#step2ChipsContainer');
  if (!container) return;

  const chips = [];

  // Airlines
  if (Array.isArray(draftRule.conditions.airlines)) {
    draftRule.conditions.airlines.forEach(code => {
      const label = AIRLINE_GROUPS[code.toLowerCase()]
        ? AIRLINE_GROUPS[code.toLowerCase()].name
        : (getAirlineDisplayName(code) || code);
      chips.push({ key: 'airline', val: code, label });
    });
  }

  // Aircraft types
  if (Array.isArray(draftRule.conditions.aircraftTypes)) {
    draftRule.conditions.aircraftTypes.forEach(type => {
      const label = getAircraftDisplayName(type) || type;
      chips.push({ key: 'aircraft', val: type, label });
    });
  }

  // Category
  if (Array.isArray(draftRule.conditions.category)) {
    draftRule.conditions.category.forEach(cat => {
      const found = CATEGORIES.find(c => c.id === cat);
      chips.push({ key: 'category', val: cat, label: found ? found.name : cat });
    });
  }

  // Direction
  if (Array.isArray(draftRule.conditions.direction)) {
    draftRule.conditions.direction.forEach(dir => {
      const found = DIRECTIONS.find(d => d.id === dir);
      chips.push({ key: 'direction', val: dir, label: found ? found.name : `${dir}bound` });
    });
  }

  // Route
  if (draftRule.conditions.route) {
    const r = draftRule.conditions.route;
    if (r.origin || r.destination) {
      chips.push({ key: 'route', val: 'airports', label: `${r.origin || 'Any'} → ${r.destination || 'Any'}` });
    }
    if (r.flightType && r.flightType !== 'any') {
      chips.push({ key: 'route', val: 'flightType', label: r.flightType === 'international' ? 'International' : 'Domestic' });
    }
  }

  // Identifier
  if (draftRule.conditions.registration) {
    chips.push({ key: 'identifier', val: 'registration', label: `Reg ${draftRule.conditions.registration}` });
  }
  if (draftRule.conditions.callsignPrefix) {
    chips.push({ key: 'identifier', val: 'callsignPrefix', label: `Callsign ${draftRule.conditions.callsignPrefix}*` });
  }

  if (chips.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = chips.map(c => `
    <span class="condition-chip mono">
      ${esc(c.label)}
      <button type="button" class="chip-remove-btn" data-chip-key="${esc(c.key)}" data-chip-val="${esc(c.val)}" aria-label="Remove ${esc(c.label)}">×</button>
    </span>
  `).join('');

  container.querySelectorAll('.chip-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = btn.dataset.chipKey;
      const v = btn.dataset.chipVal;
      removeConditionChip(k, v);
    });
  });
}

function removeConditionChip(key, val) {
  if (key === 'airline') {
    draftRule.conditions.airlines = (draftRule.conditions.airlines || []).filter(c => c !== val);
    if (draftRule.conditions.airlines.length === 0) delete draftRule.conditions.airlines;
  } else if (key === 'aircraft') {
    draftRule.conditions.aircraftTypes = (draftRule.conditions.aircraftTypes || []).filter(t => t !== val);
    if (draftRule.conditions.aircraftTypes.length === 0) delete draftRule.conditions.aircraftTypes;
  } else if (key === 'category') {
    draftRule.conditions.category = (draftRule.conditions.category || []).filter(c => c !== val);
    if (draftRule.conditions.category.length === 0) delete draftRule.conditions.category;
  } else if (key === 'direction') {
    draftRule.conditions.direction = (draftRule.conditions.direction || []).filter(d => d !== val);
    if (draftRule.conditions.direction.length === 0) delete draftRule.conditions.direction;
  } else if (key === 'route') {
    if (val === 'airports') {
      if (draftRule.conditions.route) {
        delete draftRule.conditions.route.origin;
        delete draftRule.conditions.route.destination;
      }
    } else if (val === 'flightType') {
      if (draftRule.conditions.route) delete draftRule.conditions.route.flightType;
    }
    if (draftRule.conditions.route && Object.keys(draftRule.conditions.route).length === 0) {
      delete draftRule.conditions.route;
    }
  } else if (key === 'identifier') {
    if (val === 'registration') delete draftRule.conditions.registration;
    if (val === 'callsignPrefix') delete draftRule.conditions.callsignPrefix;
  }

  renderStep2Chips();
  renderStep2Options($('#step2SearchInput')?.value.trim() || '');
}

function renderStep2Options(searchQuery = '') {
  const container = $('#step2OptionsContainer');
  if (!container) return;
  const q = (searchQuery || '').toLowerCase();

  if (currentStep2Category === 'airline') {
    const selectedAirlines = new Set((draftRule.conditions.airlines || []).map(s => String(s).toUpperCase()));
    const groupItems = Object.values(AIRLINE_GROUPS).filter(g =>
      !q || g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q)
    );
    const airlineItems = AIRLINES.filter(a =>
      !q || a.name.toLowerCase().includes(q) || a.icao.toLowerCase().includes(q) || a.iata.toLowerCase().includes(q)
    );

    let html = '';
    if (groupItems.length > 0) {
      html += groupItems.map(g => {
        const isSel = selectedAirlines.has(g.id.toUpperCase());
        return `
          <div class="step2-option-row" data-type="group" data-val="${esc(g.id)}">
            <div style="display:flex; flex-direction:column; gap:2px;">
              <span class="step2-option-name">${esc(g.name)}</span>
              <span class="mono" style="font-size:11px; color:var(--text-tertiary);">${esc(g.description)}</span>
            </div>
            <div class="step2-checkbox ${isSel ? 'checked' : ''}">${isSel ? '✓' : ''}</div>
          </div>
        `;
      }).join('');
    }

    html += airlineItems.map(a => {
      const isSel = selectedAirlines.has(a.icao.toUpperCase()) || selectedAirlines.has(a.iata.toUpperCase());
      return `
        <div class="step2-option-row" data-type="airline" data-val="${esc(a.icao)}">
          <span class="step2-option-name">${esc(a.name)} <span class="mono" style="color:var(--text-secondary);">${esc(a.iata)}</span></span>
          <div class="step2-checkbox ${isSel ? 'checked' : ''}">${isSel ? '✓' : ''}</div>
        </div>
      `;
    }).join('');

    container.innerHTML = html;

    container.querySelectorAll('.step2-option-row').forEach(row => {
      row.addEventListener('click', () => {
        const val = row.dataset.val;
        if (!draftRule.conditions.airlines) draftRule.conditions.airlines = [];
        const idx = draftRule.conditions.airlines.indexOf(val);
        if (idx >= 0) draftRule.conditions.airlines.splice(idx, 1);
        else draftRule.conditions.airlines.push(val);

        if (draftRule.conditions.airlines.length === 0) delete draftRule.conditions.airlines;
        renderStep2Chips();
        renderStep2Options($('#step2SearchInput')?.value.trim() || '');
      });
    });

  } else if (currentStep2Category === 'aircraft') {
    const selectedTypes = new Set((draftRule.conditions.aircraftTypes || []).map(t => String(t).toUpperCase()));
    const items = AIRCRAFT_TYPES.filter(t =>
      !q || t.name.toLowerCase().includes(q) || t.icao.toLowerCase().includes(q)
    );

    container.innerHTML = items.map(ac => {
      const isSel = selectedTypes.has(ac.icao.toUpperCase());
      return `
        <div class="step2-option-row" data-val="${esc(ac.icao)}">
          <span class="step2-option-name">${esc(ac.name)} <span class="mono" style="color:var(--text-secondary);">${esc(ac.icao)}</span></span>
          <div class="step2-checkbox ${isSel ? 'checked' : ''}">${isSel ? '✓' : ''}</div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.step2-option-row').forEach(row => {
      row.addEventListener('click', () => {
        const val = row.dataset.val;
        if (!draftRule.conditions.aircraftTypes) draftRule.conditions.aircraftTypes = [];
        const idx = draftRule.conditions.aircraftTypes.indexOf(val);
        if (idx >= 0) draftRule.conditions.aircraftTypes.splice(idx, 1);
        else draftRule.conditions.aircraftTypes.push(val);

        if (draftRule.conditions.aircraftTypes.length === 0) delete draftRule.conditions.aircraftTypes;
        renderStep2Chips();
        renderStep2Options($('#step2SearchInput')?.value.trim() || '');
      });
    });

  } else if (currentStep2Category === 'category') {
    const selectedCats = new Set((draftRule.conditions.category || []).map(c => String(c).toLowerCase()));
    container.innerHTML = CATEGORIES.map(cat => {
      const isSel = selectedCats.has(cat.id.toLowerCase());
      return `
        <div class="step2-option-row" data-val="${esc(cat.id)}">
          <div style="display:flex; flex-direction:column; gap:2px;">
            <span class="step2-option-name">${esc(cat.name)}</span>
            <span class="mono" style="font-size:11px; color:var(--text-tertiary);">${esc(cat.description)}</span>
          </div>
          <div class="step2-checkbox ${isSel ? 'checked' : ''}">${isSel ? '✓' : ''}</div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.step2-option-row').forEach(row => {
      row.addEventListener('click', () => {
        const val = row.dataset.val;
        if (!draftRule.conditions.category) draftRule.conditions.category = [];
        const idx = draftRule.conditions.category.indexOf(val);
        if (idx >= 0) draftRule.conditions.category.splice(idx, 1);
        else draftRule.conditions.category.push(val);

        if (draftRule.conditions.category.length === 0) delete draftRule.conditions.category;
        renderStep2Chips();
        renderStep2Options('');
      });
    });

  } else if (currentStep2Category === 'direction') {
    const selectedDirs = new Set(draftRule.conditions.direction || []);
    container.innerHTML = DIRECTIONS.map(dir => {
      const isSel = selectedDirs.has(dir.id);
      return `
        <div class="step2-option-row" data-val="${esc(dir.id)}">
          <div style="display:flex; flex-direction:column; gap:2px;">
            <span class="step2-option-name">${esc(dir.name)} (${esc(dir.id)})</span>
            <span class="mono" style="font-size:11px; color:var(--text-tertiary);">${esc(dir.heading)}</span>
          </div>
          <div class="step2-checkbox ${isSel ? 'checked' : ''}">${isSel ? '✓' : ''}</div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.step2-option-row').forEach(row => {
      row.addEventListener('click', () => {
        const val = row.dataset.val;
        if (!draftRule.conditions.direction) draftRule.conditions.direction = [];
        const idx = draftRule.conditions.direction.indexOf(val);
        if (idx >= 0) draftRule.conditions.direction.splice(idx, 1);
        else draftRule.conditions.direction.push(val);

        if (draftRule.conditions.direction.length === 0) delete draftRule.conditions.direction;
        renderStep2Chips();
        renderStep2Options('');
      });
    });

  } else if (currentStep2Category === 'route') {
    const r = draftRule.conditions.route || {};
    container.innerHTML = `
      <div class="step2-form-fields">
        <div class="step2-field-group">
          <label class="step2-field-label mono">Origin airport (IATA/ICAO)</label>
          <input type="text" class="step2-field-input mono" id="inputRouteOrigin" placeholder="e.g. BOM or DEL" value="${esc(r.origin || '')}" autocomplete="off">
        </div>
        <div class="step2-field-group">
          <label class="step2-field-label mono">Destination airport (IATA/ICAO)</label>
          <input type="text" class="step2-field-input mono" id="inputRouteDest" placeholder="e.g. LHR or DXB" value="${esc(r.destination || '')}" autocomplete="off">
        </div>
        <div class="step2-field-group">
          <label class="step2-field-label mono">Flight corridor</label>
          <select class="settings-select mono" id="selectRouteFlightType" style="height:44px;">
            <option value="any" ${!r.flightType || r.flightType === 'any' ? 'selected' : ''}>Any flights</option>
            <option value="international" ${r.flightType === 'international' ? 'selected' : ''}>International flights only</option>
            <option value="domestic" ${r.flightType === 'domestic' ? 'selected' : ''}>Domestic flights only</option>
          </select>
        </div>
      </div>
    `;

  } else if (currentStep2Category === 'identifier') {
    container.innerHTML = `
      <div class="step2-form-fields">
        <div class="step2-field-group">
          <label class="step2-field-label mono">Specific registration (tail number)</label>
          <input type="text" class="step2-field-input mono" id="inputReg" placeholder="e.g. A6-EEA or VT-EXF" value="${esc(draftRule.conditions.registration || '')}" autocomplete="off">
        </div>
        <div class="step2-field-group">
          <label class="step2-field-label mono">Callsign prefix</label>
          <input type="text" class="step2-field-input mono" id="inputCallsignPrefix" placeholder="e.g. ETH or EK39" value="${esc(draftRule.conditions.callsignPrefix || '')}" autocomplete="off">
        </div>
      </div>
    `;
  }
}

function commitStep2FormInputs() {
  if (currentStep2Category === 'route') {
    const orig = ($('#inputRouteOrigin')?.value || '').trim().toUpperCase();
    const dest = ($('#inputRouteDest')?.value || '').trim().toUpperCase();
    const ftype = $('#selectRouteFlightType')?.value || 'any';
    if (orig || dest || (ftype && ftype !== 'any')) {
      draftRule.conditions.route = {
        origin: orig || undefined,
        destination: dest || undefined,
        flightType: ftype !== 'any' ? ftype : undefined
      };
    } else {
      delete draftRule.conditions.route;
    }
  } else if (currentStep2Category === 'identifier') {
    const reg = ($('#inputReg')?.value || '').trim().toUpperCase();
    const prefix = ($('#inputCallsignPrefix')?.value || '').trim().toUpperCase();
    if (reg) draftRule.conditions.registration = reg;
    else delete draftRule.conditions.registration;
    if (prefix) draftRule.conditions.callsignPrefix = prefix;
    else delete draftRule.conditions.callsignPrefix;
  }
}

function openStep3() {
  showSubView('viewAddRuleStep3');

  const nameInput = $('#ruleNameInput');
  if (nameInput) {
    if (!draftRule.name || draftRule.name === 'Rule') {
      draftRule.name = generateRuleNameFromConditions(draftRule.conditions);
    }
    nameInput.value = draftRule.name;
  }

  selectActionInStep3(draftRule.action || 'loud');

  const advPanel = $('#advancedOptionsPanel');
  if (advPanel) advPanel.style.display = 'none';
  const advChevron = $('#advancedChevron');
  if (advChevron) advChevron.classList.remove('open');

  const overheadInput = $('#ruleOverheadThresholdInput');
  if (overheadInput) overheadInput.value = draftRule.conditions?.overheadThresholdKm || '';

  const quietCheck = $('#ruleIgnoreQuietHoursInput');
  if (quietCheck) quietCheck.checked = Boolean(draftRule.conditions?.bypassQuietHours);

  const rareCheck = $('#ruleRareOnlyInput');
  if (rareCheck) rareCheck.checked = Boolean(draftRule.conditions?.rareForMe);

  const delWrap = $('#deleteRuleWrap');
  if (delWrap) delWrap.style.display = editingRuleId ? 'block' : 'none';
}

function selectActionInStep3(action) {
  draftRule.action = action;
  const actions = ['Alert', 'Loud', 'Log', 'Ignore'];
  actions.forEach(act => {
    const isThis = act.toLowerCase() === action.toLowerCase();
    $(`#actionRow${act}`)?.setAttribute('aria-checked', isThis);
    $(`#radioCircle${act}`)?.classList.toggle('checked', isThis);
  });
}

function saveAlertRule() {
  const nameInput = $('#ruleNameInput');
  const name = (nameInput?.value || '').trim() || generateRuleNameFromConditions(draftRule.conditions) || 'Rule';
  draftRule.name = name;

  const threshVal = parseInt($('#ruleOverheadThresholdInput')?.value, 10);
  if (!isNaN(threshVal) && threshVal > 0) {
    draftRule.conditions.overheadThresholdKm = threshVal;
  } else {
    delete draftRule.conditions.overheadThresholdKm;
  }

  if ($('#ruleIgnoreQuietHoursInput')?.checked) {
    draftRule.conditions.bypassQuietHours = true;
  } else {
    delete draftRule.conditions.bypassQuietHours;
  }

  if ($('#ruleRareOnlyInput')?.checked) {
    draftRule.conditions.rareForMe = true;
  } else {
    delete draftRule.conditions.rareForMe;
  }

  if (!currentSettings.alertRules) {
    currentSettings.alertRules = [];
  }

  if (editingRuleId) {
    const idx = currentSettings.alertRules.findIndex(r => r.id === editingRuleId);
    if (idx !== -1) {
      currentSettings.alertRules[idx] = { ...draftRule, id: editingRuleId };
    } else {
      currentSettings.alertRules.push({ ...draftRule, id: editingRuleId });
    }
  } else {
    const newId = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    currentSettings.alertRules.push({ ...draftRule, id: newId });
  }

  saveSettings();
  renderSettings();
  showSubView('viewAlerts');
  renderAlertsScreen();
}

function deleteRuleFromEditor() {
  if (!editingRuleId) return;
  currentSettings.alertRules = (currentSettings.alertRules || []).filter(r => r.id !== editingRuleId);
  editingRuleId = null;
  saveSettings();
  renderSettings();
  showSubView('viewAlerts');
  renderAlertsScreen();
}

async function testAlertRuleAction() {
  const btn = $('#btnTestRuleAction');
  const origText = btn ? btn.textContent : 'Test rule';
  if (btn) btn.textContent = 'Testing...';

  const action = draftRule.action || 'loud';
  try {
    if (action === 'loud') {
      await playSpecialAlertChime(90);
    } else if (action === 'alert') {
      await playAirportDoubleChime(80);
    }
  } catch (e) {}

  if (btn) {
    btn.textContent = action === 'loud' ? 'Loud chime played'
      : action === 'alert' ? 'Chime played'
      : action === 'log' ? 'Logged (silent)'
      : 'Ignored (hidden)';
    setTimeout(() => {
      if (btn) btn.textContent = origText;
    }, 1500);
  }
}

function applyQuickAddPreset(presetId) {
  const preset = PRESETS.find(p => p.id === presetId);
  if (!preset) return;

  const newRule = preset.createRule();
  if (!currentSettings.alertRules) {
    currentSettings.alertRules = [];
  }
  currentSettings.alertRules.push(newRule);
  saveSettings();
  renderSettings();
  renderAlertRulesList();
}

function bindAlertsEvents() {
  $('#rowAlertsScreen')?.addEventListener('click', () => {
    openAlertsScreen();
  });

  $('#btnBackAlertsToSettings')?.addEventListener('click', () => {
    showSubView('viewSettings');
    renderSettings();
  });

  $('#btnAlertModeAll')?.addEventListener('click', () => {
    currentSettings.alertMode = 'all';
    saveSettings();
    renderSettings();
    renderAlertsScreen();
  });

  $('#btnAlertModeChosen')?.addEventListener('click', () => {
    currentSettings.alertMode = 'chosen';
    saveSettings();
    renderSettings();
    renderAlertsScreen();
  });

  $('#btnAddNewAlertRule')?.addEventListener('click', () => {
    openNewRuleFlow();
  });

  $('#rowDefaultAction')?.addEventListener('click', () => {
    const cycle = { log: 'alert', alert: 'ignore', ignore: 'log' };
    currentSettings.defaultAction = cycle[currentSettings.defaultAction || 'log'] || 'log';
    saveSettings();
    renderDefaultAction();
  });

  $('#presetCargo')?.addEventListener('click', () => applyQuickAddPreset('cargo_only'));
  $('#presetWideBodies')?.addEventListener('click', () => applyQuickAddPreset('wide_bodies'));
  $('#presetRare')?.addEventListener('click', () => applyQuickAddPreset('rare_aircraft'));
  $('#presetGulf')?.addEventListener('click', () => applyQuickAddPreset('gulf_carriers'));

  $('#btnCancelAddRuleStep1')?.addEventListener('click', () => {
    showSubView('viewAlerts');
  });

  $('#step1OptionAirline')?.addEventListener('click', () => openStep2('airline'));
  $('#step1OptionAircraft')?.addEventListener('click', () => openStep2('aircraft'));
  $('#step1OptionCategory')?.addEventListener('click', () => openStep2('category'));
  $('#step1OptionDirection')?.addEventListener('click', () => openStep2('direction'));
  $('#step1OptionRoute')?.addEventListener('click', () => openStep2('route'));
  $('#step1OptionIdentifier')?.addEventListener('click', () => openStep2('identifier'));

  $('#btnBackStep2ToStep1')?.addEventListener('click', () => {
    showSubView('viewAddRuleStep1');
  });

  $('#step2SearchInput')?.addEventListener('input', (e) => {
    renderStep2Options(e.target.value.trim());
  });

  $('#btnStep2Next')?.addEventListener('click', () => {
    commitStep2FormInputs();
    openStep3();
  });

  $('#btnBackStep3ToStep2')?.addEventListener('click', () => {
    openStep2(currentStep2Category);
  });

  $('#actionRowAlert')?.addEventListener('click', () => selectActionInStep3('alert'));
  $('#actionRowLoud')?.addEventListener('click', () => selectActionInStep3('loud'));
  $('#actionRowLog')?.addEventListener('click', () => selectActionInStep3('log'));
  $('#actionRowIgnore')?.addEventListener('click', () => selectActionInStep3('ignore'));

  $('#btnToggleAdvanced')?.addEventListener('click', () => {
    const panel = $('#advancedOptionsPanel');
    const chevron = $('#advancedChevron');
    if (!panel) return;
    const isHidden = panel.style.display === 'none' || !panel.style.display;
    panel.style.display = isHidden ? 'block' : 'none';
    if (chevron) chevron.classList.toggle('open', isHidden);
  });

  $('#btnDeleteRuleInEditor')?.addEventListener('click', () => {
    deleteRuleFromEditor();
  });

  $('#btnTestRuleAction')?.addEventListener('click', () => {
    testAlertRuleAction();
  });

  $('#btnSaveRuleAction')?.addEventListener('click', () => {
    saveAlertRule();
  });
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
    const alertRules = currentSettings.alertRules || [];
    if (alertRules.length > 0) {
      const evalRes = evaluateAlertRules(flight, alertRules, {
        alertMode: currentSettings.alertMode,
        defaultAction: currentSettings.defaultAction,
        rareSeenThreshold: currentSettings.rareSeenThreshold || 2,
        globalOverheadThresholdKm: currentSettings.overheadThresholdKm || 5
      });
      if (evalRes.matchedRule && evalRes.action !== 'ignore') {
        const isRare = evalRes.matchedRule.tag === 'RARE' || Boolean(evalRes.matchedRule.conditions?.rareForMe);
        const tagClass = isNeutral ? 'neutral' : (isRare ? 'rare' : 'watch');
        badges.push(`<span class="badge-watchlist mono ${tagClass}">${esc(evalRes.matchedRule.tag || 'ALERT')}</span>`);
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
