import L from 'leaflet';
import 'leaflet.markercluster';
import { getTheme, onThemeChange, themeColor } from './theme.js';

// CartoDB ships a matching dark basemap, so the map follows the theme
// instead of glaring white against a dark interface.
const TILE_URLS = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
};

let map = null;
let tileLayer = null;
let markerClusterGroup = null;
let markersMap = new Map(); // stationuuid -> marker
let onStationClickCallback = null;
let lastStations = [];

export function initMap(containerId, stations, onStationClick) {
  onStationClickCallback = onStationClick;

  // Create map
  map = L.map(containerId, {
    center: [20, 0],
    zoom: 2,
    zoomControl: true,
    attributionControl: true
  });

  tileLayer = L.tileLayer(TILE_URLS[getTheme()] || TILE_URLS.light, {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  // Swap the basemap and repaint the markers when the theme flips.
  onThemeChange((theme) => {
    if (tileLayer) tileLayer.setUrl(TILE_URLS[theme] || TILE_URLS.light);
    updateMapMarkers(lastStations);
  });

  // Create MarkerClusterGroup with spiderfy on max zoom
  markerClusterGroup = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    maxClusterRadius: 60,
    disableClusteringAtZoom: null
  });
  map.addLayer(markerClusterGroup);

  // Add markers for stations
  updateMapMarkers(stations);

  return { map, markersLayer: markerClusterGroup };
}

export function updateMapMarkers(stations) {
  if (!markerClusterGroup) return;

  lastStations = stations || [];

  // Markers are drawn, not styled by CSS, so they read the theme here.
  const dotColor = themeColor('--text', '#111');

  // Clear existing markers
  markerClusterGroup.clearLayers();
  markersMap.clear();

  // Add markers for the given stations array
  for (const station of lastStations) {
    const lat = parseFloat(station.geo_lat);
    const lng = parseFloat(station.geo_long);

    if (!lat || !lng || isNaN(lat) || isNaN(lng)) continue;

    const marker = L.circleMarker([lat, lng], {
      radius: 6,
      color: dotColor,
      weight: 1.5,
      fillColor: dotColor,
      fillOpacity: 0.7
    });

    // Popup with station name + country
    const popupContent = `<strong>${escapeHtml(station.name)}</strong><br>${escapeHtml(station.country || '')}`;
    marker.bindPopup(popupContent);

    // Click handler
    marker.on('click', () => {
      if (onStationClickCallback) {
        onStationClickCallback(station);
      }
    });

    markerClusterGroup.addLayer(marker);
    markersMap.set(station.stationuuid, marker);
  }
}

export function highlightMapMarker(stationUuid) {
  const marker = markersMap.get(stationUuid);
  if (!marker || !map) return;

  const latLng = marker.getLatLng();
  map.panTo(latLng, { animate: true, duration: 0.5 });
  marker.openPopup();
}

export function getMapInstance() {
  return map;
}

/**
 * Leaflet measures its container on creation, so a map that was hidden
 * while the globe was showing comes back with stale dimensions.
 */
export function refreshMapSize() {
  if (map) map.invalidateSize();
}

// Helper to prevent XSS in popup content
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
