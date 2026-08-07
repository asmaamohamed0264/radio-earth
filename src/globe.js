import { geoOrthographic, geoPath, geoGraticule10, geoDistance } from 'd3-geo';
import { feature } from 'topojson-client';

// Country outlines are ~107 KB, so they load as a separate file the first
// time the globe is opened rather than riding along in the main bundle.
import countriesUrl from 'world-atlas/countries-110m.json?url';

const AUTO_ROTATE_DEG_PER_SEC = 4;

// How long the globe stays still after you stop dragging.
const IDLE_RESUME_MS = 4000;

// Click tolerance, in CSS pixels.
const HIT_RADIUS = 12;

// Past this, a pointer gesture counts as a drag rather than a click.
const DRAG_THRESHOLD = 4;

let container = null;
let canvas = null;
let ctx = null;
let projection = null;
let path = null;

let land = null;         // resolved once the topojson lands
let graticule = geoGraticule10();

let stations = [];       // only those with usable coordinates
let activeUuid = null;
let onStationClickCallback = null;

let rafId = null;
let running = false;
let lastFrame = 0;
let resumeAutoRotateAt = 0;

let pointerDown = false;
let dragged = false;
let pointerStart = null;
let rotationStart = null;

let resizeObserver = null;

/**
 * Keep only stations the globe can actually place.
 */
function withCoords(list) {
  const out = [];
  for (const s of list) {
    const lat = parseFloat(s.geo_lat);
    const lng = parseFloat(s.geo_long);
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) continue;
    out.push({ station: s, coords: [lng, lat] });
  }
  return out;
}

export function initGlobe(containerId, initialStations, onStationClick) {
  container = document.getElementById(containerId);
  if (!container) {
    console.warn('Globe: container not found');
    return;
  }

  onStationClickCallback = onStationClick;

  canvas = container.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
  }
  ctx = canvas.getContext('2d');

  projection = geoOrthographic().precision(0.5).rotate([0, -15, 0]);
  path = geoPath(projection, ctx);

  stations = withCoords(initialStations || []);

  resize();

  // The panel starts hidden, so its size is only real once shown.
  resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(container);

  setupPointer();
  loadLand();
}

/**
 * Country outlines, fetched once.
 */
async function loadLand() {
  if (land) return;
  try {
    const response = await fetch(countriesUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const topology = await response.json();
    land = feature(topology, topology.objects.countries);
    draw();
  } catch (err) {
    // The globe still works without outlines - graticule and dots remain.
    console.warn('Globe: country outlines unavailable:', err);
  }
}

export function updateGlobeMarkers(list) {
  stations = withCoords(list || []);
  if (activeUuid && !stations.some(s => s.station.stationuuid === activeUuid)) {
    activeUuid = null;
  }
  draw();
}

/**
 * Spin the selected station into view and hold it there for a moment.
 */
export function highlightGlobeMarker(stationUuid) {
  activeUuid = stationUuid;
  const entry = stations.find(s => s.station.stationuuid === stationUuid);
  if (!entry || !projection) {
    draw();
    return;
  }

  const [lng, lat] = entry.coords;
  animateRotationTo([-lng, -lat]);
  resumeAutoRotateAt = performance.now() + IDLE_RESUME_MS;
}

let rotationAnimation = null;

function animateRotationTo(target) {
  const from = projection.rotate();
  const start = performance.now();
  const duration = 600;

  // Take the short way round rather than unwinding the long arc.
  let deltaLambda = target[0] - from[0];
  while (deltaLambda > 180) deltaLambda -= 360;
  while (deltaLambda < -180) deltaLambda += 360;
  const deltaPhi = target[1] - from[1];

  rotationAnimation = { from, deltaLambda, deltaPhi, start, duration };
}

function stepRotationAnimation(now) {
  if (!rotationAnimation) return false;

  const { from, deltaLambda, deltaPhi, start, duration } = rotationAnimation;
  const t = Math.min(1, (now - start) / duration);
  const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  projection.rotate([
    from[0] + deltaLambda * eased,
    from[1] + deltaPhi * eased,
    from[2] || 0
  ]);

  if (t >= 1) rotationAnimation = null;
  return true;
}

/**
 * Start or stop the render loop. Stopping matters: an invisible globe
 * must not keep burning a frame budget.
 */
export function setGlobeRunning(active) {
  running = !!active;

  if (running) {
    resize();
    lastFrame = performance.now();
    if (!rafId) rafId = requestAnimationFrame(tick);
  } else if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function tick(now) {
  rafId = running ? requestAnimationFrame(tick) : null;

  const elapsed = now - lastFrame;
  lastFrame = now;

  const animating = stepRotationAnimation(now);

  if (!animating && !pointerDown && now >= resumeAutoRotateAt) {
    const rotation = projection.rotate();
    rotation[0] = (rotation[0] + (AUTO_ROTATE_DEG_PER_SEC * elapsed) / 1000) % 360;
    projection.rotate(rotation);
  }

  draw();
}

function resize() {
  if (!container || !canvas || !projection) return;

  const width = container.clientWidth;
  const height = container.clientHeight;
  if (!width || !height) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const padding = Math.max(24, Math.min(width, height) * 0.06);
  projection.fitExtent(
    [[padding, padding], [width - padding, height - padding]],
    { type: 'Sphere' }
  );

  draw();
}

function draw() {
  if (!ctx || !canvas || !projection) return;

  const width = canvas.width / (window.devicePixelRatio || 1);
  const height = canvas.height / (window.devicePixelRatio || 1);

  ctx.clearRect(0, 0, width, height);

  // Ocean
  ctx.beginPath();
  path({ type: 'Sphere' });
  ctx.fillStyle = '#f5f5f5';
  ctx.fill();

  // Graticule
  ctx.beginPath();
  path(graticule);
  ctx.strokeStyle = 'rgba(17, 17, 17, 0.08)';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Countries
  if (land) {
    ctx.beginPath();
    path(land);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(17, 17, 17, 0.18)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // Rim
  ctx.beginPath();
  path({ type: 'Sphere' });
  ctx.strokeStyle = 'rgba(17, 17, 17, 0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  drawStations();
}

/**
 * The centre of the visible hemisphere, in geographic coordinates.
 */
function visibleCenter() {
  const r = projection.rotate();
  return [-r[0], -r[1]];
}

function drawStations() {
  const center = visibleCenter();
  let active = null;

  ctx.fillStyle = 'rgba(17, 17, 17, 0.62)';

  for (const entry of stations) {
    // Anything more than a quarter turn away is on the far side.
    if (geoDistance(entry.coords, center) > Math.PI / 2) continue;

    const point = projection(entry.coords);
    if (!point) continue;

    if (entry.station.stationuuid === activeUuid) {
      active = point;
      continue;
    }

    ctx.beginPath();
    ctx.arc(point[0], point[1], 1.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Drawn last so the halo is never covered by another dot.
  if (active) {
    ctx.beginPath();
    ctx.arc(active[0], active[1], 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(17, 17, 17, 0.12)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(active[0], active[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(active[0], active[1], 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function setupPointer() {
  canvas.addEventListener('pointerdown', (e) => {
    pointerDown = true;
    dragged = false;
    pointerStart = [e.clientX, e.clientY];
    rotationStart = projection.rotate();
    rotationAnimation = null;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointerDown || !pointerStart) return;

    const dx = e.clientX - pointerStart[0];
    const dy = e.clientY - pointerStart[1];

    if (!dragged && Math.hypot(dx, dy) > DRAG_THRESHOLD) dragged = true;
    if (!dragged) return;

    // Scale drag by zoom so the globe tracks the cursor at any size.
    const sensitivity = 75 / projection.scale();
    const next = [
      rotationStart[0] + dx * sensitivity,
      // Clamped so the globe cannot roll past the poles.
      Math.max(-90, Math.min(90, rotationStart[1] - dy * sensitivity)),
      rotationStart[2] || 0
    ];
    projection.rotate(next);
    draw();
  });

  const endPointer = (e) => {
    if (!pointerDown) return;
    pointerDown = false;
    resumeAutoRotateAt = performance.now() + IDLE_RESUME_MS;

    if (!dragged) handleClick(e);
    dragged = false;
  };

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', () => {
    pointerDown = false;
    dragged = false;
  });

  canvas.addEventListener('pointerleave', () => {
    if (pointerDown) {
      pointerDown = false;
      dragged = false;
      resumeAutoRotateAt = performance.now() + IDLE_RESUME_MS;
    }
  });
}

function handleClick(e) {
  if (!onStationClickCallback) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const center = visibleCenter();

  let best = null;
  let bestDistance = HIT_RADIUS;

  for (const entry of stations) {
    if (geoDistance(entry.coords, center) > Math.PI / 2) continue;
    const point = projection(entry.coords);
    if (!point) continue;

    const distance = Math.hypot(point[0] - x, point[1] - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry.station;
    }
  }

  if (best) onStationClickCallback(best);
}

export function isGlobeReady() {
  return !!projection;
}
