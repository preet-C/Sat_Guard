/**
 * satguardStore.js — Zustand global state for SatGuard
 *
 * Slices:
 *   simTime            – current simulation clock
 *   tleData            – TLE text from backend + loading/error state
 *   parsedSatellites   – parsed satellite records (satrec objects)
 *   selectedSatellite  – currently selected satellite object
 *   conjunctions       – conjunction analysis results
 *   contacts           – contact window results
 */

import { create } from "zustand";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const FETCH_TIMEOUT_MS = 30_000; // 30 seconds (cold start can take 15-30s)
const HEALTH_TIMEOUT_MS = 5_000; // 5 seconds for health check

// Track in-flight fetch so Retry can cancel a stale request
let _inflightController = null;

// Retry backoff delays in ms: immediate, 2s, 5s
const RETRY_DELAYS = [0, 2000, 5000];


const useSatguardStore = create((set) => ({
  // ── Engine State ───────────────────────────────────────────────
  cesiumReady: false,
  setCesiumReady: (ready) => set({ cesiumReady: ready }),

  // ── Simulation time ────────────────────────────────────────────
  simTime: new Date(),
  setSimTime: (time) => set({ simTime: time }),

  // ── Mission epoch (anchor for all synthetic TLE generation) ────
  // Initialized to current time rounded to nearest hour.
  // All physics pipelines use this as the TLE epoch & propagation start.
  missionEpoch: (() => {
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    return now;
  })(),
  setMissionEpoch: (epoch) => set({ missionEpoch: epoch instanceof Date ? epoch : new Date(epoch) }),

  // ── TLE data from backend ──────────────────────────────────────
  tleData: {
    satellites: null, // raw TLE text string
    debris: null, // raw TLE text string
    loading: false,
    error: null,
    retryCount: 0, // tracks consecutive retries for backoff
    loadingStartTime: null, // timestamp for progressive UI messages
  },
  setTleData: (partial) =>
    set((state) => ({ tleData: { ...state.tleData, ...partial } })),

  fetchTle: async () => {
    const state = useSatguardStore.getState();
    const currentRetry = state.tleData.retryCount;

    // Enforce retry backoff delay
    if (currentRetry > 0 && currentRetry <= RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[Math.min(currentRetry, RETRY_DELAYS.length) - 1];
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }

    // After 3 retries, advise waiting longer
    if (currentRetry >= 3) {
      set((s) => ({
        tleData: {
          ...s.tleData,
          loading: false,
          error:
            "Backend may still be starting. Please wait 30 seconds and try again.\n" +
            `Expected: ${API_BASE}/api/tle/satellites`,
        },
      }));
      return;
    }

    // Cancel any previous in-flight request
    if (_inflightController) {
      _inflightController.abort();
      _inflightController = null;
    }

    // Fresh controller for this invocation
    const controller = new AbortController();
    _inflightController = controller;

    set({
      tleData: {
        satellites: null,
        debris: null,
        loading: true,
        error: null,
        retryCount: currentRetry,
        loadingStartTime: Date.now(),
      },
    });

    try {
      // ── Step 1: Health check (fast fail if backend is down) ──────
      const healthController = new AbortController();
      const healthTimeout = setTimeout(
        () => healthController.abort(),
        HEALTH_TIMEOUT_MS
      );

      try {
        const healthRes = await fetch(`${API_BASE}/api/health`, {
          signal: healthController.signal,
        });
        clearTimeout(healthTimeout);
        if (!healthRes.ok) {
          throw new Error(`Health check returned ${healthRes.status}`);
        }
      } catch (healthErr) {
        clearTimeout(healthTimeout);
        if (_inflightController !== controller) return;
        set((s) => ({
          tleData: {
            ...s.tleData,
            loading: false,
            retryCount: currentRetry + 1,
            error:
              `Backend server not reachable at ${API_BASE}.\n` +
              "Start the backend with: uvicorn app.main:app --reload",
          },
        }));
        if (_inflightController === controller) _inflightController = null;
        return;
      }

      // ── Step 2: Fetch TLE data with generous timeout ────────────
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const [satRes, debrisRes] = await Promise.all([
        fetch(`${API_BASE}/api/tle/satellites`, { signal: controller.signal }),
        fetch(`${API_BASE}/api/tle/debris`, { signal: controller.signal }),
      ]);
      clearTimeout(timeoutId);

      if (!satRes.ok) throw new Error(`Satellites: ${satRes.status}`);
      if (!debrisRes.ok) throw new Error(`Debris: ${debrisRes.status}`);
      const satellites = await satRes.text();
      const debris = await debrisRes.text();

      set({
        tleData: {
          satellites,
          debris,
          loading: false,
          error: null,
          retryCount: 0,
          loadingStartTime: null,
        },
      });
    } catch (err) {
      // If this controller was replaced by a newer fetchTle() call, ignore
      if (_inflightController !== controller) return;

      const message =
        err.name === "AbortError"
          ? `Could not connect to backend. Make sure the backend server is running on port 8000, then retry.\nExpected: ${API_BASE}/api/tle/satellites`
          : err.message;
      set((s) => ({
        tleData: {
          ...s.tleData,
          loading: false,
          retryCount: currentRetry + 1,
          error: message,
        },
      }));
    } finally {
      if (_inflightController === controller) {
        _inflightController = null;
      }
    }
  },

  // ── Parsed satellite records (populated after TLE parse) ───────
  // Shape: [{ name, tle1, tle2, satrec }]
  parsedSatellites: [],
  setParsedSatellites: (list) => set({ parsedSatellites: list }),

  // ── Selected satellite ─────────────────────────────────────────
  // Shape when set: { noradId, name, tle1, tle2 }
  selectedSatellite: null,
  setSelectedSatellite: (sat) => set({ selectedSatellite: sat }),

  // ── User satellite radius (meters) for HBR calculation ─────────
  userSatelliteRadius: 1.0,
  setUserSatelliteRadius: (r) => set({ userSatelliteRadius: r }),

  // ── Conjunction analysis results ───────────────────────────────
  conjunctionAnalysis: {
    results: [],       // sorted conjunction objects from the worker
    loading: false,    // true while worker is running
    error: null,       // error string or null
    lastRun: null,     // ISO timestamp of last completed run
    targetOrbit: null, // { name, tle1, tle2 } of the target satellite
    source: "engine",  // "engine" | "safeSlot" — tracks data origin for UI badge
    safeSlotRank: null, // rank of the safe slot being previewed (1/2/3)
  },
  setConjunctionAnalysis: (partial) =>
    set((s) => ({
      conjunctionAnalysis: { ...s.conjunctionAnalysis, ...partial },
    })),

  // ── Conjunction analysis progress (from worker) ────────────────
  // Shape: { stage: 1-5, pct: 0-100, msg: "..." }
  conjunctionProgress: null,
  setConjunctionProgress: (progress) => set({ conjunctionProgress: progress }),

  // ── Selected conjunction (for B-plane visualization) ───────────
  selectedConjunction: null,
  setSelectedConjunction: (conj) => set({ selectedConjunction: conj }),

  // ── Contact window results ─────────────────────────────────────
  // Array of { stationId, stationName, aos, los, duration, maxElevation, aosAzimuth, losAzimuth }
  contacts: [],
  setContacts: (list) => set({ contacts: list }),
  contactsLoading: false,
  setContactsLoading: (v) => set({ contactsLoading: v }),
  contactsError: null,
  setContactsError: (e) => set({ contactsError: e }),
  contactsProgress: null,
  setContactsProgress: (p) => set({ contactsProgress: p }),

  // ── Target orbit parameters (live preview from OrbitInput) ──
  // Matches ORBIT_FIELDS defaults in OrbitInput.jsx
  targetOrbitParams: {
    altitude:    550,
    inclination: 97.0,
    eccentricity: 0.0,
    raan:        0.0,
    argPerigee:  0.0,
    meanAnomaly: 0.0,
    orbitCount:  1,
  },
  setTargetOrbitParams: (params) => set({ targetOrbitParams: params }),

  // ── Preview orbit params (non-destructive safe slot preview) ──
  // Set during "Preview on Globe", cleared on deselect or "Apply to Mission".
  // Globe uses previewOrbitParams || targetOrbitParams for the orbit line.
  previewOrbitParams: null,
  setPreviewOrbitParams: (params) => set({ previewOrbitParams: params }),

  // ── UI State ───────────────────────────────────────────────
  isTimelineCollapsed: false,
  setTimelineCollapsed: (val) => set({ isTimelineCollapsed: val }),

  // ── Orbit parameter locks (false = unlocked, true = locked) ──
  orbitParamLocks: {
    altitude: false,
    inclination: false,
    eccentricity: true,
    raan: true,
    argPerigee: true,
    meanAnomaly: true,
  },
  setOrbitParamLocks: (locks) => set({ orbitParamLocks: locks }),

  // ── Safe slot search configuration ────────────────────────
  safeSlotConfig: {
    mode: "normal",
    altTolerance: 50,
    inclTolerance: 3,
    eccentricityTolerance: 0.01,
    raanTolerance: 10,
    argPerigeeTolerance: 10,
    meanAnomalyTolerance: 10,
  },
  setSafeSlotConfig: (cfg) =>
    set((s) => ({ safeSlotConfig: { ...s.safeSlotConfig, ...cfg } })),

  // ── Safe slot analysis results ─────────────────────────────
  safeSlotAnalysis: {
    results: [],          // top 3 ranked safe slot objects
    allCandidates: [],    // all 200 candidates with heuristic scores (for scatter plot)
    loading: false,
    error: null,
    lastRun: null,
    baselineMetrics: null, // current orbit's metrics for comparison
  },
  setSafeSlotAnalysis: (partial) =>
    set((s) => ({
      safeSlotAnalysis: { ...s.safeSlotAnalysis, ...partial },
    })),

  // ── Safe slot search progress (from worker) ────────────────
  // Shape: { stage: 1-3, pct: 0-100, msg: "..." }
  safeSlotProgress: null,
  setSafeSlotProgress: (progress) => set({ safeSlotProgress: progress }),
}));

export default useSatguardStore;
