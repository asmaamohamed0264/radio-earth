// ========================================
// Player Module
// Manages the single <audio> element
// ========================================

import { reportStationClick } from './api.js';

let audio = null;
let currentStation = null;
let isPlaying = false;
let onErrorCallback = null;
let onEndedCallback = null;

/**
 * Initialize the player with the audio element.
 * @param {Function} errorCb - Called on playback error
 * @param {Function} endedCb - Called when playback ends
 */
export function initPlayer(errorCb, endedCb) {
  audio = document.getElementById('audio-player');
  if (!audio) {
    console.error('Audio element not found');
    return;
  }

  onErrorCallback = errorCb || null;
  onEndedCallback = endedCb || null;

  audio.addEventListener('error', () => {
    isPlaying = false;
    if (onErrorCallback) onErrorCallback();
  });

  audio.addEventListener('ended', () => {
    isPlaying = false;
    if (onEndedCallback) onEndedCallback();
  });

  audio.addEventListener('playing', () => {
    isPlaying = true;
  });

  audio.addEventListener('pause', () => {
    isPlaying = false;
  });
}

/**
 * Play a station.
 * @param {Object} station - Station object with url_resolved
 */
export function playStation(station) {
  if (!audio || !station || !station.url_resolved) return;

  // If same station, just play
  if (currentStation && currentStation.stationuuid === station.stationuuid) {
    if (audio.paused) {
      audio.play().catch(() => {
        isPlaying = false;
        if (onErrorCallback) onErrorCallback();
      });
    }
    return;
  }

  currentStation = station;

  // Only on a real station change - resuming the same stream above
  // returns early, so a pause/play cycle is not counted twice.
  reportStationClick(station.stationuuid);

  audio.src = station.url_resolved;
  audio.load();

  const playPromise = audio.play();
  if (playPromise) {
    playPromise.catch(() => {
      isPlaying = false;
      if (onErrorCallback) onErrorCallback();
    });
  }

  isPlaying = true;
}

/**
 * Toggle play/pause.
 */
export function togglePlay() {
  if (!audio) return;

  if (audio.paused) {
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch(() => {
        isPlaying = false;
        if (onErrorCallback) onErrorCallback();
      });
    }
    isPlaying = true;
  } else {
    audio.pause();
    isPlaying = false;
  }
}

/**
 * Pause playback.
 */
export function pause() {
  if (!audio) return;
  audio.pause();
  isPlaying = false;
}

/**
 * Set volume (0.0 - 1.0).
 */
export function setVolume(value) {
  if (!audio) return;
  const vol = parseFloat(value);
  if (!isNaN(vol)) {
    audio.volume = Math.max(0, Math.min(1, vol));
  }
}

/**
 * Get the currently playing station.
 */
export function getCurrentStation() {
  return currentStation;
}

/**
 * Check if audio is currently playing.
 */
export function isPlayingNow() {
  return isPlaying;
}

/**
 * Play the next station in the list (wraps around).
 */
export function playNext(stations) {
  if (!stations || stations.length === 0) return;
  if (!currentStation) {
    playStation(stations[0]);
    return;
  }

  const idx = stations.findIndex(s => s.stationuuid === currentStation.stationuuid);
  const nextIdx = idx >= 0 ? (idx + 1) % stations.length : 0;
  playStation(stations[nextIdx]);
}

/**
 * Play the previous station in the list (wraps around).
 */
export function playPrev(stations) {
  if (!stations || stations.length === 0) return;
  if (!currentStation) {
    playStation(stations[0]);
    return;
  }

  const idx = stations.findIndex(s => s.stationuuid === currentStation.stationuuid);
  const prevIdx = idx >= 0 ? (idx - 1 + stations.length) % stations.length : 0;
  playStation(stations[prevIdx]);
}
