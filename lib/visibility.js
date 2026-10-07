// ============================================================
//  AIRVEE — Visibility Hint & Solar Astronomy Engine
//  - Local sun elevation calculation (pure math, 0 network requests)
//  - Open-Meteo cloud cover integration with 30-min local cache
//  - Aircraft visibility classification (day/night/twilight + cloud deck)
// ============================================================

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes cache

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Calculate the exact solar elevation angle (degrees above the horizon)
 * for a given latitude, longitude, and timestamp using NOAA solar position equations.
 * Pure mathematical calculation with zero network requests.
 *
 * @param {number} lat - Observer latitude in degrees
 * @param {number} lon - Observer longitude in degrees
 * @param {Date|number} [date=new Date()] - UTC Date or epoch timestamp
 * @returns {number} Sun elevation in degrees (-90 to +90)
 */
export function calculateSunElevation(lat, lon, date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);

  // Julian Day
  const time = d.getTime();
  const jd = (time / 86400000) + 2440587.5;
  const t = (jd - 2451545.0) / 36525.0; // Julian centuries since J2000.0

  // Geometric Mean Longitude of Sun (degrees)
  let l0 = 280.46646 + t * (36000.76983 + 0.0003032 * t);
  l0 = ((l0 % 360) + 360) % 360;

  // Geometric Mean Anomaly of Sun (degrees)
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const mRad = m * DEG_TO_RAD;

  // Sun's Equation of Center
  const c = Math.sin(mRad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
            Math.sin(2 * mRad) * (0.019993 - 0.000101 * t) +
            Math.sin(3 * mRad) * 0.000289;

  // Sun's True Longitude
  const sunTrueLong = l0 + c;

  // Sun's Apparent Longitude
  const omega = 125.04 - 1934.136 * t;
  const lambda = sunTrueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG_TO_RAD);
  const lambdaRad = lambda * DEG_TO_RAD;

  // Mean Obliquity of Ecliptic
  const epsilon0 = 23.439291 - t * (0.0130042 + t * (0.00000016 - 0.000000504 * t));
  const epsilon = (epsilon0 + 0.00256 * Math.cos(omega * DEG_TO_RAD)) * DEG_TO_RAD;

  // Solar Declination (delta)
  const sinDelta = Math.sin(epsilon) * Math.sin(lambdaRad);
  const deltaRad = Math.asin(sinDelta);

  // Equation of Time (minutes)
  const y = Math.tan(epsilon / 2) * Math.tan(epsilon / 2);
  const l0Rad = l0 * DEG_TO_RAD;
  const eot = 4 * RAD_TO_DEG * (
    y * Math.sin(2 * l0Rad) -
    2 * 0.016708634 * Math.sin(mRad) +
    4 * 0.016708634 * y * Math.sin(mRad) * Math.cos(2 * l0Rad) -
    0.5 * y * y * Math.sin(4 * l0Rad) -
    1.25 * 0.016708634 * 0.016708634 * Math.sin(2 * mRad)
  );

  // Solar Time in minutes
  const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  let trueSolarTime = utcMinutes + 4 * lon + eot;
  trueSolarTime = ((trueSolarTime % 1440) + 1440) % 1440;

  // Hour Angle (degrees)
  let ha = (trueSolarTime / 4) - 180;
  if (ha < -180) ha += 360;
  const haRad = ha * DEG_TO_RAD;

  // Observer coordinates in radians
  const latRad = lat * DEG_TO_RAD;

  // Solar elevation angle
  const sinAlpha = Math.sin(latRad) * Math.sin(deltaRad) +
                   Math.cos(latRad) * Math.cos(deltaRad) * Math.cos(haRad);

  const alphaRad = Math.asin(Math.max(-1, Math.min(1, sinAlpha)));
  const elevationDeg = alphaRad * RAD_TO_DEG;

  return Math.round(elevationDeg * 10) / 10;
}

/**
 * Classify the sun elevation into natural lighting regimes.
 *
 * @param {number} sunElevation - Elevation angle in degrees
 * @returns {'day'|'golden_hour'|'civil_twilight'|'nautical_twilight'|'night'}
 */
export function getSunRegime(sunElevation) {
  if (sunElevation > 6.0) return 'day';
  if (sunElevation >= -2.0) return 'golden_hour';
  if (sunElevation >= -6.0) return 'civil_twilight';
  if (sunElevation >= -12.0) return 'nautical_twilight';
  return 'night';
}

/**
 * Convert cloud percentage (0-100) into standard aviation Oktas (0/8 to 8/8).
 */
export function percentToOktas(pct) {
  if (pct == null || isNaN(pct)) return '—';
  if (pct <= 5) return '0/8';
  if (pct <= 18) return '1/8';
  if (pct <= 32) return '2/8';
  if (pct <= 48) return '3/8';
  if (pct <= 62) return '4/8';
  if (pct <= 75) return '6/8';
  if (pct < 85) return '7/8';
  return '8/8';
}

/**
 * Fetch current cloud cover from Open-Meteo with local 30-minute caching.
 * Uses free, non-commercial open data API.
 *
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {object} [storage] - Storage backend with get and set (defaults to chrome.storage.local)
 * @param {Function} [fetchFn=fetch] - Fetch implementation (for tests)
 * @returns {Promise<object>} Cloud cover metrics
 */
export async function fetchCloudCover(lat, lon, storage = null, fetchFn = fetch) {
  const store = storage || (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local ? chrome.storage.local : null);
  const now = Date.now();

  // 1. Check local cache
  if (store) {
    try {
      const { weatherCache } = await store.get('weatherCache');
      if (
        weatherCache &&
        weatherCache.timestamp &&
        (now - weatherCache.timestamp) < CACHE_TTL_MS &&
        Math.abs(weatherCache.latitude - lat) < 0.1 &&
        Math.abs(weatherCache.longitude - lon) < 0.1
      ) {
        return { ...weatherCache.data, fromCache: true, cachedAt: weatherCache.timestamp };
      }
    } catch (e) {}
  }

  // 2. Fetch from Open-Meteo (coordinates rounded to 2 decimals / ~1 km for privacy)
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility`;

  try {
    const res = await fetchFn(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo HTTP ${res.status}`);
    }
    const json = await res.json();
    const current = json.current || {};

    const data = {
      cloudCover: Number(current.cloud_cover ?? 0),
      cloudCoverLow: Number(current.cloud_cover_low ?? 0),
      cloudCoverMid: Number(current.cloud_cover_mid ?? 0),
      cloudCoverHigh: Number(current.cloud_cover_high ?? 0),
      visibilityMeters: Number(current.visibility ?? 10000),
      updatedAt: now
    };

    // Save to cache
    if (store) {
      store.set({
        weatherCache: {
          latitude: lat,
          longitude: lon,
          timestamp: now,
          data
        }
      }).catch(() => {});
    }

    return { ...data, fromCache: false };
  } catch (err) {
    // If network fails, try fallback to expired cache if available
    if (store) {
      try {
        const { weatherCache } = await store.get('weatherCache');
        if (weatherCache && weatherCache.data) {
          return { ...weatherCache.data, fromCache: true, expired: true };
        }
      } catch (e) {}
    }

    // Default neutral fallback (clear sky assumed if offline)
    return {
      cloudCover: 0,
      cloudCoverLow: 0,
      cloudCoverMid: 0,
      cloudCoverHigh: 0,
      visibilityMeters: 10000,
      isFallback: true
    };
  }
}

/**
 * Classify optical visibility for a flight combining:
 * 1) Local Sun elevation regime (day / golden hour / civil twilight / nautical / night)
 * 2) Cloud cover (total and low/mid/high okta breakdown)
 * 3) Plane altitude and elevation angle relative to observer
 *
 * @param {object} flight - Flight data (altitude, elevationAtCpa, distance)
 * @param {object} options
 * @param {number} options.sunElevation - Calculated sun elevation in degrees
 * @param {object} [options.cloudData] - Cloud cover metrics from Open-Meteo
 * @returns {{ hint: string, regime: string, okta: string, contrast: string }}
 */
export function classifyVisibility(flight, options = {}) {
  const { sunElevation = 30, cloudData = {} } = options;
  const regime = getSunRegime(sunElevation);

  const totalCloud = cloudData.cloudCover != null ? cloudData.cloudCover : 0;
  const lowCloud = cloudData.cloudCoverLow != null ? cloudData.cloudCoverLow : 0;
  const highCloud = cloudData.cloudCoverHigh != null ? cloudData.cloudCoverHigh : 0;
  const okta = percentToOktas(totalCloud);

  const altFt = Number(flight.altitudeFt || flight.altitude || 30000);
  const elevDeg = Number(flight.elevationAtCpa != null ? flight.elevationAtCpa : (flight.currentElevation || 30));

  // --- 1. OVERCAST / HEAVY CLOUDS (totalCloud >= 80%) ---
  if (totalCloud >= 80) {
    // If low or mid cloud deck is thick and plane is cruising high (above 20k ft)
    if (lowCloud >= 60 && altFt >= 15000) {
      return {
        hint: `Overcast (${okta}) · contrail only if above cloud`,
        regime,
        okta,
        contrast: 'low'
      };
    }
    // High cirrus overcast (plane is below high cirrus or hazy)
    if (lowCloud < 30 && highCloud >= 70) {
      return {
        hint: `High thin overcast (${okta}) · visible through cirrus veil`,
        regime,
        okta,
        contrast: 'medium'
      };
    }
    if (regime === 'night') {
      return {
        hint: `Overcast (${okta}) · clouds diffuse strobe lights`,
        regime,
        okta,
        contrast: 'low'
      };
    }
    return {
      hint: `Overcast (${okta}) · obscured by cloud deck`,
      regime,
      okta,
      contrast: 'low'
    };
  }

  // --- 2. GOLDEN HOUR (-2° to +6°) ---
  if (regime === 'golden_hour') {
    if (totalCloud <= 40) {
      return {
        hint: 'Golden hour · belly illuminated',
        regime,
        okta,
        contrast: 'high'
      };
    }
    return {
      hint: `Golden hour (${okta}) · golden contrail through clouds`,
      regime,
      okta,
      contrast: 'medium'
    };
  }

  // --- 3. CIVIL TWILIGHT (-6° to -2°) ---
  if (regime === 'civil_twilight') {
    if (altFt >= 28000) {
      // Cruising planes at 30k+ ft still catch direct sunlight while ground is dusk
      return {
        hint: 'High altitude sunset · sunlit airframe against dusk',
        regime,
        okta,
        contrast: 'high'
      };
    }
    return {
      hint: 'Civil twilight · reflective airframe against darkening sky',
      regime,
      okta,
      contrast: 'medium'
    };
  }

  // --- 4. NAUTICAL TWILIGHT & NIGHT (< -6°) ---
  if (regime === 'night' || regime === 'nautical_twilight') {
    if (totalCloud >= 60) {
      return {
        hint: `Broken clouds (${okta}) · look for flashing strobes through gaps`,
        regime,
        okta,
        contrast: 'medium'
      };
    }
    // Deep clear night
    return {
      hint: 'Night · look for strobe lights',
      regime,
      okta,
      contrast: 'high'
    };
  }

  // --- 5. DAYTIME CLEAR / SCATTERED (sun > 6°) ---
  if (totalCloud <= 20) {
    if (elevDeg >= 45) {
      return {
        hint: 'Clear sky · high contrast',
        regime,
        okta,
        contrast: 'high'
      };
    }
    return {
      hint: 'Clear sky · clean silhouette on horizon',
      regime,
      okta,
      contrast: 'high'
    };
  }

  // Scattered or broken daytime clouds
  return {
    hint: `Scattered clouds (${okta}) · direct visual between cloud gaps`,
    regime,
    okta,
    contrast: 'medium'
  };
}
