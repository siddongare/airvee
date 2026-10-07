// ============================================================
//  AIRVEE — Offscreen Audio Service
//  Executes airport PA chime synthesis on demand
// ============================================================

import {
  playAirportDoubleChime,
  playWavFallbackChime,
  playSpecialAlertChime,
  playSpecialWavFallbackChime
} from './lib/audio.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && (msg.type === 'PLAY_CHIME' || msg.type === 'PLAY_SPECIAL_CHIME')) {
    const volume = msg.volume != null ? msg.volume : 80;
    const isSpecial = msg.type === 'PLAY_SPECIAL_CHIME' || msg.style === 'special';

    const playFn = isSpecial ? playSpecialAlertChime : playAirportDoubleChime;
    const fallbackFn = isSpecial ? playSpecialWavFallbackChime : playWavFallbackChime;

    playFn(volume)
      .then(() => sendResponse({ success: true, special: isSpecial }))
      .catch((err) => {
        console.warn('Airvee: Web Audio failed in offscreen, attempting WAV fallback:', err);
        return fallbackFn(volume);
      })
      .then(() => sendResponse({ success: true, fallback: true, special: isSpecial }))
      .catch((err2) => {
        console.error('Airvee: All offscreen audio playback methods failed:', err2);
        sendResponse({ success: false, error: err2.message });
      });

    return true; // Keep sendResponse open for async
  }
  return false;
});

