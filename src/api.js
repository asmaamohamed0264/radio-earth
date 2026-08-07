const API_BASE = 'https://de1.api.radio-browser.info';

const PAGE_SIZE = 1000;

// Two pools are merged: one guarantees map coverage (stations with
// coordinates), the other gives the grid breadth. Only ~31% of stations
// carry geo info, so asking for both separately beats a single query.
//
// The API sends no gzip and costs ~1.2 KB per station, so the pool is
// split in two stages: a small one to get the app on screen, then the
// rest in the background. Ceilings that exist upstream: 10,341 https
// stations with coordinates, 37,868 https stations overall.
const INITIAL_POOL = { geo: 1000, general: 1000 };
const FULL_POOL = { geo: 4000, general: 6000 };

// Results per field for a server-side search.
const REMOTE_SEARCH_LIMIT = 60;

/**
 * Bitrate buckets. Single source of truth: `id` is what filters store and
 * compare, `label` is what the UI shows. Keeping these apart avoids the
 * label/id drift that silently breaks matching.
 */
export const BITRATE_BUCKETS = [
  { id: 'unknown', label: 'Unknown', match: b => b === 0 },
  { id: '0-64', label: '0-64 kbps', match: b => b > 0 && b <= 64 },
  { id: '64-128', label: '64-128 kbps', match: b => b > 64 && b <= 128 },
  { id: '128-192', label: '128-192 kbps', match: b => b > 128 && b <= 192 },
  { id: '192-320', label: '192-320 kbps', match: b => b > 192 && b <= 320 },
  { id: '320+', label: '320+ kbps', match: b => b > 320 }
];

/**
 * Normalize a station's country into a stable key.
 * Shared by filters and matching so both sides agree.
 */
export function getStationCountry(station) {
  const country = station.country && station.country.trim();
  return country ? country : 'Unknown';
}

/**
 * Normalize a station's tags into a lowercase, deduplicated array.
 * Shared by filters and matching so both sides agree.
 */
export function getStationTags(station) {
  if (!station.tags) return [];
  const tags = station.tags
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(tags));
}

/**
 * Get the bucket id a station's bitrate falls into.
 */
export function getBitrateBucketId(bitrate) {
  const b = parseInt(bitrate, 10) || 0;
  const bucket = BITRATE_BUCKETS.find(x => x.match(b));
  return bucket ? bucket.id : 'unknown';
}

/**
 * Get the display label for a bucket id.
 */
export function getBitrateBucketLabel(id) {
  const bucket = BITRATE_BUCKETS.find(x => x.id === id);
  return bucket ? bucket.label : id;
}

/**
 * Build a /json/stations/search URL.
 * Filtering happens server-side so the response is not wasted on
 * stations the client would immediately discard.
 */
function buildSearchUrl(extra = {}) {
  const params = new URLSearchParams({
    order: 'clickcount',
    reverse: 'true',
    hidebroken: 'true',
    is_https: 'true'
  });

  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }

  return `${API_BASE}/json/stations/search?${params.toString()}`;
}

async function requestStations(extra, signal) {
  const response = await fetch(buildSearchUrl(extra), { signal });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: Failed to fetch stations`);
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error('Invalid response format');
  }

  return data;
}

/**
 * Page through one pool between two offsets, handing each page to
 * `onPage` as it lands so the caller can show progress.
 */
async function fetchPoolRange(from, to, hasGeoInfo, onPage) {
  let offset = from;

  while (offset < to) {
    const limit = Math.min(PAGE_SIZE, to - offset);
    const page = await requestStations({
      limit,
      offset,
      has_geo_info: hasGeoInfo ? 'true' : undefined
    });

    if (page.length === 0) break;

    onPage(page);

    // Short page means the server has nothing more to give.
    if (page.length < limit) break;

    offset += page.length;
  }
}

/**
 * Is this station usable by the player?
 */
function isPlayable(station) {
  return (
    station.stationuuid &&
    station.url_resolved &&
    station.url_resolved.startsWith('https://') &&
    station.name &&
    station.name.trim().length > 0 &&
    station.codec !== 'UNKNOWN'
  );
}

/**
 * Drop unplayable stations and duplicates within a batch.
 */
function dedupePlayable(stations) {
  const byUuid = new Map();
  for (const station of stations) {
    if (!isPlayable(station) || byUuid.has(station.stationuuid)) continue;
    byUuid.set(station.stationuuid, station);
  }
  return Array.from(byUuid.values());
}

/**
 * Fetch the opening pool: small enough to render fast, split across a
 * geo-tagged pool (for the map) and a general one (for the grid).
 */
export async function fetchStations() {
  const collected = [];

  await Promise.all([
    fetchPoolRange(0, INITIAL_POOL.geo, true, page => collected.push(...page)),
    fetchPoolRange(0, INITIAL_POOL.general, false, page => collected.push(...page))
  ]);

  return dedupePlayable(collected);
}

/**
 * Top the pool up to FULL_POOL in the background, one page at a time.
 * `onBatch` receives each page as it arrives; the caller merges and
 * decides when to repaint. Duplicates against the initial pool are the
 * caller's to drop, since only it knows what is already loaded.
 */
export async function fetchRemainingStations(onBatch) {
  await Promise.all([
    fetchPoolRange(INITIAL_POOL.geo, FULL_POOL.geo, true, page => onBatch(dedupePlayable(page))),
    fetchPoolRange(INITIAL_POOL.general, FULL_POOL.general, false, page => onBatch(dedupePlayable(page)))
  ]);
}

/**
 * Search the whole catalogue on the server, not just the local pool.
 *
 * The API ANDs its fields together, so matching "name OR tag OR country"
 * takes one request per field. Each is small, and this is what makes all
 * 37,868 stations reachable without downloading them.
 */
export async function searchStationsRemote(query, { signal, limit = REMOTE_SEARCH_LIMIT } = {}) {
  const q = query.trim();
  if (!q) return [];

  const fields = ['name', 'tag', 'country'];

  const responses = await Promise.all(
    fields.map(field =>
      requestStations({ [field]: q, limit }, signal).catch(err => {
        // A cancelled search must cancel the whole thing, but one field
        // failing should not sink the other two.
        if (err && err.name === 'AbortError') throw err;
        return [];
      })
    )
  );

  return dedupePlayable(responses.flat());
}

/**
 * Report a play to Radio Browser.
 *
 * This is the endpoint that feeds the click ranking we sort by, so
 * reporting keeps the shared dataset honest. Fire-and-forget: a failure
 * here must never affect playback.
 */
export function reportStationClick(stationUuid) {
  if (!stationUuid) return;
  fetch(`${API_BASE}/json/url/${encodeURIComponent(stationUuid)}`).catch(() => {
    // Ignore - reporting is best-effort.
  });
}

/**
 * Get top countries by station count.
 * Returns array of { country: string, count: number } sorted desc.
 */
export function getTopCountries(stations, limit = 30) {
  const counts = {};
  for (const s of stations) {
    const country = getStationCountry(s);
    counts[country] = (counts[country] || 0) + 1;
  }

  return Object.entries(counts)
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Get top tags by station count.
 * Returns array of { tag: string, count: number } sorted desc.
 */
export function getTopTags(stations, limit = 30) {
  const counts = {};
  for (const s of stations) {
    for (const tag of getStationTags(s)) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }

  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Get bitrate buckets with counts, keyed by bucket id.
 */
export function getBitrateBuckets(stations) {
  const buckets = {};
  for (const bucket of BITRATE_BUCKETS) {
    buckets[bucket.id] = 0;
  }

  for (const s of stations) {
    buckets[getBitrateBucketId(s.bitrate)]++;
  }

  return buckets;
}

/**
 * Filter stations by query, countries, tags, bitrates, and favorites.
 */
export function filterStations(stations, filters) {
  const {
    query = '',
    countries = [],
    tags = [],
    bitrates = [],
    favoritesOnly = false,
    favoriteUuids = new Set()
  } = filters;

  const queryLower = query.toLowerCase().trim();

  return stations.filter(s => {
    // Favorites filter
    if (favoritesOnly && !favoriteUuids.has(s.stationuuid)) {
      return false;
    }

    // Country filter
    if (countries.length > 0 && !countries.includes(getStationCountry(s))) {
      return false;
    }

    // Tags filter
    if (tags.length > 0) {
      const stationTags = getStationTags(s);
      if (!tags.some(tag => stationTags.includes(tag))) {
        return false;
      }
    }

    // Bitrate filter
    if (bitrates.length > 0 && !bitrates.includes(getBitrateBucketId(s.bitrate))) {
      return false;
    }

    // Query filter (fuzzy match against name, country, tags)
    if (queryLower) {
      const nameMatch = s.name && s.name.toLowerCase().includes(queryLower);
      const countryMatch = s.country && s.country.toLowerCase().includes(queryLower);
      const tagMatch = s.tags && s.tags.toLowerCase().includes(queryLower);
      if (!nameMatch && !countryMatch && !tagMatch) {
        return false;
      }
    }

    return true;
  });
}
