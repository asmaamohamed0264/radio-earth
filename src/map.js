import L from 'leaflet';
import 'leaflet.markercluster';

let map = null;
let markerClusterGroup = null;
let markersMap = new Map(); // stationuuid -> marker
let onStationClickCallback = null;

export function initMap(containerId, stations, onStationClick) {
  onStationClickCallback = onStationClick;

  // Create map
  map = L.map(containerId, {
    center: [20, 0],
    zoom: 2,
    zoomControl: true,
    attributionControl: true
  });

  // CartoDB Positron tiles - clean light theme
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

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

  // Clear existing markers
  markerClusterGroup.clearLayers();
  markersMap.clear();

  // Add markers for the given stations array
  for (const station of stations) {
    const lat = parseFloat(station.geo_lat);
    const lng = parseFloat(station.geo_long);

    if (!lat || !lng || isNaN(lat) || isNaN(lng)) continue;

    const marker = L.circleMarker([lat, lng], {
      radius: 6,
      color: '#111',
      weight: 1.5,
      fillColor: '#111',
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

// Helper to prevent XSS in popup content
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
