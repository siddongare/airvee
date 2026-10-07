// ============================================================
//  AIRVEE — Audio Engine & Quiet Hours Manager
//  - Airport PA double-chime synthesis (587Hz D5 -> 880Hz A5)
//  - Dual-Engine Playback: Web Audio API + HTML5 Audio WAV fallback
//  - Volume normalization (0-100%)
//  - Quiet Hours logic (visual-only notification window)
// ============================================================

/**
 * Check if the current time falls within configured Quiet Hours.
 *
 * @param {object} settings
 * @returns {boolean} True if quiet hours active (audio should be muted)
 */
export function isQuietHours(settings) {
  if (!settings || !settings.quietHoursEnabled) return false;
  if (!settings.quietHoursStart || !settings.quietHoursEnd) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = settings.quietHoursStart.split(':').map(Number);
  const [endH, endM] = settings.quietHoursEnd.split(':').map(Number);

  if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) return false;

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // Normal window: e.g. 13:00 to 15:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight window: e.g. 23:00 to 07:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

/**
 * Generate calendar day string (YYYY-MM-DD) for 24-hr flight alert deduplication.
 *
 * @param {Date} [date=new Date()]
 * @returns {string} Calendar day key
 */
export function getCalendarDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Cached WAV data URI for instantaneous fallback playback
let cachedWavDataUri = null;
let activeAudioElement = null;
let persistentAudioCtx = null;

/**
 * Generate an authentic 16-bit PCM WAV Airport PA chime as a Data URI.
 * Normalized to 92% peak volume for crisp, unmistakable audibility.
 *
 * Tone 1: 587.33 Hz (D5) - Terminal chime strike
 * Tone 2: 880.00 Hz (A5) - High announcement bell
 */
export function generateChimeWavDataUri() {
  const sampleRate = 22050;
  const numChannels = 1;
  const bitsPerSample = 16;
  const duration = 1.25; // 1.25 seconds
  const numSamples = Math.floor(sampleRate * duration);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF Header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Synthesize: D5 (587.33 Hz) 0.0s - 0.40s, then A5 (880.00 Hz) 0.35s - 1.25s
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    // First bell (D5)
    if (t < 0.45) {
      const env = Math.sin(Math.min(1, t / 0.02) * Math.PI * 0.5) * Math.exp(-t * 3.5);
      const tone = Math.sin(2 * Math.PI * 587.33 * t) * 0.75 +
                   Math.sin(2 * Math.PI * 1174.66 * t) * 0.20 +
                   Math.sin(2 * Math.PI * 1761.99 * t) * 0.05;
      sample += tone * env;
    }

    // Second bell (A5)
    if (t >= 0.32) {
      const t2 = t - 0.32;
      const env2 = Math.sin(Math.min(1, t2 / 0.02) * Math.PI * 0.5) * Math.exp(-t2 * 2.8);
      const tone2 = Math.sin(2 * Math.PI * 880.00 * t2) * 0.75 +
                    Math.sin(2 * Math.PI * 1760.00 * t2) * 0.20 +
                    Math.sin(2 * Math.PI * 2640.00 * t2) * 0.05;
      sample += tone2 * env2;
    }

    // High fidelity clipping guard with 92% peak normalization
    const val = Math.max(-0.95, Math.min(0.95, sample)) * 0.95;
    view.setInt16(offset, val < 0 ? val * 0x8000 : val * 0x7FFF, true);
    offset += 2;
  }

  // Convert buffer to base64
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + (typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64'));
}

export function getChimeWavDataUri() {
  if (!cachedWavDataUri) {
    cachedWavDataUri = generateChimeWavDataUri();
  }
  return cachedWavDataUri;
}

/**
 * Play chime using HTML5 Audio element with bundled WAV data URI.
 * Retains audio reference in module scope to prevent Chrome garbage collection.
 */
export function playWavFallbackChime(volumePercent = 80) {
  try {
    const dataUri = getChimeWavDataUri();
    if (activeAudioElement) {
      try {
        activeAudioElement.pause();
        activeAudioElement.currentTime = 0;
      } catch (e) {}
    }

    const audio = new Audio(dataUri);
    activeAudioElement = audio;
    const vol = Math.max(0, Math.min(100, Number(volumePercent) || 80)) / 100;
    audio.volume = vol;

    audio.onended = () => {
      if (activeAudioElement === audio) {
        activeAudioElement = null;
      }
    };

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      return playPromise.catch((err) => {
        console.warn('Airvee: HTML5 Audio play promise failed:', err);
        throw err;
      });
    }
    return Promise.resolve();
  } catch (err) {
    console.warn('Airvee: HTML5 audio fallback error:', err);
    return Promise.reject(err);
  }
}

/**
 * Synthesize an authentic Airport PA double-chime (D5 587Hz then A5 880Hz)
 * using Web Audio API or instant HTML5 Audio fallback.
 *
 * @param {number} [volumePercent=80] - Configured volume (0 to 100)
 * @returns {Promise<void>}
 */
export async function playAirportDoubleChime(volumePercent = 80) {
  const AudioCtx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ||
                   (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext));

  if (!AudioCtx) {
    return playWavFallbackChime(volumePercent);
  }

  try {
    if (!persistentAudioCtx || persistentAudioCtx.state === 'closed') {
      persistentAudioCtx = new AudioCtx();
    }

    const ctx = persistentAudioCtx;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // If still suspended (browser autoplay policy), immediately invoke WAV playback
    if (ctx.state === 'suspended') {
      return playWavFallbackChime(volumePercent);
    }

    const vol = Math.max(0, Math.min(100, Number(volumePercent) || 80)) / 100;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(vol * 0.9, ctx.currentTime);
    masterGain.connect(ctx.destination);

    // Acoustic delay reflection
    const delay = ctx.createDelay(0.5);
    delay.delayTime.setValueAtTime(0.08, ctx.currentTime);
    const delayFeedback = ctx.createGain();
    delayFeedback.gain.setValueAtTime(0.2, ctx.currentTime);

    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    delayFeedback.connect(masterGain);

    // Notes: D5 (587.33 Hz) and A5 (880.00 Hz)
    const notes = [
      { freq: 587.33, start: 0.00, duration: 0.42, attack: 0.015 },
      { freq: 880.00, start: 0.32, duration: 0.85, attack: 0.015 }
    ];

    notes.forEach(({ freq, start, duration, attack }) => {
      const t = ctx.currentTime + start;

      const oscSine = ctx.createOscillator();
      oscSine.type = 'sine';
      oscSine.frequency.setValueAtTime(freq, t);

      const oscTri = ctx.createOscillator();
      oscTri.type = 'triangle';
      oscTri.frequency.setValueAtTime(freq, t);

      const noteGain = ctx.createGain();
      const triGain = ctx.createGain();
      triGain.gain.setValueAtTime(0.3, t);

      noteGain.gain.setValueAtTime(0.0001, t);
      noteGain.gain.linearRampToValueAtTime(0.95, t + attack);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

      oscSine.connect(noteGain);
      oscTri.connect(triGain);
      triGain.connect(noteGain);

      noteGain.connect(masterGain);
      noteGain.connect(delay);

      oscSine.start(t);
      oscTri.start(t);
      oscSine.stop(t + duration + 0.05);
      oscTri.stop(t + duration + 0.05);
    });

    return Promise.resolve();
  } catch (audioErr) {
    console.warn('Airvee: Web Audio failed, playing WAV fallback:', audioErr.message);
    return playWavFallbackChime(volumePercent);
  }
}

// Cached WAV data URI for Special Alert chime
let cachedSpecialWavDataUri = null;

/**
 * Generate a distinct, louder 3-tone ascending alert chime as a WAV Data URI
 * for Special Watchlist and Rare flight alerts (C5 523Hz -> G5 784Hz -> C6 1046Hz).
 */
export function generateSpecialChimeWavDataUri() {
  const sampleRate = 22050;
  const numChannels = 1;
  const bitsPerSample = 16;
  const duration = 1.4;
  const numSamples = Math.floor(sampleRate * duration);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // 3-tone chime: C5 (523.25 Hz), G5 (783.99 Hz), C6 (1046.50 Hz)
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    // Bell 1: C5
    if (t < 0.45) {
      const env = Math.sin(Math.min(1, t / 0.015) * Math.PI * 0.5) * Math.exp(-t * 4.0);
      sample += (Math.sin(2 * Math.PI * 523.25 * t) * 0.8 + Math.sin(2 * Math.PI * 1046.5 * t) * 0.2) * env;
    }

    // Bell 2: G5
    if (t >= 0.22 && t < 0.85) {
      const t2 = t - 0.22;
      const env2 = Math.sin(Math.min(1, t2 / 0.015) * Math.PI * 0.5) * Math.exp(-t2 * 3.5);
      sample += (Math.sin(2 * Math.PI * 783.99 * t2) * 0.8 + Math.sin(2 * Math.PI * 1567.98 * t2) * 0.2) * env2;
    }

    // Bell 3: C6 (Loudest peak)
    if (t >= 0.44) {
      const t3 = t - 0.44;
      const env3 = Math.sin(Math.min(1, t3 / 0.015) * Math.PI * 0.5) * Math.exp(-t3 * 2.5);
      sample += (Math.sin(2 * Math.PI * 1046.50 * t3) * 0.85 + Math.sin(2 * Math.PI * 2093.00 * t3) * 0.15) * env3;
    }

    const val = Math.max(-0.98, Math.min(0.98, sample)) * 0.98;
    view.setInt16(offset, val < 0 ? val * 0x8000 : val * 0x7FFF, true);
    offset += 2;
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + (typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64'));
}

export function getSpecialChimeWavDataUri() {
  if (!cachedSpecialWavDataUri) {
    cachedSpecialWavDataUri = generateSpecialChimeWavDataUri();
  }
  return cachedSpecialWavDataUri;
}

export function playSpecialWavFallbackChime(volumePercent = 90) {
  try {
    const dataUri = getSpecialChimeWavDataUri();
    if (activeAudioElement) {
      try {
        activeAudioElement.pause();
        activeAudioElement.currentTime = 0;
      } catch (e) {}
    }

    const audio = new Audio(dataUri);
    activeAudioElement = audio;
    const vol = Math.max(0, Math.min(100, Number(volumePercent) || 90)) / 100;
    audio.volume = vol;

    audio.onended = () => {
      if (activeAudioElement === audio) activeAudioElement = null;
    };

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      return playPromise.catch((err) => {
        console.warn('Airvee: Special HTML5 Audio play failed:', err);
        throw err;
      });
    }
    return Promise.resolve();
  } catch (err) {
    console.warn('Airvee: Special HTML5 Audio error:', err);
    return Promise.reject(err);
  }
}

/**
 * Synthesize a louder, distinct Special 3-tone ascending alert chime
 * for Watchlist and Rare Aircraft alerts.
 *
 * @param {number} [volumePercent=90]
 * @returns {Promise<void>}
 */
export async function playSpecialAlertChime(volumePercent = 90) {
  const AudioCtx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ||
                   (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext));

  if (!AudioCtx) {
    return playSpecialWavFallbackChime(volumePercent);
  }

  try {
    if (!persistentAudioCtx || persistentAudioCtx.state === 'closed') {
      persistentAudioCtx = new AudioCtx();
    }
    const ctx = persistentAudioCtx;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    if (ctx.state === 'suspended') {
      return playSpecialWavFallbackChime(volumePercent);
    }

    const vol = Math.max(0, Math.min(100, Number(volumePercent) || 90)) / 100;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(vol * 0.98, ctx.currentTime);
    masterGain.connect(ctx.destination);

    // Reverberation reflection
    const delay = ctx.createDelay(0.5);
    delay.delayTime.setValueAtTime(0.09, ctx.currentTime);
    const delayFeedback = ctx.createGain();
    delayFeedback.gain.setValueAtTime(0.25, ctx.currentTime);
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    delayFeedback.connect(masterGain);

    const notes = [
      { freq: 523.25, start: 0.00, duration: 0.38, attack: 0.01 },
      { freq: 783.99, start: 0.20, duration: 0.45, attack: 0.01 },
      { freq: 1046.50, start: 0.42, duration: 0.90, attack: 0.01 }
    ];

    notes.forEach(({ freq, start, duration, attack }) => {
      const t = ctx.currentTime + start;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);

      const noteGain = ctx.createGain();
      noteGain.gain.setValueAtTime(0.0001, t);
      noteGain.gain.linearRampToValueAtTime(1.0, t + attack);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

      osc.connect(noteGain);
      noteGain.connect(masterGain);
      noteGain.connect(delay);

      osc.start(t);
      osc.stop(t + duration + 0.05);
    });

    return Promise.resolve();
  } catch (err) {
    console.warn('Airvee: Web Audio special chime failed, fallback to WAV:', err);
    return playSpecialWavFallbackChime(volumePercent);
  }
}

