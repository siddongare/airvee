// ============================================================
//  Unit Tests for Aircraft Photo Engine
// ============================================================

import {
  cleanRegistration,
  formatPhotoAttribution,
  fetchAircraftPhoto,
  PHOTO_CACHE_KEY,
  PLANESPOTTERS_USER_AGENT
} from '../lib/photos.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  ✓ ${message}`);
    passed++;
  }
}

// In-memory mock storage
function createMockStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (key) => ({ [key]: data[key] }),
    set: async (obj) => {
      Object.assign(data, obj);
    }
  };
}

console.log('\n--- 1. Registration Sanitization & Validation ---');
assert(cleanRegistration('A6-EOH') === 'A6-EOH', 'Valid standard registration');
assert(cleanRegistration('vt-exf') === 'VT-EXF', 'Converts lowercase to uppercase');
assert(cleanRegistration('  n12345  ') === 'N12345', 'Trims whitespace');
assert(cleanRegistration('G-XWBA') === 'G-XWBA', 'Preserves hyphens');
assert(cleanRegistration(null) === null, 'Rejects null');
assert(cleanRegistration(undefined) === null, 'Rejects undefined');
assert(cleanRegistration('') === null, 'Rejects empty string');
assert(cleanRegistration('   ') === null, 'Rejects whitespace only');
assert(cleanRegistration('—') === null, 'Rejects em-dash placeholder');
assert(cleanRegistration('-') === null, 'Rejects single hyphen');
assert(cleanRegistration('UNKNOWN') === null, 'Rejects UNKNOWN placeholder');
assert(cleanRegistration('NONE') === null, 'Rejects NONE placeholder');
assert(cleanRegistration('A') === null, 'Rejects single letter (too short)');
assert(cleanRegistration('ABCDEFGHIJKLMNO') === null, 'Rejects excessively long string');
assert(cleanRegistration('VT@123') === null, 'Rejects invalid characters');

console.log('\n--- 2. Photographer Attribution Formatting ---');
const samplePhoto = {
  registration: 'A6-EOH',
  photographer: 'Jane Doe',
  link: 'https://www.planespotters.net/photo/12345'
};
assert(
  formatPhotoAttribution(samplePhoto) === 'Photo © Jane Doe / Planespotters.net',
  'Formats photographer attribution string'
);
assert(
  formatPhotoAttribution({ registration: 'A6-EOH' }) === 'Photo © Planespotters.net / Planespotters.net',
  'Falls back gracefully when photographer name missing'
);
assert(formatPhotoAttribution(null) === '', 'Returns empty string for null photo');

console.log('\n--- 3. Opt-in Toggle Enforcement ---');
let fetchCallCount = 0;
const mockFetch = async () => {
  fetchCallCount++;
  return { ok: true, json: async () => ({ photos: [] }) };
};

const disabledResult = await fetchAircraftPhoto('A6-EOH', {
  enabled: false,
  fetchFn: mockFetch
});
assert(disabledResult === null, 'Disabled opt-in returns null immediately');
assert(fetchCallCount === 0, 'Zero network calls when showAircraftPhotos is disabled');

console.log('\n--- 4. Cache Hit Verification ---');
const preloadedStore = createMockStorage({
  [PHOTO_CACHE_KEY]: {
    'A6-EOH': {
      photo: {
        registration: 'A6-EOH',
        thumbnailUrl: 'https://t.plnspttrs.net/thumb.jpg',
        largeUrl: 'https://t.plnspttrs.net/large.jpg',
        photographer: 'LIN',
        link: 'https://www.planespotters.net/photo/1966763',
        source: 'Planespotters.net'
      },
      timestamp: Date.now()
    }
  }
});

let cacheFetchCalls = 0;
const cachedPhoto = await fetchAircraftPhoto('A6-EOH', {
  enabled: true,
  storage: preloadedStore,
  fetchFn: async () => { cacheFetchCalls++; return null; }
});
assert(cachedPhoto !== null, 'Retrieved cached photo');
assert(cachedPhoto.fromCache === true, 'Marked as fromCache: true');
assert(cachedPhoto.photographer === 'LIN', 'Photographer LIN preserved');
assert(cacheFetchCalls === 0, 'Zero network calls made on cache hit');

console.log('\n--- 5. Fresh Fetch from Planespotters.net & Caching ---');
const freshStore = createMockStorage();
let lastRequestedUrl = '';
let lastRequestedHeaders = {};

const mockSuccessFetch = async (url, opts) => {
  lastRequestedUrl = url;
  lastRequestedHeaders = opts.headers || {};
  return {
    ok: true,
    json: async () => ({
      photos: [
        {
          id: '999888',
          thumbnail: { src: 'https://t.plnspttrs.net/thumb_999888.jpg', size: { width: 200, height: 133 } },
          thumbnail_large: { src: 'https://t.plnspttrs.net/large_999888.jpg', size: { width: 420, height: 280 } },
          link: 'https://www.planespotters.net/photo/999888',
          photographer: 'Alex Spotter'
        }
      ]
    })
  };
};

const fetchedPhoto = await fetchAircraftPhoto('VT-EXF', {
  enabled: true,
  storage: freshStore,
  fetchFn: mockSuccessFetch
});

assert(fetchedPhoto !== null, 'Successfully fetched photo');
assert(fetchedPhoto.registration === 'VT-EXF', 'Registration matches VT-EXF');
assert(fetchedPhoto.photographer === 'Alex Spotter', 'Photographer correctly extracted');
assert(fetchedPhoto.largeUrl === 'https://t.plnspttrs.net/large_999888.jpg', 'Large thumbnail URL extracted');
assert(lastRequestedUrl.includes('pub/photos/reg/VT-EXF'), 'Correct API endpoint called');
assert(lastRequestedHeaders['User-Agent'] === PLANESPOTTERS_USER_AGENT, 'Contact URL included in User-Agent');

// Verify written to storage cache
const storedCache = freshStore.data[PHOTO_CACHE_KEY];
assert(storedCache && storedCache['VT-EXF'] != null, 'Photo saved into persistent local cache');
assert(storedCache['VT-EXF'].photo.photographer === 'Alex Spotter', 'Cached photo details match');

console.log('\n--- 6. Negative Cache Handling (Photo Not Found) ---');
const missingStore = createMockStorage();
const mockEmptyFetch = async () => ({
  ok: true,
  json: async () => ({ photos: [] })
});

const notFoundResult = await fetchAircraftPhoto('VT-NONEXIST', {
  enabled: true,
  storage: missingStore,
  fetchFn: mockEmptyFetch
});
assert(notFoundResult === null, 'Returns null when no photos exist');

const missingCache = missingStore.data[PHOTO_CACHE_KEY];
assert(missingCache && missingCache['VT-NONEXIST']?.notFound === true, 'Negative cache recorded for missing airframe');

let repeatFetchCalls = 0;
const repeatResult = await fetchAircraftPhoto('VT-NONEXIST', {
  enabled: true,
  storage: missingStore,
  fetchFn: async () => { repeatFetchCalls++; return null; }
});
assert(repeatResult === null, 'Negative cache hit returns null');
assert(repeatFetchCalls === 0, 'Negative cache avoids duplicate network requests');

console.log('\n--- 7. Network / API Error Resilience ---');
const errorStore = createMockStorage();
const mockErrorFetch = async () => {
  throw new Error('Network timeout');
};

const errorResult = await fetchAircraftPhoto('N12345', {
  enabled: true,
  storage: errorStore,
  fetchFn: mockErrorFetch
});
assert(errorResult === null, 'Gracefully returns null on network failure without throwing');

console.log('\n========================================');
console.log(`PHOTOS TEST SUMMARY: ${passed} passed, ${failed} failed.`);
console.log('========================================\n');

if (failed > 0) process.exit(1);
