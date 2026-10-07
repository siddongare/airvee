// ============================================================
//  AIRVEE — Flight Data Provider Hub & Adapter Pipeline
//  - Provider registry with prioritized fallback chain
//  - Short TTL response caching
//  - Request de-duplication (single in-flight request per key)
//  - Exponential backoff on errors / 429 rate limits
//  - Real-time data source status reporting (OK / degraded / offline)
// ============================================================

import { fetchFlightsNear as fr24Fetch } from './fr24.js';
import { fetchMockFlightsNear } from './mock.js';

// Configuration
const CACHE_TTL_MS = 6000; // 6-second short TTL response cache
const BASE_BACKOFF_MS = 4000;
const MAX_BACKOFF_MS = 60000;

// Provider Registry: prioritized order of flight data providers
const PROVIDER_REGISTRY = [
  {
    name: 'FR24',
    fetch: fr24Fetch
  }
  // Future providers (adsb.lol, airplanes.live, etc.) can be registered here
];

// Per-provider health and backoff state
const providerStates = new Map();

PROVIDER_REGISTRY.forEach(p => {
  providerStates.set(p.name, {
    consecutiveErrors: 0,
    backoffUntil: 0,
    lastSuccess: null,
    lastError: null,
    lastHttpStatus: null
  });
});

// Response cache
let responseCache = {
  key: null,
  timestamp: 0,
  data: null
};

// In-flight request de-duplication map (key -> Promise)
const inFlightRequests = new Map();

/**
 * Generate a cache / de-dupe key for a geographic query
 */
function makeQueryKey(lat, lon, radiusKm) {
  return `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)},${Number(radiusKm).toFixed(1)}`;
}

/**
 * Calculate exponential backoff duration with jitter
 */
function calculateBackoff(consecutiveErrors, isRateLimit = false) {
  if (isRateLimit) {
    // 429 Rate limit: minimum 15-second backoff
    return Math.min(MAX_BACKOFF_MS, 15000 * Math.pow(1.5, Math.max(0, consecutiveErrors - 1)));
  }
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.max(0, consecutiveErrors - 1)));
  const jitter = Math.random() * 1000;
  return Math.min(MAX_BACKOFF_MS, exp + jitter);
}

/**
 * Get current health and status of the data source provider system
 * Returns: { status: 'OK' | 'degraded' | 'offline', activeProvider: string, ... }
 */
export function getProviderStatus(isMock = false) {
  if (isMock) {
    return {
      status: 'OK',
      activeProvider: 'MOCK',
      consecutiveErrors: 0,
      isBackingOff: false,
      backoffRemainingMs: 0,
      lastSuccess: Date.now(),
      lastError: null,
      cacheAgeMs: 0
    };
  }

  const primary = PROVIDER_REGISTRY[0]?.name || 'Unknown';
  const primaryState = providerStates.get(primary);

  if (!primaryState) {
    return {
      status: 'offline',
      activeProvider: primary,
      consecutiveErrors: 0,
      lastSuccess: null,
      lastError: 'No providers initialized'
    };
  }

  const { consecutiveErrors, backoffUntil, lastSuccess, lastError } = primaryState;
  const isBackingOff = Date.now() < backoffUntil;

  let status = 'OK';
  if (consecutiveErrors >= 3 || (isBackingOff && consecutiveErrors >= 2)) {
    status = 'offline';
  } else if (consecutiveErrors > 0 || isBackingOff) {
    status = 'degraded';
  }

  return {
    status,
    activeProvider: primary,
    consecutiveErrors,
    isBackingOff,
    backoffRemainingMs: Math.max(0, backoffUntil - Date.now()),
    lastSuccess,
    lastError: lastError ? String(lastError) : null,
    cacheAgeMs: responseCache.data ? Math.max(0, Date.now() - responseCache.timestamp) : null
  };
}

/**
 * Fetch live aircraft near coordinates using the provider chain.
 * Transparently manages cache, in-flight coalescing, backoff, and fallback.
 * If mockProviderEnabled is true in settings, serves simulated flights without network requests.
 *
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {number} radiusKm - Query radius in km
 * @returns {Promise<Array<NormalizedFlight>>} Array of normalized flights
 */
export async function fetchFlightsNear(lat, lon, radiusKm) {
  // Check if mock provider is active
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const { settings } = await chrome.storage.local.get('settings');
      if (settings && settings.mockProviderEnabled) {
        return fetchMockFlightsNear(lat, lon, radiusKm);
      }
    }
  } catch (e) {}

  const key = makeQueryKey(lat, lon, radiusKm);
  const now = Date.now();

  // 1. Check response cache
  if (
    responseCache.data &&
    responseCache.key === key &&
    (now - responseCache.timestamp) < CACHE_TTL_MS
  ) {
    return Promise.resolve(responseCache.data);
  }

  // 2. Request de-duplication: join active in-flight request if present
  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key);
  }

  // 3. Initiate request pipeline
  const requestPromise = (async () => {
    let lastCaughtError = null;

    for (const provider of PROVIDER_REGISTRY) {
      const state = providerStates.get(provider.name);

      // Check if provider is currently backing off
      if (state && Date.now() < state.backoffUntil) {
        console.warn(`Airvee: Provider ${provider.name} in backoff (${Math.round((state.backoffUntil - Date.now()) / 1000)}s remaining), skipping.`);
        continue;
      }

      try {
        const flights = await provider.fetch(lat, lon, radiusKm);

        // Success: update provider state
        if (state) {
          state.consecutiveErrors = 0;
          state.backoffUntil = 0;
          state.lastSuccess = Date.now();
          state.lastError = null;
          state.lastHttpStatus = 200;
        }

        // Update response cache
        responseCache = {
          key,
          timestamp: Date.now(),
          data: flights
        };

        return flights;
      } catch (err) {
        lastCaughtError = err;
        const is429 = err.status === 429 || (err.message && err.message.includes('429'));

        if (state) {
          state.consecutiveErrors += 1;
          state.lastError = err.message || String(err);
          state.lastHttpStatus = err.status || null;
          const backoffMs = calculateBackoff(state.consecutiveErrors, is429);
          state.backoffUntil = Date.now() + backoffMs;
          console.warn(`Airvee: ${provider.name} failed (${err.message}). Consecutive errors: ${state.consecutiveErrors}. Backoff: ${Math.round(backoffMs / 1000)}s`);
        }
      }
    }

    // If cache data exists (even if expired within 30s), return it gracefully during downtime
    if (responseCache.data && (Date.now() - responseCache.timestamp) < 30000) {
      console.warn('Airvee: All providers failed, serving stale cached data as fallback.');
      return responseCache.data;
    }

    throw lastCaughtError || new Error('All flight providers unavailable');
  })().finally(() => {
    inFlightRequests.delete(key);
  });

  inFlightRequests.set(key, requestPromise);
  return requestPromise;
}
