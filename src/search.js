// Delay before a keystroke propagates to the grid and the map. The
// result list updates instantly; the heavier re-render waits for a pause.
const QUERY_DEBOUNCE_MS = 180;

const MAX_RESULTS = 50;

let searchModal = null;
let searchInput = null;
let searchResults = null;
let allStations = [];
let filteredStations = [];
let selectedIndex = -1;
let onSelectCallback = null;
let onQueryChangeCallback = null;
let backdropEl = null;
let queryDebounceId = null;

let _boundKeydown = null;
let _boundBackdropClick = null;
let _boundInputHandler = null;

export function initSearch(stations, onSelect, onQueryChange) {
  searchModal = document.getElementById('search-modal');
  searchInput = document.getElementById('search-input');
  searchResults = document.getElementById('search-results');

  if (!searchModal || !searchInput || !searchResults) {
    console.warn('Search: required DOM elements not found');
    return;
  }

  onSelectCallback = onSelect;
  onQueryChangeCallback = onQueryChange || null;
  allStations = stations;
  filteredStations = [];
  selectedIndex = -1;

  // Find backdrop
  backdropEl = searchModal.querySelector('.search-backdrop');

  // Input event
  _boundInputHandler = handleInput;
  searchInput.addEventListener('input', _boundInputHandler);

  // Keydown on input
  _boundKeydown = onKeydown;
  searchInput.addEventListener('keydown', _boundKeydown);

  // Backdrop click → close
  if (backdropEl) {
    _boundBackdropClick = (e) => {
      if (e.target === backdropEl) {
        closeSearch();
      }
    };
    searchModal.addEventListener('click', _boundBackdropClick);
  }

  // Click on result items (delegated)
  searchResults.addEventListener('click', onResultClick);
}

export function openSearch() {
  if (!searchModal || !searchInput) return;
  searchModal.style.display = 'flex';
  // The query stays live while the modal is closed, so reopening keeps
  // the text that produced the current grid. Selecting it means typing
  // still starts a fresh search.
  searchInput.focus();
  searchInput.select();
  selectedIndex = -1;
  applyQuery();
}

export function closeSearch() {
  if (!searchModal) return;
  searchModal.style.display = 'none';
  selectedIndex = -1;
}

export function isSearchOpen() {
  return !!searchModal && searchModal.style.display === 'flex';
}

/**
 * Get the current raw query text.
 */
export function getSearchQuery() {
  return searchInput ? searchInput.value.trim() : '';
}

/**
 * Clear the query box. Does not notify - the caller is already handling
 * the reset that prompted it.
 */
export function clearSearchQuery() {
  if (queryDebounceId) {
    clearTimeout(queryDebounceId);
    queryDebounceId = null;
  }
  if (searchInput) searchInput.value = '';
  selectedIndex = -1;
  if (isSearchOpen()) applyQuery();
}

export function updateSearchStations(stations) {
  allStations = stations;
  // Re-render against the new list only. Notifying here would bounce
  // straight back through the caller and loop.
  if (isSearchOpen()) {
    applyQuery();
  }
}

// Internal functions

/**
 * Recompute and render the result list. Never notifies.
 */
function applyQuery() {
  if (!searchInput) return;
  const query = searchInput.value.trim().toLowerCase();

  if (!query) {
    filteredStations = allStations.slice(0, MAX_RESULTS);
  } else {
    filteredStations = allStations.filter(station => {
      const nameMatch = station.name && station.name.toLowerCase().includes(query);
      const countryMatch = station.country && station.country.toLowerCase().includes(query);
      const tagsMatch = station.tags && station.tags.toLowerCase().includes(query);
      return nameMatch || countryMatch || tagsMatch;
    }).slice(0, MAX_RESULTS);
  }

  selectedIndex = -1;
  renderResults();
}

/**
 * Input handler: render immediately, propagate to the grid on a debounce.
 */
function handleInput() {
  applyQuery();

  if (!onQueryChangeCallback) return;

  if (queryDebounceId) clearTimeout(queryDebounceId);
  queryDebounceId = setTimeout(() => {
    queryDebounceId = null;
    onQueryChangeCallback(getSearchQuery());
  }, QUERY_DEBOUNCE_MS);
}

function renderResults() {
  if (!searchResults || !searchInput) return;
  searchResults.innerHTML = '';

  const query = searchInput.value.trim().toLowerCase();

  for (let i = 0; i < filteredStations.length; i++) {
    const station = filteredStations[i];
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.dataset.index = i;

    if (i === selectedIndex) {
      item.classList.add('selected');
    }

    // Build highlighted name
    const highlightedName = highlightMatch(station.name || 'Unknown', query);
    const flag = getCountryFlagEmoji(station.countrycode || '');

    // Line 1: Flag + name
    const line1 = document.createElement('div');
    line1.innerHTML = `${flag} ${highlightedName}`;
    line1.style.fontWeight = '600';
    item.appendChild(line1);

    // Line 2: Country + tags
    const line2 = document.createElement('div');
    line2.style.fontSize = '0.85em';
    line2.style.opacity = '0.7';
    const tagsText = station.tags ? station.tags.split(',').slice(0, 3).join(', ') : '';
    line2.textContent = [station.country, tagsText].filter(Boolean).join(' · ');
    item.appendChild(line2);

    searchResults.appendChild(item);
  }

  if (filteredStations.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'search-result-item';
    empty.textContent = 'No stations found';
    empty.style.opacity = '0.5';
    empty.style.cursor = 'default';
    searchResults.appendChild(empty);
  }
}

function onResultClick(e) {
  const item = e.target.closest('.search-result-item');
  if (!item) return;
  const index = parseInt(item.dataset.index, 10);
  if (isNaN(index)) return;
  selectStation(index);
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeSearch();
    return;
  }

  if (filteredStations.length === 0) return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      navigateSelection(1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      navigateSelection(-1);
      break;
    case 'Enter':
      e.preventDefault();
      if (selectedIndex >= 0) {
        selectStation(selectedIndex);
      } else if (filteredStations.length > 0) {
        selectStation(0);
      }
      break;
  }
}

function navigateSelection(direction) {
  if (filteredStations.length === 0) return;

  if (selectedIndex === -1) {
    selectedIndex = direction > 0 ? 0 : filteredStations.length - 1;
  } else {
    selectedIndex += direction;
  }

  // Clamp
  if (selectedIndex < 0) selectedIndex = filteredStations.length - 1;
  if (selectedIndex >= filteredStations.length) selectedIndex = 0;

  // Update classes
  const items = searchResults.querySelectorAll('.search-result-item');
  items.forEach((el, i) => {
    if (i === selectedIndex) {
      el.classList.add('selected');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      el.classList.remove('selected');
    }
  });
}

function selectStation(index) {
  if (index < 0 || index >= filteredStations.length) return;

  // A pending keystroke must not overwrite the grid after we close.
  if (queryDebounceId) {
    clearTimeout(queryDebounceId);
    queryDebounceId = null;
  }
  if (onQueryChangeCallback) {
    onQueryChangeCallback(getSearchQuery());
  }

  if (onSelectCallback) {
    onSelectCallback(filteredStations[index]);
  }
  closeSearch();
}

// Highlight matching portion of text with <mark> tags
function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx === -1) return escapeHtml(text);

  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);

  return `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${highlightMatch(after, query)}`;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getCountryFlagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '';
  const code = countryCode.toUpperCase();
  // Convert to regional indicator symbols
  return String.fromCodePoint(code.charCodeAt(0) + 0x1F1A6, code.charCodeAt(1) + 0x1F1A6);
}
