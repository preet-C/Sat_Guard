/**
 * groundStations.js — Ground station CRUD with localStorage persistence
 *
 * Default 6 stations are seeded on first load. User modifications
 * (add/edit/delete) are persisted across browser refreshes.
 */

const STORAGE_KEY = "satguard_ground_stations";

/** Default ground station dataset */
const DEFAULT_STATIONS = [
  { id: "gs-bangalore", name: "Bangalore", lat: 12.97, lon: 77.59, alt: 0.92, elevationMask: 10, color: "#ff6b6b", visible: true },
  { id: "gs-houston",   name: "Houston",   lat: 29.76, lon: -95.37, alt: 0.03, elevationMask: 10, color: "#ffa502", visible: true },
  { id: "gs-svalbard",  name: "Svalbard",  lat: 78.23, lon: 15.40,  alt: 0.46, elevationMask: 10, color: "#2ed573", visible: true },
  { id: "gs-kourou",    name: "Kourou",    lat: 5.16,  lon: -52.65, alt: 0.04, elevationMask: 10, color: "#1e90ff", visible: true },
  { id: "gs-nairobi",   name: "Nairobi",   lat: -1.29, lon: 36.82,  alt: 1.79, elevationMask: 10, color: "#a55eea", visible: true },
  { id: "gs-beijing",   name: "Beijing",   lat: 39.90, lon: 116.39, alt: 0.05, elevationMask: 10, color: "#fd79a8", visible: true },
];

/* ── Internal helpers ──────────────────────────────────────────── */

function _read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // corrupted data — fall through to defaults
  }
  // First load or corrupted: seed defaults
  _write(DEFAULT_STATIONS);
  return [...DEFAULT_STATIONS];
}

function _write(stations) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stations));
}

function _generateId() {
  return "gs-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Dispatch custom event so Globe.jsx can re-render ground stations */
function _notify() {
  window.dispatchEvent(new CustomEvent("groundStationsChanged"));
}

/* ── Public API ────────────────────────────────────────────────── */

/**
 * Get all ground stations. Seeds defaults on first call.
 * @returns {Array<{ id: string, name: string, lat: number, lon: number, alt: number, elevationMask: number, color: string, visible: boolean }>}
 */
export function getStations() {
  // Migrate legacy stations that lack elevationMask
  const list = _read();
  let dirty = false;
  for (const s of list) {
    if (s.elevationMask === undefined) {
      s.elevationMask = 10;
      dirty = true;
    }
  }
  if (dirty) _write(list);
  return list;
}

/**
 * Add a new ground station.
 * @param {{ name: string, lat: number, lon: number, alt: number, elevationMask?: number, color?: string }} station
 * @returns {Array} updated station list
 */
export function addStation(station) {
  const stations = _read();
  const newStation = {
    id: _generateId(),
    name: station.name,
    lat: station.lat,
    lon: station.lon,
    alt: station.alt ?? 0,
    elevationMask: station.elevationMask ?? 10,
    color: station.color ?? "#00d4ff",
    visible: true,
  };
  stations.push(newStation);
  _write(stations);
  _notify();
  return stations;
}

/**
 * Remove a ground station by id.
 * @param {string} id
 * @returns {Array} updated station list
 */
export function removeStation(id) {
  let stations = _read();
  stations = stations.filter((s) => s.id !== id);
  _write(stations);
  _notify();
  return stations;
}

/**
 * Update a ground station with partial data.
 * @param {string} id
 * @param {object} data — partial fields to merge
 * @returns {Array} updated station list
 */
export function updateStation(id, data) {
  const stations = _read();
  const idx = stations.findIndex((s) => s.id === id);
  if (idx !== -1) {
    stations[idx] = { ...stations[idx], ...data };
  }
  _write(stations);
  _notify();
  return stations;
}
