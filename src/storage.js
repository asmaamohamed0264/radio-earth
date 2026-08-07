const FAV_KEY = 'radio.favorites';
const LAST_KEY = 'radio.lastPlayed';

/**
 * Get favorites as a Set of stationuuid strings.
 */
export function getFavorites() {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed);
    }
    return new Set();
  } catch {
    return new Set();
  }
}

/**
 * Save a Set of stationuuid strings to localStorage.
 */
function saveFavorites(favs) {
  localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(favs)));
}

/**
 * Add a station UUID to favorites.
 */
export function addFavorite(uuid) {
  const favs = getFavorites();
  favs.add(uuid);
  saveFavorites(favs);
}

/**
 * Remove a station UUID from favorites.
 */
export function removeFavorite(uuid) {
  const favs = getFavorites();
  favs.delete(uuid);
  saveFavorites(favs);
}

/**
 * Toggle a station's favorite status.
 * Returns the new boolean state (true if now favorited).
 */
export function toggleFavorite(uuid) {
  const favs = getFavorites();
  if (favs.has(uuid)) {
    favs.delete(uuid);
    saveFavorites(favs);
    return false;
  } else {
    favs.add(uuid);
    saveFavorites(favs);
    return true;
  }
}

/**
 * Check if a station is favorited.
 */
export function isFavorite(uuid) {
  return getFavorites().has(uuid);
}

/**
 * Get the last played station object, or null.
 */
export function getLastPlayed() {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save a station object as the last played.
 */
export function setLastPlayed(station) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(station));
  } catch {
    // Ignore storage errors
  }
}
