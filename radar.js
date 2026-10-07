// ============================================================
//  AIRVEE — Full-Tab Radar Controller
// ============================================================

import { RadarScope } from './lib/radar.js';
import { formatLookDirection } from './lib/geo.js';
import { evaluateAircraft } from './lib/filter.js';
import { DEFAULTS, migrateSettings } from './lib/settings-defaults.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let radarScope = null;
let currentFlights = [];
let currentSettings = { ...DEFAULTS };

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  initRadar();
  await refreshFlights();

  setInterval(refreshFlights, 6000);
});

async function loadSettings() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    currentSettings = migrateSettings(settings);
    const locEl = $('#stationLocation');
    if (locEl) {
      locEl.textContent = `${currentSettings.latitude.toFixed(4)}° N, ${currentSettings.longitude.toFixed(4)}° E`;
    }
    const radEl = $('#fullRadiusTag');
    if (radEl) {
      radEl.textContent = `${currentSettings.radiusKm} km Scope`;
    }
  } catch (e) {}
}

function initRadar() {
  const canvas = $('#fullRadarCanvas');
  if (!canvas) return;

  radarScope = new RadarScope(canvas, {
    maxRadiusKm: currentSettings.radiusKm,
    userFacing: currentSettings.userFacing,
    onSelectFlight: (flight) => {
      if (flight) {
        highlightSidebarCard(flight.id);
      } else {
        $$('.flight-card').forEach(c => c.classList.remove('selected'));
      }
    }
  });

  window.addEventListener('resize', () => {
    if (radarScope) radarScope._setupCanvas();
  });
}

async function refreshFlights() {
  try {
    const { nearbyFlights = [], lastPollSource = 'FR24' } = await chrome.storage.local.get([
      'nearbyFlights',
      'lastPollSource'
    ]);

    currentFlights = nearbyFlights;

    if (radarScope) {
      radarScope.setOptions({
        maxRadiusKm: currentSettings.radiusKm,
        userFacing: currentSettings.userFacing
      });
      radarScope.setFlights(currentFlights);
    }

    const countEl = $('#sidebarFlightCount');
    if (countEl) countEl.textContent = currentFlights.length;

    const srcEl = $('#sidebarSource');
    if (srcEl) srcEl.textContent = lastPollSource.toUpperCase();

    renderSidebarList();
  } catch (e) {
    console.warn('Airvee Radar: Flight refresh error:', e);
  }
}

function renderSidebarList() {
  const container = $('#sidebarFlightList');
  if (!container) return;

  if (currentFlights.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">Scope Clear</div>
        <div class="empty-sub">No traffic currently inside your ${currentSettings.radiusKm} km zone.</div>
      </div>`;
    return;
  }

  container.innerHTML = currentFlights.map(f => {
    const evalRes = evaluateAircraft(f, currentSettings, f);
    const isOverhead = evalRes.passClass === 'overhead';
    const etaStr = f.eta != null ? formatETA(f.eta) : '—';
    const distStr = f.distance != null ? `${f.distance}km` : '—';
    const altStr = f.altitude ? `${f.altitude.toLocaleString()}ft` : '—';

    return `
      <div class="flight-card ${isOverhead ? 'overhead-alert' : ''}" data-id="${f.id}">
        <div class="card-top">
          <div class="card-identity">
            <div>
              <div class="callsign-text mono">${esc(f.flightNumber || f.callsign)}</div>
              <div class="airline-text">${esc(f.airline || 'En route')}</div>
            </div>
          </div>
          <span class="flight-badge ${f.flightType === 'international' ? 'badge-intl' : 'badge-dom'}">
            ${f.flightType === 'international' ? 'INTL' : 'DOM'}
          </span>
        </div>

        <div class="card-stats">
          <div class="stat-item"><span class="stat-key">Dist</span><span class="stat-val mono">${distStr}</span></div>
          <div class="stat-item"><span class="stat-key">Alt</span><span class="stat-val mono">${altStr}</span></div>
          <div class="stat-item"><span class="stat-key">Spd</span><span class="stat-val mono">${f.speed || '—'}kt</span></div>
          <div class="stat-item"><span class="stat-key">Overhead</span><span class="stat-val mono ${isOverhead ? 'eta-alert' : ''}">${etaStr}</span></div>
        </div>
      </div>`;
  }).join('');

  $$('#sidebarFlightList .flight-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      if (radarScope) radarScope.setSelectedFlight(id);
      highlightSidebarCard(id);
    });
  });
}

function highlightSidebarCard(id) {
  $$('.flight-card').forEach(c => {
    const isMatch = c.dataset.id === id;
    c.classList.toggle('selected', isMatch);
    if (isMatch) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function formatETA(seconds) {
  if (seconds < 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function esc(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}
