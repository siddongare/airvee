// ============================================================
//  AIRVEE — Aircraft Photo Engine
//  - Opt-in lookup of real aircraft photos via Planespotters.net API
//  - Strict photographer attribution compliance
//  - Persistent local caching (chrome.storage.local) to avoid repeat network queries
//  - Graceful fallback when disabled, offline, or photo unavailable
// ============================================================

export const PHOTO_CACHE_KEY = 'photoCache';
export const PHOTO_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days for successful photo
export const NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;   // 24 hours for not-found
export const PLANESPOTTERS_USER_AGENT = 'AirveeFlightRadar/2.0 (+https://github.com/siddongare/airvee)';

/**
 * Sanitize and validate an aircraft registration string.
 *
 * @param {string} raw - e.g. "A6-EOH", "vt-exf", "—", "UNKNOWN"
 * @returns {string|null} Clean registration or null if invalid
 */
export function cleanRegistration(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().toUpperCase();
  if (
    !trimmed ||
    trimmed === '—' ||
    trimmed === '-' ||
    trimmed === 'UNKNOWN' ||
    trimmed === 'NONE' ||
    trimmed.length < 2 ||
    trimmed.length > 12
  ) {
    return null;
  }
  // Allow letters, digits, and hyphens (standard ICAO/FAA registrations)
  if (!/^[A-Z0-9\-]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Format mandatory photographer attribution string.
 * Planespotters.net API Terms require photographer credit.
 *
 * @param {object} photo - Photo object
 * @returns {string} e.g. "Photo © Jane Doe / Planespotters.net"
 */
export function formatPhotoAttribution(photo) {
  if (!photo) return '';
  const photographer = photo.photographer ? photo.photographer.trim() : 'Planespotters.net';
  return `Photo © ${photographer} / Planespotters.net`;
}

/**
 * Query Planespotters.net photo API for an aircraft registration
 * with local caching and negative cache handling.
 *
 * @param {string} registration - Aircraft registration (e.g. "A6-EOH")
 * @param {object} [options]
 * @param {boolean} [options.enabled=true] - Opt-in toggle check
 * @param {object} [options.storage] - Storage interface with get and set
 * @param {Function} [options.fetchFn=fetch] - Custom fetch function for testing
 * @param {string} [options.userAgent] - Custom User-Agent header
 * @returns {Promise<object|null>} Photo object or null
 */
export async function fetchAircraftPhoto(registration, options = {}) {
  const {
    enabled = true,
    storage = null,
    fetchFn = (typeof fetch !== 'undefined' ? fetch : null),
    userAgent = PLANESPOTTERS_USER_AGENT
  } = options;

  if (!enabled) return null;

  const cleanReg = cleanRegistration(registration);
  if (!cleanReg) return null;

  const store = storage || (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local ? chrome.storage.local : null);
  const now = Date.now();

  // 1. Check local cache
  if (store) {
    try {
      const res = await store.get(PHOTO_CACHE_KEY);
      const cache = res && res[PHOTO_CACHE_KEY] ? res[PHOTO_CACHE_KEY] : {};
      const entry = cache[cleanReg];

      if (entry) {
        if (entry.notFound) {
          if (now - entry.timestamp < NEGATIVE_CACHE_TTL_MS) {
            return null; // Negative cache hit
          }
        } else if (entry.photo && (now - entry.timestamp < PHOTO_CACHE_TTL_MS)) {
          return {
            ...entry.photo,
            fromCache: true,
            cachedAt: entry.timestamp
          };
        }
      }
    } catch (e) {
      // Storage read error, fall through to fetch
    }
  }

  if (!fetchFn) return null;

  // 2. Fetch from Planespotters.net Public API
  const apiUrl = `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(cleanReg)}`;

  try {
    const response = await fetchFn(apiUrl, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      // Record negative cache on 404 or 400
      await writeCacheEntry(store, cleanReg, { notFound: true, timestamp: now });
      return null;
    }

    const data = await response.json();
    const photos = data && Array.isArray(data.photos) ? data.photos : [];

    if (photos.length === 0) {
      // Valid query, but no photos available for this airframe
      await writeCacheEntry(store, cleanReg, { notFound: true, timestamp: now });
      return null;
    }

    const first = photos[0];
    const photo = {
      registration: cleanReg,
      thumbnailUrl: first.thumbnail?.src || '',
      largeUrl: first.thumbnail_large?.src || first.thumbnail?.src || '',
      photographer: first.photographer || 'Planespotters.net',
      link: first.link || `https://www.planespotters.net/search?q=${encodeURIComponent(cleanReg)}`,
      source: 'Planespotters.net',
      width: first.thumbnail_large?.size?.width || first.thumbnail?.size?.width || 420,
      height: first.thumbnail_large?.size?.height || first.thumbnail?.size?.height || 280
    };

    await writeCacheEntry(store, cleanReg, { photo, timestamp: now });
    return photo;
  } catch (err) {
    console.warn(`Airvee: Planespotters photo fetch error for ${cleanReg}:`, err.message);
    return null;
  }
}

/**
 * Helper to update the persistent photo cache safely.
 */
async function writeCacheEntry(store, regKey, entry) {
  if (!store) return;
  try {
    const res = await store.get(PHOTO_CACHE_KEY);
    const cache = res && res[PHOTO_CACHE_KEY] ? res[PHOTO_CACHE_KEY] : {};
    cache[regKey] = entry;

    // Prune cache if it grows past 400 entries (keep most recent)
    const keys = Object.keys(cache);
    if (keys.length > 400) {
      const sorted = keys.sort((a, b) => (cache[b]?.timestamp || 0) - (cache[a]?.timestamp || 0));
      const pruned = {};
      sorted.slice(0, 300).forEach(k => {
        pruned[k] = cache[k];
      });
      await store.set({ [PHOTO_CACHE_KEY]: pruned });
      return;
    }

    await store.set({ [PHOTO_CACHE_KEY]: cache });
  } catch (e) {
    // Non-blocking
  }
}
