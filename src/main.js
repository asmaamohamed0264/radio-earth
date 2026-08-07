import {
  fetchStations,
  fetchRemainingStations,
  searchStationsRemote,
  filterStations
} from './api.js';
import {
  getFavorites,
  toggleFavorite,
  isFavorite,
  getLastPlayed,
  setLastPlayed
} from './storage.js';
import {
  initPlayer,
  playStation,
  togglePlay,
  setVolume,
  getCurrentStation,
  isPlayingNow,
  playNext,
  playPrev,
  pause
} from './player.js';
import { showToast } from './toast.js';
import { initMap, updateMapMarkers, highlightMapMarker, refreshMapSize } from './map.js';
import {
  initGlobe,
  updateGlobeMarkers,
  highlightGlobeMarker,
  setGlobeRunning
} from './globe.js';
import {
  initSearch,
  openSearch,
  closeSearch,
  updateSearchStations,
  clearSearchQuery
} from './search.js';
import {
  initFilters,
  openFilters,
  closeFilters,
  getActiveFilters,
  updateFilterOptions,
  setQuery,
  clearAllFilters
} from './filters.js';

// Cards rendered per batch. The station pool is now in the thousands, so
// the grid fills in as it scrolls instead of building every card upfront.
const GRID_CHUNK = 300;

// Background pages arrive faster than a repaint is worth doing, so
// refreshes are coalesced.
const REFRESH_THROTTLE_MS = 1500;

// ========================================
// State
// ========================================
let allStations = [];          // local pool, grows in the background
let localUuids = new Set();    // membership test for the local pool
let remoteStations = new Map(); // uuid -> station, from the last server search
let stationsByUuid = new Map(); // lookup across both, for card clicks
let currentStations = [];
let favoritesOnly = false;
let activeStationUuid = null;
let sleepTimerId = null;

// Visualization: 'map' or 'globe'. The globe initialises lazily so its
// country outlines are only fetched if someone actually opens it.
let currentView = 'map';
let globeInitialized = false;

// Progressive loading / remote search
let backgroundLoading = false;
let refreshTimer = null;
let refreshPending = false;
let searchAbort = null;

// Incremental grid rendering
let gridStations = [];
let gridRendered = 0;
let gridSentinel = null;
let gridObserver = null;

// ========================================
// DOM Refs
// ========================================
const gridEl = document.getElementById('station-grid');
const emptyStateEl = document.getElementById('empty-state');
const gridTitleEl = document.getElementById('grid-title');
const gridCountEl = document.getElementById('grid-count');
const playerStationEl = document.getElementById('player-station');
const playerMetaEl = document.getElementById('player-meta');
const btnPlay = document.getElementById('btn-play');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnFavorite = document.getElementById('btn-favorite');
const btnSleep = document.getElementById('btn-sleep');
const sleepMenu = document.getElementById('sleep-menu');
const volumeSlider = document.getElementById('volume');
const favoritesToggle = document.getElementById('favorites-toggle');
const filtersToggle = document.getElementById('filters-toggle');
const closeFiltersBtn = document.getElementById('close-filters');
const searchModal = document.getElementById('search-modal');
const playerBar = document.getElementById('player-bar');
const mapEl = document.getElementById('map');
const globeEl = document.getElementById('globe');
const viewSwitch = document.getElementById('view-switch');

// ========================================
// Station Pools
// ========================================

/**
 * Add stations to the local pool. Returns how many were new.
 */
function addLocalStations(batch) {
  let added = 0;
  for (const station of batch) {
    if (localUuids.has(station.stationuuid)) continue;
    localUuids.add(station.stationuuid);
    stationsByUuid.set(station.stationuuid, station);
    allStations.push(station);
    added++;
  }
  return added;
}

/**
 * Replace the results of the last server-side search. These stay out of
 * the local pool so clearing the query restores the original list.
 */
function setRemoteResults(stations) {
  remoteStations = new Map();
  for (const station of stations) {
    if (localUuids.has(station.stationuuid)) continue;
    remoteStations.set(station.stationuuid, station);
    stationsByUuid.set(station.stationuuid, station);
  }
}

/**
 * Everything currently filterable: the local pool plus whatever the
 * server turned up for the active query.
 */
function getWorkingSet() {
  if (remoteStations.size === 0) return allStations;
  return allStations.concat(Array.from(remoteStations.values()));
}

// ========================================
// Country Code -> Flag Emoji
// ========================================
function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return '';
  const cc = code.toUpperCase();
  return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65)
       + String.fromCodePoint(0x1F1E6 + cc.charCodeAt(1) - 65);
}

// ========================================
// Grid Rendering
// ========================================
function createStationCard(station) {
  const card = document.createElement('div');
  card.className = 'station-card';
  if (station.stationuuid === activeStationUuid) {
    card.classList.add('station-card--active');
  }
  card.dataset.uuid = station.stationuuid;

  const flag = countryCodeToFlag(station.countrycode);
  const tags = station.tags
    ? station.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 3)
    : [];

  card.innerHTML = `
    <span class="station-card__flag">${flag}</span>
    <span class="station-card__name">${escapeHtml(station.name)}</span>
    <div class="station-card__tags">
      ${tags.map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}
    </div>
    <button class="station-card__play" title="Play">&#9654;</button>
  `;

  return card;
}

function updateGridCount(count) {
  if (!gridCountEl) return;
  const base = `${count.toLocaleString()} station${count !== 1 ? 's' : ''}`;
  gridCountEl.textContent = backgroundLoading ? `${base} · loading more…` : base;
}

/**
 * @param {Object[]} stations
 * @param {boolean} preserveScroll - keep the reader where they were.
 *   Used when the background loader grows the list underneath them.
 */
function renderGrid(stations, { preserveScroll = false } = {}) {
  if (!gridEl) return;

  const prevScroll = preserveScroll ? gridEl.scrollTop : 0;
  const prevRendered = preserveScroll ? gridRendered : 0;

  gridStations = stations;
  gridRendered = 0;
  removeSentinel();
  gridEl.innerHTML = '';

  if (stations.length === 0) {
    gridEl.style.display = 'none';
    showEmptyState();
    updateGridCount(0);
    return;
  }

  gridEl.style.display = 'grid';
  if (emptyStateEl) emptyStateEl.style.display = 'none';
  updateGridCount(stations.length);

  appendGridChunk();

  // Rebuild as many chunks as were on screen before, otherwise restoring
  // the scroll offset would land past the end of the rendered cards.
  while (preserveScroll && gridRendered < prevRendered && gridRendered < stations.length) {
    appendGridChunk();
  }

  gridEl.scrollTop = prevScroll;
}

function appendGridChunk() {
  if (!gridEl) return;

  const next = gridStations.slice(gridRendered, gridRendered + GRID_CHUNK);
  removeSentinel();

  if (next.length === 0) return;

  const fragment = document.createDocumentFragment();
  for (const station of next) {
    fragment.appendChild(createStationCard(station));
  }
  gridEl.appendChild(fragment);
  gridRendered += next.length;

  // Sentinel goes last so it only comes into view once the rendered
  // cards have been scrolled through.
  if (gridRendered < gridStations.length) {
    addSentinel();
  }
}

function ensureGridObserver() {
  if (gridObserver) return gridObserver;

  // The grid itself is the scroll container, so it is the observer root.
  gridObserver = new IntersectionObserver(
    entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        appendGridChunk();
      }
    },
    { root: gridEl, rootMargin: '400px' }
  );

  return gridObserver;
}

function addSentinel() {
  gridSentinel = document.createElement('div');
  gridSentinel.className = 'grid-sentinel';
  gridEl.appendChild(gridSentinel);
  ensureGridObserver().observe(gridSentinel);
}

function removeSentinel() {
  if (!gridSentinel) return;
  if (gridObserver) gridObserver.unobserve(gridSentinel);
  gridSentinel.remove();
  gridSentinel = null;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========================================
// Empty / Loading / Error States
// ========================================
function showEmptyState() {
  if (!emptyStateEl) return;
  emptyStateEl.style.display = 'flex';
  emptyStateEl.innerHTML = `
    <p>No stations match your filters.</p>
    <button class="btn-clear" id="clear-filters">Clear filters</button>
  `;
  const btn = emptyStateEl.querySelector('#clear-filters');
  if (btn) {
    btn.addEventListener('click', resetAllFilters, { once: true });
  }
}

function showLoadingState() {
  if (!gridEl) return;
  gridEl.style.display = 'none';
  if (emptyStateEl) {
    emptyStateEl.style.display = 'flex';
    emptyStateEl.innerHTML = `
      <div class="loading-spinner"></div>
      <p>Loading stations...</p>
    `;
  }
  if (gridCountEl) gridCountEl.textContent = '';
}

function showErrorState() {
  if (!gridEl) return;
  gridEl.style.display = 'none';
  if (emptyStateEl) {
    emptyStateEl.style.display = 'flex';
    emptyStateEl.innerHTML = `
      <p>Failed to load stations.</p>
      <button class="retry-btn" id="retry-load">Retry</button>
    `;
    const retryBtn = emptyStateEl.querySelector('#retry-load');
    if (retryBtn) {
      retryBtn.addEventListener('click', loadStations, { once: true });
    }
  }
  if (gridCountEl) gridCountEl.textContent = '';
}

// ========================================
// Highlight active card
// ========================================
function highlightCard(uuid) {
  activeStationUuid = uuid;
  if (!gridEl) return;
  const cards = gridEl.querySelectorAll('.station-card');
  cards.forEach(card => {
    if (card.dataset.uuid === uuid) {
      card.classList.add('station-card--active');
    } else {
      card.classList.remove('station-card--active');
    }
  });
}

// ========================================
// Player Bar Updates
// ========================================
function updatePlayerBar(station) {
  if (!station) return;

  if (playerStationEl) {
    playerStationEl.textContent = station.name || 'Unknown Station';
  }

  if (playerMetaEl) {
    const parts = [];
    if (station.country) parts.push(station.country);
    if (station.bitrate) parts.push(`${station.bitrate} kbps`);
    if (station.codec && station.codec !== 'UNKNOWN') parts.push(station.codec);
    playerMetaEl.textContent = parts.join(' · ');
  }

  updateFavoriteBtnState();
}

function updatePlayBtnState() {
  if (!btnPlay) return;
  btnPlay.innerHTML = isPlayingNow() ? '&#9208;' : '&#9654;';
}

function updateFavoriteBtnState() {
  if (!btnFavorite) return;
  const station = getCurrentStation();
  if (!station) {
    btnFavorite.classList.remove('player-btn--active');
    return;
  }
  if (isFavorite(station.stationuuid)) {
    btnFavorite.classList.add('player-btn--active');
  } else {
    btnFavorite.classList.remove('player-btn--active');
  }
}

function updateFavoritesCount() {
  const countEl = document.querySelector('.favorites-count');
  if (countEl) {
    countEl.textContent = getFavorites().size;
  }
}

// ========================================
// Visualization (map / globe)
// ========================================

/**
 * Push a station list to whichever visualizations exist. The globe is
 * skipped entirely until someone has opened it once.
 */
function updateVisualizations(list) {
  updateMapMarkers(list);
  if (globeInitialized) updateGlobeMarkers(list);
}

/**
 * Centre the active station in the visualization on screen. Doing it for
 * the hidden one would animate against a container of the wrong size.
 */
function highlightInVisualization(uuid) {
  if (currentView === 'globe') {
    highlightGlobeMarker(uuid);
  } else {
    highlightMapMarker(uuid);
  }
}

function setView(view) {
  if (view !== 'map' && view !== 'globe') return;
  currentView = view;

  if (viewSwitch) {
    viewSwitch.querySelectorAll('.view-card').forEach(card => {
      const isActive = card.dataset.view === view;
      card.classList.toggle('view-card--active', isActive);
      card.setAttribute('aria-pressed', String(isActive));
    });
  }

  if (view === 'globe') {
    if (mapEl) mapEl.style.display = 'none';
    if (globeEl) globeEl.hidden = false;

    if (!globeInitialized) {
      initGlobe('globe', currentStations, onStationClick);
      globeInitialized = true;
    } else {
      updateGlobeMarkers(currentStations);
    }

    setGlobeRunning(true);
    if (activeStationUuid) highlightGlobeMarker(activeStationUuid);
  } else {
    setGlobeRunning(false);
    if (globeEl) globeEl.hidden = true;
    if (mapEl) mapEl.style.display = '';

    // Leaflet measured a hidden container; make it measure again.
    refreshMapSize();
    if (activeStationUuid) highlightMapMarker(activeStationUuid);
  }
}

function setupViewSwitch() {
  if (!viewSwitch) return;
  viewSwitch.addEventListener('click', (e) => {
    const card = e.target.closest('.view-card');
    if (!card) return;
    setView(card.dataset.view);
  });
}

// ========================================
// Station Click Handler
// ========================================
function onStationClick(station) {
  if (!station) return;

  playStation(station);
  setLastPlayed(station);
  updatePlayerBar(station);
  updatePlayBtnState();
  highlightCard(station.stationuuid);
  highlightInVisualization(station.stationuuid);
}

// ========================================
// Filters Change Handler
// ========================================
function onFiltersChange({ preserveScroll = false } = {}) {
  const filters = getActiveFilters();
  filters.favoritesOnly = favoritesOnly;
  filters.favoriteUuids = getFavorites();

  currentStations = filterStations(getWorkingSet(), filters);

  renderGrid(currentStations, { preserveScroll });
  updateVisualizations(currentStations);
  updateSearchStations(currentStations);

  // Update grid title
  if (gridTitleEl) {
    if (favoritesOnly) {
      gridTitleEl.textContent = 'Favorites';
    } else if (filters.query) {
      gridTitleEl.textContent = `Search: ${filters.query}`;
    } else if (filters.countries.length || filters.tags.length || filters.bitrates.length) {
      gridTitleEl.textContent = 'Filtered Stations';
    } else {
      gridTitleEl.textContent = 'All Stations';
    }
  }
}

/**
 * Typing in the search box narrows the grid and the map too, not just
 * the result list. The local pool answers instantly; the server answers
 * for everything not held locally.
 */
function onSearchQueryChange(query) {
  setQuery(query);

  // Abandon whatever the previous keystroke asked for.
  if (searchAbort) {
    searchAbort.abort();
    searchAbort = null;
  }

  if (!query) {
    remoteStations = new Map();
    onFiltersChange();
    return;
  }

  onFiltersChange();
  runRemoteSearch(query);
}

/**
 * Widen the active query to the whole catalogue.
 */
async function runRemoteSearch(query) {
  const controller = new AbortController();
  searchAbort = controller;

  try {
    const results = await searchStationsRemote(query, { signal: controller.signal });

    // A newer keystroke has taken over; its results are the ones to show.
    if (searchAbort !== controller) return;
    searchAbort = null;

    const before = remoteStations.size;
    setRemoteResults(results);

    // Nothing new to show - the local pool already covered it.
    if (before === 0 && remoteStations.size === 0) return;

    onFiltersChange();
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.warn('Remote search failed:', err);
  }
}

function resetAllFilters() {
  favoritesOnly = false;
  if (favoritesToggle) favoritesToggle.classList.remove('header-btn--active');
  if (searchAbort) {
    searchAbort.abort();
    searchAbort = null;
  }
  remoteStations = new Map();
  clearAllFilters();
  clearSearchQuery();
  onFiltersChange();
}

// ========================================
// Progressive Loading
// ========================================

/**
 * Repaints are coalesced: pages land faster than a re-render is worth.
 */
function scheduleRefresh() {
  refreshPending = true;
  if (refreshTimer) return;

  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (!refreshPending) return;
    refreshPending = false;
    applyPoolRefresh();
  }, REFRESH_THROTTLE_MS);
}

function applyPoolRefresh() {
  updateFilterOptions(getWorkingSet());
  onFiltersChange({ preserveScroll: true });
}

/**
 * Top the pool up after first paint, so startup stays fast but the app
 * ends up with far more than the opening pool.
 */
function startBackgroundLoad() {
  backgroundLoading = true;
  updateGridCount(currentStations.length);

  fetchRemainingStations(batch => {
    if (addLocalStations(batch) > 0) scheduleRefresh();
  })
    .catch(err => {
      console.warn('Background station load stopped early:', err);
    })
    .finally(() => {
      backgroundLoading = false;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      refreshPending = false;
      applyPoolRefresh();
      showToast(`${allStations.length.toLocaleString()} stations available`);
    });
}

// ========================================
// Load Stations
// ========================================
async function loadStations() {
  showLoadingState();

  try {
    const stations = await fetchStations();

    allStations = [];
    localUuids = new Set();
    remoteStations = new Map();
    stationsByUuid = new Map();
    addLocalStations(stations);
    currentStations = allStations;

    renderGrid(allStations);
    initMap('map', allStations, onStationClick);
    initSearch(allStations, onStationClick, onSearchQueryChange);
    initFilters(allStations, () => onFiltersChange());
    updateFilterOptions(allStations);

    // Restore last played (show in player bar, don't auto-play)
    const lastPlayed = getLastPlayed();
    if (lastPlayed) {
      updatePlayerBar(lastPlayed);
    }

    // The app is usable now; the rest of the pool arrives behind it.
    startBackgroundLoad();
  } catch (err) {
    console.error('Failed to load stations:', err);
    showToast('Failed to load stations', 'error');
    showErrorState();
  }
}

// ========================================
// Grid Events
// ========================================
function setupGridEvents() {
  if (!gridEl) return;

  // Delegated: one listener regardless of how many cards are rendered.
  gridEl.addEventListener('click', (e) => {
    const card = e.target.closest('.station-card');
    if (!card) return;
    const station = stationsByUuid.get(card.dataset.uuid);
    if (station) onStationClick(station);
  });
}

// ========================================
// Player Bar Events
// ========================================
function setupPlayerEvents() {
  // Play/Pause
  if (btnPlay) {
    btnPlay.addEventListener('click', () => {
      togglePlay();
      updatePlayBtnState();
    });
  }

  // Previous
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      playPrev(currentStations);
      const station = getCurrentStation();
      if (station) {
        setLastPlayed(station);
        updatePlayerBar(station);
        highlightCard(station.stationuuid);
        highlightInVisualization(station.stationuuid);
      }
    });
  }

  // Next
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      playNext(currentStations);
      const station = getCurrentStation();
      if (station) {
        setLastPlayed(station);
        updatePlayerBar(station);
        highlightCard(station.stationuuid);
        highlightInVisualization(station.stationuuid);
      }
    });
  }

  // Volume
  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      setVolume(e.target.value);
    });
    // Set initial volume
    setVolume(volumeSlider.value);
  }

  // Favorite toggle
  if (btnFavorite) {
    btnFavorite.addEventListener('click', () => {
      const station = getCurrentStation();
      if (!station) return;
      const isFav = toggleFavorite(station.stationuuid);
      updateFavoriteBtnState();
      updateFavoritesCount();
      showToast(isFav ? 'Added to favorites' : 'Removed from favorites');

      // Refresh grid if favorites filter is active
      if (favoritesOnly) {
        onFiltersChange();
      }
    });
  }

  // Sleep timer toggle
  if (btnSleep && sleepMenu) {
    btnSleep.addEventListener('click', (e) => {
      e.stopPropagation();
      sleepMenu.classList.toggle('sleep-menu--open');
    });

    // Close sleep menu on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.sleep-dropdown') && sleepMenu.classList.contains('sleep-menu--open')) {
        sleepMenu.classList.remove('sleep-menu--open');
      }
    });

    // Sleep timer buttons
    const sleepButtons = sleepMenu.querySelectorAll('button[data-min]');
    sleepButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mins = parseInt(btn.dataset.min, 10);

        // Clear existing timer
        if (sleepTimerId) {
          clearTimeout(sleepTimerId);
          sleepTimerId = null;
        }

        if (mins > 0) {
          sleepTimerId = setTimeout(() => {
            pause();
            updatePlayBtnState();
            showToast(`Sleep timer — playback paused`);
            sleepTimerId = null;
          }, mins * 60000);
          showToast(`Sleep timer set for ${mins} min`);
        } else {
          showToast('Sleep timer off');
        }

        sleepMenu.classList.remove('sleep-menu--open');
      });
    });
  }
}

// ========================================
// Header Events
// ========================================
function setupHeaderEvents() {
  // Favorites toggle
  if (favoritesToggle) {
    favoritesToggle.addEventListener('click', () => {
      favoritesOnly = !favoritesOnly;
      favoritesToggle.classList.toggle('header-btn--active', favoritesOnly);
      onFiltersChange();
    });
  }

  // Filters toggle
  if (filtersToggle) {
    filtersToggle.addEventListener('click', () => {
      openFilters();
    });
  }

  // Close filters
  if (closeFiltersBtn) {
    closeFiltersBtn.addEventListener('click', () => {
      closeFilters();
    });
  }
}

// ========================================
// Keyboard Shortcuts
// ========================================
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + K -> open search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
      return;
    }

    // Escape -> close search, close filters
    if (e.key === 'Escape') {
      closeSearch();
      closeFilters();
      return;
    }
  });
}

// ========================================
// Audio Error Handling
// ========================================
function setupAudioErrorHandling() {
  initPlayer(
    () => {
      // Error callback
      showToast('Station unavailable', 'error');
      updatePlayBtnState();
      setTimeout(() => {
        playNext(currentStations);
        const station = getCurrentStation();
        if (station) {
          setLastPlayed(station);
          updatePlayerBar(station);
          highlightCard(station.stationuuid);
          highlightInVisualization(station.stationuuid);
          updatePlayBtnState();
        }
      }, 1500);
    },
    () => {
      // Ended callback
      updatePlayBtnState();
    }
  );
}

// ========================================
// Search modal keyboard handling
// ========================================
function setupSearchModal() {
  if (!searchModal) return;

  const backdrop = searchModal.querySelector('.search-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeSearch();
    });
  }
}

// ========================================
// Startup
// ========================================
function startup() {
  updateFavoritesCount();
  setupGridEvents();
  setupPlayerEvents();
  setupHeaderEvents();
  setupKeyboard();
  setupAudioErrorHandling();
  setupSearchModal();
  setupViewSwitch();
  loadStations();
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startup);
} else {
  startup();
}
