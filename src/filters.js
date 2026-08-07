import {
  BITRATE_BUCKETS,
  getStationCountry,
  getStationTags,
  getBitrateBucketId,
  getBitrateBucketLabel
} from './api.js';

// Must match the class the stylesheet animates on.
const SIDEBAR_OPEN_CLASS = 'filter-sidebar--open';

let onChangeCallback = null;
let activeCountries = new Set();
let activeTags = new Set();
let activeBitrates = new Set();
let activeQuery = '';

let filterSidebar = null;
let filterCountries = null;
let filterTags = null;
let filterBitrates = null;

let _boundOutsideClick = null;

export function initFilters(stations, onChange) {
  filterSidebar = document.getElementById('filter-sidebar');
  filterCountries = document.getElementById('filter-countries');
  filterTags = document.getElementById('filter-tags');
  filterBitrates = document.getElementById('filter-bitrates');

  if (!filterSidebar) {
    console.warn('Filters: #filter-sidebar not found');
    return;
  }

  onChangeCallback = onChange;

  renderFilters(stations);

  // Checkbox change listeners (delegated)
  if (filterCountries) {
    filterCountries.addEventListener('change', onFilterChange);
  }
  if (filterTags) {
    filterTags.addEventListener('change', onFilterChange);
  }
  if (filterBitrates) {
    filterBitrates.addEventListener('change', onFilterChange);
  }

  // Close button
  const closeBtn = filterSidebar.querySelector('.close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeFilters);
  }

  // Click outside to close. The opening button carries
  // [data-open-filters] so its own click does not close the panel again.
  _boundOutsideClick = (e) => {
    if (filterSidebar.classList.contains(SIDEBAR_OPEN_CLASS)) {
      if (!filterSidebar.contains(e.target) && !e.target.closest('[data-open-filters]')) {
        closeFilters();
      }
    }
  };
  document.addEventListener('click', _boundOutsideClick);
}

export function openFilters() {
  if (filterSidebar) {
    filterSidebar.classList.add(SIDEBAR_OPEN_CLASS);
  }
}

export function closeFilters() {
  if (filterSidebar) {
    filterSidebar.classList.remove(SIDEBAR_OPEN_CLASS);
  }
}

export function getActiveFilters() {
  return {
    query: activeQuery,
    countries: Array.from(activeCountries),
    tags: Array.from(activeTags),
    bitrates: Array.from(activeBitrates)
  };
}

/**
 * Set the free-text query. Driven by the search modal so typing narrows
 * the grid and the map, not just the search result list.
 */
export function setQuery(query) {
  activeQuery = (query || '').trim();
}

export function getQuery() {
  return activeQuery;
}

/**
 * Clear every filter, including the query and all checkboxes.
 */
export function clearAllFilters() {
  activeQuery = '';
  activeCountries.clear();
  activeTags.clear();
  activeBitrates.clear();

  for (const container of [filterCountries, filterTags, filterBitrates]) {
    if (!container) continue;
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = false;
    });
  }
}

export function updateFilterOptions(stations) {
  // Preserve current active values
  const prevCountries = new Set(activeCountries);
  const prevTags = new Set(activeTags);
  const prevBitrates = new Set(activeBitrates);

  renderFilters(stations);

  // Re-check previously selected values that still exist
  restoreCheckboxState(filterCountries, prevCountries);
  restoreCheckboxState(filterTags, prevTags);
  restoreCheckboxState(filterBitrates, prevBitrates);

  // Update the active sets to only include values that are still present
  updateActiveSets();
}

export function setFiltersChangeCallback(cb) {
  onChangeCallback = cb;
}

// Internal functions

function renderFilters(stations) {
  // Counts are keyed by the same values filterStations compares against.
  const countryCounts = new Map();
  const tagCounts = new Map();
  const bitrateCounts = new Map();

  for (const station of stations) {
    const country = getStationCountry(station);
    countryCounts.set(country, (countryCounts.get(country) || 0) + 1);

    for (const tag of getStationTags(station)) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }

    const bucketId = getBitrateBucketId(station.bitrate);
    bitrateCounts.set(bucketId, (bitrateCounts.get(bucketId) || 0) + 1);
  }

  if (filterCountries) {
    renderCheckboxList(filterCountries, toEntries(countryCounts), 'country', activeCountries, 30);
  }
  if (filterTags) {
    renderCheckboxList(filterTags, toEntries(tagCounts), 'tag', activeTags, 30);
  }
  if (filterBitrates) {
    renderCheckboxList(filterBitrates, toBitrateEntries(bitrateCounts), 'bitrate', activeBitrates, null, false);
  }
}

/**
 * Map -> [{ value, label, count }], where value is what gets stored and
 * label is what gets shown. For countries and tags they coincide.
 */
function toEntries(counts) {
  return Array.from(counts, ([value, count]) => ({ value, label: value, count }));
}

/**
 * Bitrate entries keep the canonical bucket order and use bucket ids as
 * values, so the stored value matches what getBitrateBucketId returns.
 */
function toBitrateEntries(counts) {
  return BITRATE_BUCKETS
    .filter(bucket => counts.get(bucket.id))
    .map(bucket => ({
      value: bucket.id,
      label: getBitrateBucketLabel(bucket.id),
      count: counts.get(bucket.id)
    }));
}

function renderCheckboxList(container, entries, inputName, activeSet, limit = 30, sortByCount = true) {
  let items = entries;

  if (sortByCount) {
    items = [...entries].sort((a, b) => b.count - a.count);
  }

  if (limit) {
    items = items.slice(0, limit);
  }

  container.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'filter-list';

  for (const { value, label, count } of items) {
    const item = document.createElement('label');
    item.className = 'filter-item';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    input.name = inputName;
    if (activeSet.has(value)) {
      input.checked = true;
    }

    const spanLabel = document.createElement('span');
    spanLabel.textContent = label;

    const spanCount = document.createElement('span');
    spanCount.className = 'filter-count';
    spanCount.textContent = `(${count})`;

    item.appendChild(input);
    item.appendChild(spanLabel);
    item.appendChild(spanCount);
    list.appendChild(item);
  }

  container.appendChild(list);
}

function onFilterChange(e) {
  const checkbox = e.target;
  if (checkbox.tagName !== 'INPUT' || checkbox.type !== 'checkbox') return;

  const value = checkbox.value;
  const name = checkbox.name;

  if (name === 'country') {
    toggleSet(activeCountries, value, checkbox.checked);
  } else if (name === 'tag') {
    toggleSet(activeTags, value, checkbox.checked);
  } else if (name === 'bitrate') {
    toggleSet(activeBitrates, value, checkbox.checked);
  }

  if (onChangeCallback) {
    onChangeCallback(getActiveFilters());
  }
}

function toggleSet(set, value, isChecked) {
  if (isChecked) {
    set.add(value);
  } else {
    set.delete(value);
  }
}

function updateActiveSets() {
  // Sync active sets with currently checked checkboxes
  activeCountries = collectCheckedValues(filterCountries);
  activeTags = collectCheckedValues(filterTags);
  activeBitrates = collectCheckedValues(filterBitrates);
}

function collectCheckedValues(container) {
  if (!container) return new Set();
  const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
  return new Set(Array.from(checkboxes).map(cb => cb.value));
}

function restoreCheckboxState(container, prevActive) {
  if (!container) return;
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => {
    if (prevActive.has(cb.value)) {
      cb.checked = true;
    }
  });
}
