import { getTheme, onThemeChange, themeColor } from './theme.js';

// globe.gl pulls in three.js, which is by far the heaviest thing in this
// project. It is imported dynamically so none of it is downloaded unless
// this view is actually opened.
let GlobeCtor = null;

// Textures come from the three-globe examples, matched to the theme.
const TEXTURES = {
  light: '//unpkg.com/three-globe/example/img/earth-day.jpg',
  dark: '//unpkg.com/three-globe/example/img/earth-night.jpg'
};

const AUTO_ROTATE_SPEED = 0.3;

let container = null;
let globe = null;
let stations = [];
let activeUuid = null;
let onStationClickCallback = null;
let resizeObserver = null;
let resumeRotateTimer = null;

function withCoords(list) {
  return (list || []).filter(s => {
    const lat = parseFloat(s.geo_lat);
    const lng = parseFloat(s.geo_long);
    return lat && lng && !isNaN(lat) && !isNaN(lng);
  });
}

function pointColor(station) {
  return station.stationuuid === activeUuid
    ? themeColor('--danger', '#e00')
    : themeColor('--text', '#111');
}

function applyTheme() {
  if (!globe) return;
  const theme = getTheme();
  globe
    .globeImageUrl(TEXTURES[theme] || TEXTURES.light)
    .backgroundColor(themeColor('--bg', '#fff'))
    .atmosphereColor(theme === 'dark' ? '#33506e' : '#dfe7ef');
  // Force the points to re-evaluate their colour accessor.
  globe.pointColor(globe.pointColor());
}

/**
 * @returns {Promise<void>} resolves once three.js has loaded and the
 *   globe is mounted, so callers can await a usable view.
 */
export async function initGlobeGl(containerId, initialStations, onStationClick) {
  container = document.getElementById(containerId);
  if (!container) {
    console.warn('GlobeGL: container not found');
    return;
  }

  onStationClickCallback = onStationClick;
  stations = withCoords(initialStations);

  if (!GlobeCtor) {
    const module = await import('globe.gl');
    GlobeCtor = module.default;
  }

  // globe.gl follows the kapsule pattern: it must be constructed with
  // `new`, otherwise nothing mounts.
  globe = new GlobeCtor(container)
    .showAtmosphere(true)
    .atmosphereAltitude(0.08)
    .pointsData(stations)
    .pointLat(d => parseFloat(d.geo_lat))
    .pointLng(d => parseFloat(d.geo_long))
    .pointColor(pointColor)
    .pointAltitude(0.02)
    .pointRadius(0.3)
    .pointLabel(d => `<div class="globe-label"><b>${escapeHtml(d.name)}</b><br/>${escapeHtml(d.country || '')}</div>`)
    .onPointClick(point => {
      if (point && onStationClickCallback) onStationClickCallback(point);
    })
    .onPointHover(point => {
      const renderer = globe.renderer && globe.renderer();
      if (renderer && renderer.domElement) {
        renderer.domElement.style.cursor = point ? 'pointer' : 'default';
      }
    });

  applyTheme();
  onThemeChange(applyTheme);

  const controls = globe.controls && globe.controls();
  if (controls) {
    controls.autoRotate = true;
    controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
  }

  // globe.gl sizes itself to the window by default, but this container
  // is only the right-hand panel and is shorter than the viewport.
  resize();
  resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(container);
}

function resize() {
  if (!globe || !container) return;
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (!width || !height) return;
  globe.width(width).height(height);
}

export function updateGlobeGlMarkers(list) {
  if (!globe) return;
  stations = withCoords(list);
  if (activeUuid && !stations.some(s => s.stationuuid === activeUuid)) {
    activeUuid = null;
  }
  globe.pointsData(stations);
}

export function highlightGlobeGlMarker(stationUuid) {
  activeUuid = stationUuid;
  if (!globe) return;

  globe.pointColor(pointColor);

  const station = stations.find(s => s.stationuuid === stationUuid);
  if (!station) return;

  const lat = parseFloat(station.geo_lat);
  const lng = parseFloat(station.geo_long);
  if (isNaN(lat) || isNaN(lng)) return;

  const controls = globe.controls && globe.controls();
  if (controls) controls.autoRotate = false;

  globe.pointOfView({ lat, lng, altitude: 1.6 }, 800);

  // Resume spinning once the selected station has had time to be seen.
  if (resumeRotateTimer) clearTimeout(resumeRotateTimer);
  resumeRotateTimer = setTimeout(() => {
    resumeRotateTimer = null;
    if (controls) controls.autoRotate = true;
  }, 5000);
}

/**
 * three.js keeps its own animation loop, so pausing means telling the
 * controls to stop rather than cancelling a frame request of ours.
 */
export function setGlobeGlRunning(active) {
  if (!globe) return;
  const controls = globe.controls && globe.controls();
  if (controls) controls.autoRotate = !!active;
  if (active) resize();
}

export function isGlobeGlReady() {
  return !!globe;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
