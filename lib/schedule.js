// ============================================================
//  AIRVEE — Learned Schedule & Heatmap Engine
//  - 24h x 7-day traffic density heatmap
//  - Heartbeat gap detection (extension closed / sleeping)
//  - Recurring schedule prediction (±20 min window, ≥3 of last 7 days)
//  - Passed-today detection and status
// ============================================================

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const GAP_THRESHOLD_MS = 35 * MS_PER_MINUTE; // 35 min idle = gap

/**
 * Record a heartbeat timestamp and detect sleep/shutdown gaps.
 *
 * @param {number} [now=Date.now()]
 * @param {object} [storage] - Mockable storage object with get and set
 * @returns {Promise<{ isGap: boolean, gap?: { start: number, end: number } }>}
 */
export async function recordHeartbeat(now = Date.now(), storage = null) {
  const store = storage || (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local ? chrome.storage.local : null);
  if (!store) {
    return { isGap: false };
  }

  try {
    const data = await store.get(['lastHeartbeat', 'heartbeatGaps', 'activeHourBuckets']);
    const lastHeartbeat = data.lastHeartbeat || null;
    const gaps = Array.isArray(data.heartbeatGaps) ? [...data.heartbeatGaps] : [];
    const buckets = data.activeHourBuckets || {};

    let detectedGap = null;
    if (lastHeartbeat && (now - lastHeartbeat) > GAP_THRESHOLD_MS) {
      detectedGap = { start: lastHeartbeat, end: now };
      gaps.push(detectedGap);
      // Keep recent 50 gaps, prune older than 14 days
      const cutoff = now - (14 * MS_PER_DAY);
      const prunedGaps = gaps.filter(g => g.end >= cutoff).slice(-50);
      gaps.length = 0;
      gaps.push(...prunedGaps);
    }

    // Mark current hour bucket
    const d = new Date(now);
    const bucketKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}`;
    buckets[bucketKey] = now;

    // Prune buckets older than 14 days
    const bucketCutoff = now - (14 * MS_PER_DAY);
    for (const [k, ts] of Object.entries(buckets)) {
      if (ts < bucketCutoff) delete buckets[k];
    }

    await store.set({
      lastHeartbeat: now,
      heartbeatGaps: gaps,
      activeHourBuckets: buckets
    });

    return { isGap: Boolean(detectedGap), gap: detectedGap };
  } catch (err) {
    console.warn('Airvee: Failed to record heartbeat:', err);
    return { isGap: false };
  }
}

/**
 * Format a time range string e.g. "14:10 – 14:50".
 */
export function formatTimeWindow(startMinutes, endMinutes) {
  const normalize = (m) => ((m % 1440) + 1440) % 1440;
  const s = normalize(startMinutes);
  const e = normalize(endMinutes);

  const pad = (n) => String(n).padStart(2, '0');
  const sH = Math.floor(s / 60);
  const sM = s % 60;
  const eH = Math.floor(e / 60);
  const eM = e % 60;

  return `${pad(sH)}:${pad(sM)} – ${pad(eH)}:${pad(eM)}`;
}

/**
 * Predict flights likely to fly over today based on recurring patterns
 * (same flight number/prefix+route passing within ±20 min on ≥3 of last 7 days).
 *
 * @param {Array<object>} records - Flight log records from IndexedDB
 * @param {number} [now=Date.now()]
 * @param {object} [options]
 * @param {number} [options.minDaysThreshold=3] - Min distinct days required (default 3)
 * @param {number} [options.windowMinutes=20] - ± window around typical pass time (default 20)
 * @returns {Array<object>} Sorted predicted flight objects
 */
export function predictLikelyFlightsToday(records, now = Date.now(), options = {}) {
  const { minDaysThreshold = 3, windowMinutes = 20 } = options;

  // 1. Filter out mock flights and entries older than 7 days
  const validRecords = (records || []).filter(r => !r.isMock && r.source !== 'mock');
  const start7DaysAgo = now - (7 * MS_PER_DAY);
  const recentRecords = validRecords.filter(r => Number(r.timestamp || 0) >= start7DaysAgo);

  const nowDate = new Date(now);
  const todayDateStr = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;
  const nowMinuteOfDay = nowDate.getHours() * 60 + nowDate.getMinutes();

  // Find all passes that have already occurred TODAY
  const todayPasses = validRecords.filter(r => {
    const dStr = r.dateStr || (new Date(r.timestamp)).toISOString().split('T')[0];
    return dStr === todayDateStr;
  });

  // 2. Group historical records by unique flight key:
  // Prefer flightNumber (e.g. "EK504"), fallback to callsign prefix + route
  const flightGroups = new Map();

  for (const r of recentRecords) {
    const fn = String(r.flightNumber || r.callsign || '').trim().toUpperCase();
    if (!fn || fn === '—') continue;

    const route = (r.origin && r.destination) ? `${r.origin} → ${r.destination}` : (r.route || '');
    // Group key: flight number + route if available
    const groupKey = `${fn}_${route}`;

    if (!flightGroups.has(groupKey)) {
      flightGroups.set(groupKey, {
        flightNumber: fn,
        callsign: r.callsign || fn,
        airline: r.airline || 'Unknown Airline',
        airlineIcao: r.airlineIcao || '',
        route: route || 'En route',
        origin: r.origin || '',
        destination: r.destination || '',
        passes: []
      });
    }

    const d = new Date(r.timestamp);
    const minuteOfDay = d.getHours() * 60 + d.getMinutes();
    const dateStr = r.dateStr || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    flightGroups.get(groupKey).passes.push({
      timestamp: r.timestamp,
      dateStr,
      minuteOfDay,
      aircraftType: (r.aircraftType || '').trim().toUpperCase()
    });
  }

  const predictions = [];

  // 3. For each group, find clustering within ±windowMinutes across distinct calendar days
  for (const [key, group] of flightGroups.entries()) {
    // Deduplicate passes by calendar day to find the dominant daily window
    const dayMap = new Map();
    for (const p of group.passes) {
      if (!dayMap.has(p.dateStr)) {
        dayMap.set(p.dateStr, []);
      }
      dayMap.get(p.dateStr).push(p);
    }

    // Need at least minDaysThreshold distinct days in the last 7 days
    if (dayMap.size < minDaysThreshold) {
      continue;
    }

    // For candidate target minutes, test each pass's minuteOfDay as a potential cluster center
    let bestCluster = null;
    let maxClusterDays = 0;

    const allPasses = group.passes;
    for (const candidate of allPasses) {
      const targetMin = candidate.minuteOfDay;
      const matchingDays = new Set();
      const clusterPasses = [];

      for (const p of allPasses) {
        // Compute circular minute difference (handling midnight wrap)
        let diff = Math.abs(p.minuteOfDay - targetMin);
        if (diff > 720) diff = 1440 - diff;

        if (diff <= windowMinutes) {
          matchingDays.add(p.dateStr);
          clusterPasses.push(p);
        }
      }

      if (matchingDays.size > maxClusterDays) {
        maxClusterDays = matchingDays.size;
        bestCluster = {
          centerMinute: targetMin,
          matchingDays,
          clusterPasses
        };
      }
    }

    if (!bestCluster || bestCluster.matchingDays.size < minDaysThreshold) {
      continue;
    }

    // Calculate refined mean minute within the cluster
    const clusterMinutes = bestCluster.clusterPasses.map(p => p.minuteOfDay);
    const avgMinute = Math.round(clusterMinutes.reduce((a, b) => a + b, 0) / clusterMinutes.length);
    const windowStartMin = avgMinute - windowMinutes;
    const windowEndMin = avgMinute + windowMinutes;

    // Determine dominant aircraft type seen on this flight
    const typeCounts = {};
    for (const p of bestCluster.clusterPasses) {
      if (p.aircraftType && p.aircraftType !== '—') {
        typeCounts[p.aircraftType] = (typeCounts[p.aircraftType] || 0) + 1;
      }
    }
    const typicalType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Aircraft';

    // 4. Check if already passed today
    const passedRecordToday = todayPasses.find(r => {
      const matchFn = String(r.flightNumber || r.callsign || '').trim().toUpperCase() === group.flightNumber;
      if (!matchFn) return false;
      const d = new Date(r.timestamp);
      const m = d.getHours() * 60 + d.getMinutes();
      let diff = Math.abs(m - avgMinute);
      if (diff > 720) diff = 1440 - diff;
      return diff <= (windowMinutes + 25);
    });

    const hasPassedToday = Boolean(passedRecordToday);
    const passedAtStr = passedRecordToday ? formatClockTime(new Date(passedRecordToday.timestamp)) : null;

    // Check if the scheduled window has fully elapsed for today without sighting
    const isOverdue = !hasPassedToday && (nowMinuteOfDay > (windowEndMin + 15));

    // ETA to window start (or remaining until window end)
    let etaMinutes = null;
    let etaLabel = '';
    if (!hasPassedToday && !isOverdue) {
      const diffToStart = windowStartMin - nowMinuteOfDay;
      if (diffToStart > 0) {
        etaMinutes = diffToStart;
        etaLabel = diffToStart < 60 ? `IN ${diffToStart}M` : `IN ${(diffToStart / 60).toFixed(1)}H`;
      } else if (nowMinuteOfDay >= windowStartMin && nowMinuteOfDay <= windowEndMin) {
        etaMinutes = 0;
        etaLabel = 'EXPECTED NOW';
      }
    }

    predictions.push({
      id: key,
      flightNumber: group.flightNumber,
      callsign: group.callsign,
      airline: group.airline,
      airlineIcao: group.airlineIcao,
      route: group.route,
      aircraftType: typicalType,
      windowStartMin,
      windowEndMin,
      windowStr: formatTimeWindow(windowStartMin, windowEndMin),
      typicalMinute: avgMinute,
      daysSeen: bestCluster.matchingDays.size,
      confidenceStr: `Seen ${bestCluster.matchingDays.size} of last 7 days`,
      hasPassedToday,
      passedAtStr,
      isOverdue,
      etaMinutes,
      etaLabel
    });
  }

  // 5. Deduplicate by flightNumber keeping the highest confidence cluster
  const dedupeMap = new Map();
  for (const pred of predictions) {
    if (!dedupeMap.has(pred.flightNumber) || dedupeMap.get(pred.flightNumber).daysSeen < pred.daysSeen) {
      dedupeMap.set(pred.flightNumber, pred);
    }
  }

  const result = Array.from(dedupeMap.values());

  // 6. Sort: upcoming first (by time window), then passed/overdue at bottom
  result.sort((a, b) => {
    if (a.hasPassedToday !== b.hasPassedToday) {
      return a.hasPassedToday ? 1 : -1;
    }
    if (a.isOverdue !== b.isOverdue) {
      return a.isOverdue ? 1 : -1;
    }
    return a.typicalMinute - b.typicalMinute;
  });

  return result;
}

function formatClockTime(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Compute the 24h x 7-day traffic density heatmap matrix
 * with heartbeat gap detection (extension closed/offline periods).
 *
 * @param {Array<object>} records - All flight logs from IndexedDB
 * @param {object} [heartbeatData] - Object with { heartbeatGaps: [], activeHourBuckets: {}, lastHeartbeat }
 * @param {number} [now=Date.now()]
 * @returns {object} { grid, maxCount, totalPasses, days }
 */
export function computeHeatmapData(records, heartbeatData = {}, now = Date.now()) {
  const validRecords = (records || []).filter(r => !r.isMock && r.source !== 'mock');
  const gaps = heartbeatData.heartbeatGaps || [];
  const activeBuckets = heartbeatData.activeHourBuckets || {};

  // Days ordered Monday (0) to Sunday (6)
  const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

  // Initialize 7x24 grid
  const grid = [];
  for (let d = 0; d < 7; d++) {
    const row = [];
    for (let h = 0; h < 24; h++) {
      row.push({
        dayIndex: d,
        dayName: DAY_NAMES[d],
        hour: h,
        count: 0,
        isGap: false,
        gapText: '',
        isFuture: false
      });
    }
    grid.push(row);
  }

  // Calculate the dates for the last 7 calendar days
  const nowDate = new Date(now);
  const currentDayOfWeekIso = (nowDate.getDay() + 6) % 7; // Monday=0 ... Sunday=6
  const currentHour = nowDate.getHours();

  // Populate pass counts from records
  const start7DaysAgo = now - (7 * MS_PER_DAY);
  let totalPasses = 0;

  for (const r of validRecords) {
    const ts = Number(r.timestamp);
    if (!ts || isNaN(ts) || ts < start7DaysAgo) continue;

    const d = new Date(ts);
    const dayIso = (d.getDay() + 6) % 7; // 0=Mon ... 6=Sun
    const hour = d.getHours();

    if (dayIso >= 0 && dayIso < 7 && hour >= 0 && hour < 24) {
      grid[dayIso][hour].count++;
      totalPasses++;
    }
  }

  // Detect heartbeat gaps and mark cells where the extension was offline/closed
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const cell = grid[d][h];

      // If flight was recorded in this hour, it was active
      if (cell.count > 0) continue;

      // Check if this (day, hour) corresponds to a known gap in the past 7 days
      // Iterate through recorded gaps to see if any covers this day of week & hour
      for (const gap of gaps) {
        const gapStart = new Date(gap.start);
        const gapEnd = new Date(gap.end);

        // Check if gap occurred within the last 7 days
        if (gap.end < start7DaysAgo) continue;

        const gapStartDayIso = (gapStart.getDay() + 6) % 7;
        const gapEndDayIso = (gapEnd.getDay() + 6) % 7;

        let touches = false;
        if (gapStartDayIso === gapEndDayIso) {
          if (d === gapStartDayIso && h >= gapStart.getHours() && h <= gapEnd.getHours()) {
            touches = true;
          }
        } else {
          if (d === gapStartDayIso && h >= gapStart.getHours()) touches = true;
          else if (d === gapEndDayIso && h <= gapEnd.getHours()) touches = true;
          else if (d > gapStartDayIso && d < gapEndDayIso) touches = true;
        }

        if (touches) {
          cell.isGap = true;
          const sStr = formatClockTime(gapStart);
          const eStr = formatClockTime(gapEnd);
          cell.gapText = `No data recorded ${sStr} to ${eStr}`;
          break;
        }
      }
    }
  }

  // Find max count for density shading scale
  let maxCount = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (grid[d][h].count > maxCount) {
        maxCount = grid[d][h].count;
      }
    }
  }

  return {
    grid,
    maxCount,
    totalPasses,
    dayNames: DAY_NAMES
  };
}
