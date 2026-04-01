/**
 * conjunctionWorker.js — Web Worker for heavy conjunction propagation
 *
 * Runs SGP4 propagation off the main thread so 300-object screening
 * over 24-hour windows doesn't freeze the UI.
 *
 * Message protocol:
 *   IN:  { type: "propagatePaths", payload: { tleList, startTime, steps, intervalSeconds } }
 *         tleList  = [{ name, tle1, tle2 }, ...]
 *         startTime = ISO string
 *   OUT: { type: "propagatePathsResult", payload: { paths } }
 *         paths = [{ name, path: [{ lat, lon, alt, time }] }, ...]
 *
 *   IN:  { type: "propagatePositions", payload: { tleList, time } }
 *   OUT: { type: "propagatePositionsResult", payload: { positions } }
 *         positions = [{ name, lat, lon, alt } | { name, error: true }, ...]
 */

import * as satellite from "satellite.js";

/* ── SGP4 helpers (duplicated from propagator.js for worker scope) ── */

function parseTLE(tle1, tle2) {
  try {
    const satrec = satellite.twoline2satrec(tle1.trim(), tle2.trim());
    if (satrec.error !== 0) return null;
    return satrec;
  } catch {
    return null;
  }
}

function propagatePosition(satrec, date) {
  const pv = satellite.propagate(satrec, date);
  if (!pv) return null;
  const posEci = pv.position;
  if (!posEci || posEci === false) return null;

  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(posEci, gmst);

  return {
    lat: satellite.degreesLat(geo.latitude),
    lon: satellite.degreesLong(geo.longitude),
    alt: geo.height,
  };
}

function propagatePath(satrec, startDate, steps, intervalSeconds) {
  const path = [];
  for (let i = 0; i < steps; i++) {
    const time = new Date(startDate.getTime() + i * intervalSeconds * 1000);
    const pos = propagatePosition(satrec, time);
    if (pos) {
      path.push({ ...pos, time: time.toISOString() });
    }
  }
  return path;
}

/* ── TLE epoch → Date ────────────────────────────────────────── */
function tleEpochDate(tle1) {
  let yr = parseInt(tle1.substring(18, 20), 10);
  yr += yr < 57 ? 2000 : 1900;
  const dayOfYear = parseFloat(tle1.substring(20, 32));
  const jan1 = new Date(Date.UTC(yr, 0, 1));
  return new Date(jan1.getTime() + (dayOfYear - 1) * 86400000);
}

/* ── Classify catalog object type by name ────────────────────── */
function objectRadius(name) {
  const upper = (name || "").toUpperCase();
  if (upper.includes("DEB") || upper.includes("R/B") || upper.includes("DEBRIS")) {
    return 1.0;
  }
  return 4.0;
}

/* ── Unified risk scoring (shared by main engine & safe-slot pipeline) ── */
function computeRiskMetrics({
  tcaResult, catalogName, catalogTLE1, catalogTLE2,
  userRadius, index, idPrefix = "conj",
}) {
  const { tca, miss_distance_km, relative_velocity_kms,
          position1_ECI, position2_ECI, velocity1_ECI, vRel_ECI } = tcaResult;

  const now = new Date();
  const epochDate = catalogTLE1 ? tleEpochDate(catalogTLE1) : now;
  const age_days = Math.max((now.getTime() - epochDate.getTime()) / 86400000, 0);

  const sigma_R = 0.5 + 0.3 * age_days;
  const sigma_T = 5.0 + 2.0 * age_days;
  const sigma_N = 0.5 + 0.1 * age_days;
  const sigma_est = Math.sqrt(sigma_R ** 2 + sigma_T ** 2 + sigma_N ** 2);

  const obj_radius = objectRadius(catalogName);
  const hbr_combined = (userRadius + obj_radius) / 1000;

  const miss = miss_distance_km;
  const vRel = relative_velocity_kms;
  const risk_score = (hbr_combined ** 2 / (miss ** 2 + 1e-12)) *
                     (vRel / 10.0) *
                     Math.exp(-miss / sigma_est);

  const pc_upper_bound = 1 - Math.exp(-(hbr_combined ** 2) / (2 * sigma_est ** 2));

  let risk_level;
  if (pc_upper_bound > 1e-4) risk_level = "CRITICAL";
  else if (pc_upper_bound > 1e-5) risk_level = "HIGH";
  else if (pc_upper_bound > 1e-6) risk_level = "MEDIUM";
  else risk_level = "LOW";

  let confidence_level;
  if (age_days < 1) confidence_level = "fresh";
  else if (age_days < 3) confidence_level = "usable";
  else if (age_days < 7) confidence_level = "degraded";
  else confidence_level = "stale";

  const noradId = catalogTLE1 ? catalogTLE1.substring(2, 7).trim() : String(index).padStart(5, "0");

  return {
    id: `${idPrefix}-${index}-${noradId}`,
    catalogName: catalogName || "UNKNOWN",
    noradId,
    tca_iso_string: tca.toISOString(),
    miss_distance_km,
    relative_velocity_kms,
    risk_score,
    pc_upper_bound,
    risk_level,
    tle_age_days: Math.round(age_days * 100) / 100,
    confidence_level,
    sigma_est_km: Math.round(sigma_est * 1000) / 1000,
    sigma_R_km: Math.round(sigma_R * 1000) / 1000,
    sigma_T_km: Math.round(sigma_T * 1000) / 1000,
    sigma_N_km: Math.round(sigma_N * 1000) / 1000,
    hbr_combined_m: userRadius + obj_radius,
    position1_ECI,
    position2_ECI,
    velocity1_ECI,
    vRel_ECI,
    tle1: catalogTLE1 || "",
    tle2: catalogTLE2 || "",
  };
}

/* ── Message handler ─────────────────────────────────────────────── */

self.onmessage = function (e) {
  const { type, payload } = e.data;

  if (type === "propagatePaths") {
    const { tleList, startTime, steps, intervalSeconds } = payload;
    const start = new Date(startTime);
    const paths = [];

    for (const item of tleList) {
      const satrec = parseTLE(item.tle1, item.tle2);
      if (!satrec) {
        paths.push({ name: item.name, path: [] });
        continue;
      }
      const path = propagatePath(satrec, start, steps, intervalSeconds);
      paths.push({ name: item.name, path });
    }

    self.postMessage({ type: "propagatePathsResult", payload: { paths } });
  }

  if (type === "propagatePositions") {
    const { tleList, time } = payload;
    const date = new Date(time);
    const positions = [];

    for (const item of tleList) {
      const satrec = parseTLE(item.tle1, item.tle2);
      if (!satrec) {
        positions.push({ name: item.name, error: true });
        continue;
      }
      const pos = propagatePosition(satrec, date);
      if (pos) {
        positions.push({ name: item.name, ...pos });
      } else {
        positions.push({ name: item.name, error: true });
      }
    }

    self.postMessage({ type: "propagatePositionsResult", payload: { positions } });
  }

  /* ═══════════════════════════════════════════════════════════════════
   * analyzeConjunctions — 5-stage conjunction detection engine
   * ═══════════════════════════════════════════════════════════════════ */
  if (type === "analyzeConjunctions") {
    const t0 = performance.now();
    try {
      const { target, catalog, userRadius = 1.0, startTime } = payload;
      const start = new Date(startTime);

      const MU = 398600.4418;       // km³/s² — Earth gravitational parameter
      const R_EARTH = 6371;         // km
      const TWO_PI = 2 * Math.PI;
      const COARSE_INTERVAL = 60;   // seconds
      const COARSE_THRESHOLD = 50;  // km — max ECI distance for a window
      const STEPS_PER_DAY = 1440;   // 60s intervals in 24h
      const FULL_DAYS = 7;
      const SHORT_DAYS = 3;
      const BISECT_TOLERANCE = 1000; // 1 second in ms

      /* ─── helper: compute apogee / perigee / incl from satrec ──── */
      function orbitalParams(satrec) {
        // satrec.no is mean motion in rad/min → convert to rad/s
        const n_rad_s = satrec.no / 60;
        const a = Math.pow(MU / (n_rad_s * n_rad_s), 1 / 3); // km
        const e = satrec.ecco;
        const perigee = a * (1 - e) - R_EARTH;
        const apogee  = a * (1 + e) - R_EARTH;
        const incl_deg = satrec.inclo * (180 / Math.PI);
        return { a, perigee, apogee, incl_deg };
      }

      /* ─── helper: propagate to ECI position + velocity ─────────── */
      function propagateECI(satrec, date) {
        const pv = satellite.propagate(satrec, date);
        if (!pv || !pv.position || pv.position === false) return null;
        return { pos: pv.position, vel: pv.velocity };
      }

      /* ─── helper: 3D distance between two ECI position vectors ─── */
      function eciDist(a, b) {
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      }

      /* ─── helper: dot product of two {x,y,z} vectors ──────────── */
      function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

      /* (tleEpochDate & objectRadius are now module-level shared helpers) */

      // ────────────────────────────────────────────────────────────
      // Parse target satellite
      // ────────────────────────────────────────────────────────────
      const targetRec = parseTLE(target.tle1, target.tle2);
      if (!targetRec) {
        self.postMessage({ type: "conjunctionError", payload: { error: "Failed to parse target TLE" } });
        return;
      }
      const targetParams = orbitalParams(targetRec);

      // ══════════════════════════════════════════════════════════════
      // STAGE 1 — Hoots Cascade Filter
      // ══════════════════════════════════════════════════════════════
      self.postMessage({ type: "conjunctionProgress", payload: { stage: 1, pct: 0, msg: "Running orbital filter…" } });

      const candidates = [];
      for (const obj of catalog) {
        const rec = parseTLE(obj.tle1, obj.tle2);
        if (!rec) continue;

        const op = orbitalParams(rec);

        // Apogee / perigee filter (75 km margin)
        if (op.apogee < targetParams.perigee - 75) continue;
        if (op.perigee > targetParams.apogee + 75) continue;

        // Retrograde crossing filter
        const inclDiff = Math.abs(op.incl_deg - targetParams.incl_deg);
        if (inclDiff > 180 - targetParams.incl_deg) continue;

        candidates.push({ ...obj, satrec: rec, orbParams: op });
      }

      self.postMessage({
        type: "conjunctionProgress",
        payload: { stage: 1, pct: 100, msg: `Filtered to ${candidates.length} candidates` },
      });

      if (candidates.length === 0) {
        self.postMessage({
          type: "conjunctionResult",
          payload: { results: [], elapsed_ms: performance.now() - t0 },
        });
        return;
      }

      // ══════════════════════════════════════════════════════════════
      // STAGE 1.5 — Ephemeris Cache (conditional: only for large candidate sets)
      // ══════════════════════════════════════════════════════════════
      const USE_CACHE = candidates.length > 200;
      const CACHE_INTERVAL_MAIN = 120;  // 2-minute resolution
      const CACHE_DAYS_MAIN = 7;
      const FLOATS_PER_POS = 3;
      let mainCacheSteps = CACHE_DAYS_MAIN * 24 * 60 / (CACHE_INTERVAL_MAIN / 60); // 5040
      let mainCacheInterval = CACHE_INTERVAL_MAIN;
      let mainEphemeris = null;

      if (USE_CACHE) {
        self.postMessage({ type: "conjunctionProgress", payload: { stage: 2, pct: 0, msg: `Building ephemeris cache for ${candidates.length} candidates...` } });

        // Memory cap: 200MB
        const MAX_MB = 200;
        let rawMB = candidates.length * mainCacheSteps * FLOATS_PER_POS * 8 / (1024 * 1024);
        if (rawMB > MAX_MB) {
          mainCacheInterval = 240; // 4-min
          mainCacheSteps = CACHE_DAYS_MAIN * 24 * 60 / (mainCacheInterval / 60); // 2520
          rawMB = candidates.length * mainCacheSteps * FLOATS_PER_POS * 8 / (1024 * 1024);
        }

        const cacheBytes = candidates.length * mainCacheSteps * FLOATS_PER_POS * Float64Array.BYTES_PER_ELEMENT;
        mainEphemeris = new Float64Array(cacheBytes / Float64Array.BYTES_PER_ELEMENT);

        // Propagate all candidates into the cache
        for (let c = 0; c < candidates.length; c++) {
          const satrec = candidates[c].satrec;
          for (let s = 0; s < mainCacheSteps; s++) {
            const date = new Date(start.getTime() + s * mainCacheInterval * 1000);
            const pv = satellite.propagate(satrec, date);
            const baseIdx = (c * mainCacheSteps + s) * FLOATS_PER_POS;
            if (pv && pv.position && pv.position !== false) {
              mainEphemeris[baseIdx]     = pv.position.x;
              mainEphemeris[baseIdx + 1] = pv.position.y;
              mainEphemeris[baseIdx + 2] = pv.position.z;
            } else {
              mainEphemeris[baseIdx] = NaN;
              mainEphemeris[baseIdx + 1] = NaN;
              mainEphemeris[baseIdx + 2] = NaN;
            }
          }
          if ((c + 1) % 50 === 0 || c === candidates.length - 1) {
            self.postMessage({ type: "conjunctionProgress", payload: { stage: 2, pct: Math.round(((c + 1) / candidates.length) * 40), msg: `Cache: ${c + 1}/${candidates.length} candidates propagated` } });
          }
        }
      }

      // ══════════════════════════════════════════════════════════════
      // STAGE 2 — Coarse SGP4 Pass (cache-accelerated or sequential)
      // ══════════════════════════════════════════════════════════════
      if (!USE_CACHE) {
        self.postMessage({ type: "conjunctionProgress", payload: { stage: 2, pct: 0, msg: "Coarse SGP4 screening..." } });
      } else {
        self.postMessage({ type: "conjunctionProgress", payload: { stage: 2, pct: 40, msg: "Cache-accelerated coarse pass..." } });
      }

      const candState = candidates.map(() => ({ windows: [], inWindow: false, wStart: null, hadCloseApproach: false, done: false }));

      if (USE_CACHE) {
        // ── Cache-accelerated path: propagate ONLY the target, read candidates from cache ──
        const totalSteps = mainCacheSteps; // full 7-day cache
        const triageStep = Math.floor(1440 / (mainCacheInterval / 60)); // 1 day in cache steps

        for (let step = 0; step < totalSteps; step++) {
          const t = new Date(start.getTime() + step * mainCacheInterval * 1000);
          const userECI = propagateECI(targetRec, t);
          if (!userECI) continue;
          const ux = userECI.pos.x, uy = userECI.pos.y, uz = userECI.pos.z;

          for (let c = 0; c < candidates.length; c++) {
            const cs = candState[c];
            if (cs.done) continue;

            // Triage: after 3 days, stop analyzing candidates with no close approaches
            if (step >= triageStep * 3 && !cs.hadCloseApproach) {
              if (cs.inWindow) {
                cs.windows.push({ start: cs.wStart, end: new Date(start.getTime() + (step - 1) * mainCacheInterval * 1000) });
                cs.inWindow = false;
              }
              cs.done = true;
              continue;
            }

            const baseIdx = (c * mainCacheSteps + step) * FLOATS_PER_POS;
            const ox = mainEphemeris[baseIdx];
            if (ox !== ox) continue; // NaN check
            const oy = mainEphemeris[baseIdx + 1];
            const oz = mainEphemeris[baseIdx + 2];
            const dx = ux - ox, dy = uy - oy, dz = uz - oz;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < COARSE_THRESHOLD) {
              if (!cs.inWindow) { cs.inWindow = true; cs.wStart = t; }
              cs.hadCloseApproach = true;
            } else if (cs.inWindow) {
              cs.windows.push({ start: cs.wStart, end: t });
              cs.inWindow = false;
            }
          }

          if (step % (triageStep) === 0 && step > 0) {
            const day = Math.round(step / triageStep);
            self.postMessage({ type: "conjunctionProgress", payload: { stage: 2, pct: 40 + Math.round((step / totalSteps) * 55), msg: `Cache scan day ${day}/${CACHE_DAYS_MAIN}...` } });
          }
        }

        // Close open windows
        const cacheEndTime = new Date(start.getTime() + (totalSteps - 1) * mainCacheInterval * 1000);
        for (let c = 0; c < candidates.length; c++) {
          if (candState[c].inWindow) {
            candState[c].windows.push({ start: candState[c].wStart, end: cacheEndTime });
          }
        }
      } else {
        // ── Original sequential path (<=200 candidates) ──
        const totalStepsFull = STEPS_PER_DAY * FULL_DAYS;   // 10080
        const totalStepsShort = STEPS_PER_DAY * SHORT_DAYS;  // 4320
        const triageStep = STEPS_PER_DAY;                     // 1440

        for (let step = 0; step < totalStepsFull; step++) {
          const t = new Date(start.getTime() + step * COARSE_INTERVAL * 1000);
          const userECI = propagateECI(targetRec, t);
          if (!userECI) continue;

          for (let c = 0; c < candidates.length; c++) {
            const cs = candState[c];
            if (cs.done) continue;

            if (step >= totalStepsShort && !cs.hadCloseApproach) {
              if (cs.inWindow) {
                cs.windows.push({ start: cs.wStart, end: new Date(start.getTime() + (step - 1) * COARSE_INTERVAL * 1000) });
                cs.inWindow = false;
              }
              cs.done = true;
              continue;
            }

            const objECI = propagateECI(candidates[c].satrec, t);
            if (!objECI) continue;
            const dist = eciDist(userECI.pos, objECI.pos);

            if (dist < COARSE_THRESHOLD) {
              if (!cs.inWindow) { cs.inWindow = true; cs.wStart = t; }
              cs.hadCloseApproach = true;
            } else if (cs.inWindow) {
              cs.windows.push({ start: cs.wStart, end: t });
              cs.inWindow = false;
            }
          }

          if (step === triageStep) {
            for (let c = 0; c < candidates.length; c++) {
              if (candState[c].inWindow) candState[c].hadCloseApproach = true;
            }
          }

          if (step % STEPS_PER_DAY === 0 && step > 0) {
            const day = step / STEPS_PER_DAY;
            self.postMessage({ type: "conjunctionProgress", payload: { stage: 2, pct: Math.round((step / totalStepsFull) * 100), msg: `Day ${day}/${FULL_DAYS} scanned...` } });
          }
        }

        // Close open windows
        const endTime = new Date(start.getTime() + (STEPS_PER_DAY * FULL_DAYS - 1) * COARSE_INTERVAL * 1000);
        for (let c = 0; c < candidates.length; c++) {
          if (candState[c].inWindow) {
            candState[c].windows.push({ start: candState[c].wStart, end: endTime });
          }
        }
      }

      // Collect windows
      const windowList = [];
      for (let c = 0; c < candidates.length; c++) {
        for (const w of candState[c].windows) {
          windowList.push({ candidate: candidates[c], windowStart: w.start, windowEnd: w.end });
        }
      }

      self.postMessage({
        type: "conjunctionProgress",
        payload: { stage: 2, pct: 100, msg: `Found ${windowList.length} conjunction windows` },
      });

      if (windowList.length === 0) {
        self.postMessage({
          type: "conjunctionResult",
          payload: { results: [], elapsed_ms: performance.now() - t0 },
        });
        return;
      }

      // ══════════════════════════════════════════════════════════════
      // STAGE 3 — Precise TCA via Bisection on r_rel · v_rel
      // ══════════════════════════════════════════════════════════════
      self.postMessage({ type: "conjunctionProgress", payload: { stage: 3, pct: 0, msg: "Refining TCA…" } });

      const tcaResults = [];

      for (let w = 0; w < windowList.length; w++) {
        const { candidate, windowStart, windowEnd } = windowList[w];

        let tA = windowStart.getTime();
        let tB = windowEnd.getTime();

        // Evaluate f(t) = r_rel · v_rel at endpoints
        function fOfT(tMs) {
          const d = new Date(tMs);
          const u = propagateECI(targetRec, d);
          const o = propagateECI(candidate.satrec, d);
          if (!u || !o) return { val: NaN, u: null, o: null };
          const rRel = { x: o.pos.x - u.pos.x, y: o.pos.y - u.pos.y, z: o.pos.z - u.pos.z };
          const vRel = { x: o.vel.x - u.vel.x, y: o.vel.y - u.vel.y, z: o.vel.z - u.vel.z };
          const v = dot(rRel, vRel);
          if (!isFinite(v)) return { val: NaN, u: null, o: null };
          return { val: v, u, o, rRel, vRel };
        }

        let fA = fOfT(tA);
        let fB = fOfT(tB);

        // Circuit breaker: skip if NaN endpoints
        if (isNaN(fA.val) || isNaN(fB.val)) continue;

        let bestTCA = (tA + tB) / 2;
        let bestUser = null, bestObj = null, bestRRel = null, bestVRel = null;

        if (fA.val * fB.val > 0) {
          let minDist = Infinity;
          const samples = 20;
          for (let i = 0; i <= samples; i++) {
            const tSample = tA + (tB - tA) * (i / samples);
            const ev = fOfT(tSample);
            if (ev.u && ev.o) {
              const d = eciDist(ev.u.pos, ev.o.pos);
              if (d < minDist) {
                minDist = d;
                bestTCA = tSample;
                bestUser = ev.u;
                bestObj = ev.o;
                bestRRel = ev.rRel;
                bestVRel = ev.vRel;
              }
            }
          }
        } else {
          // Standard bisection with iteration cap
          let bisectIters = 0;
          while (tB - tA > BISECT_TOLERANCE && bisectIters++ < 50) {
            const tMid = (tA + tB) / 2;
            const fMid = fOfT(tMid);
            if (isNaN(fMid.val)) break; // NaN guard

            if (fA.val * fMid.val <= 0) {
              tB = tMid;
              fB = fMid;
            } else {
              tA = tMid;
              fA = fMid;
            }
          }

          bestTCA = (tA + tB) / 2;
          const ev = fOfT(bestTCA);
          bestUser = ev.u;
          bestObj = ev.o;
          bestRRel = ev.rRel;
          bestVRel = ev.vRel;
        }

        if (bestUser && bestObj) {
          const missDistance = eciDist(bestUser.pos, bestObj.pos);
          const vRelMag = Math.sqrt(bestVRel.x ** 2 + bestVRel.y ** 2 + bestVRel.z ** 2);
          tcaResults.push({
            candidate,
            tca: new Date(bestTCA),
            miss_distance_km: missDistance,
            relative_velocity_kms: vRelMag,
            position1_ECI: { x: bestUser.pos.x, y: bestUser.pos.y, z: bestUser.pos.z },
            position2_ECI: { x: bestObj.pos.x, y: bestObj.pos.y, z: bestObj.pos.z },
            velocity1_ECI: { x: bestUser.vel.x, y: bestUser.vel.y, z: bestUser.vel.z },
            vRel_ECI: { x: bestVRel.x, y: bestVRel.y, z: bestVRel.z },
          });
        }

        // Progress
        if (w % 5 === 0 || w === windowList.length - 1) {
          self.postMessage({
            type: "conjunctionProgress",
            payload: { stage: 3, pct: Math.round(((w + 1) / windowList.length) * 100), msg: `Refined ${w + 1}/${windowList.length} windows` },
          });
        }
      }

      // ══════════════════════════════════════════════════════════════
      // STAGE 4 — Risk Scoring
      // ══════════════════════════════════════════════════════════════
      self.postMessage({ type: "conjunctionProgress", payload: { stage: 4, pct: 0, msg: "Computing risk scores…" } });

      const results = [];

      for (let i = 0; i < tcaResults.length; i++) {
        const r = tcaResults[i];
        const cand = r.candidate;

        results.push(computeRiskMetrics({
          tcaResult: r,
          catalogName: cand.name,
          catalogTLE1: cand.tle1,
          catalogTLE2: cand.tle2,
          userRadius,
          index: i,
          idPrefix: "conj",
        }));
      }

      self.postMessage({ type: "conjunctionProgress", payload: { stage: 4, pct: 100, msg: `Scored ${results.length} conjunctions` } });

      // ══════════════════════════════════════════════════════════════
      // STAGE 5 — Sort & Post Results
      // ══════════════════════════════════════════════════════════════
      results.sort((a, b) => b.pc_upper_bound - a.pc_upper_bound);

      const elapsed_ms = Math.round(performance.now() - t0);
      self.postMessage({
        type: "conjunctionProgress",
        payload: { stage: 5, pct: 100, msg: `Complete — ${results.length} conjunctions in ${(elapsed_ms / 1000).toFixed(1)}s` },
      });
      self.postMessage({
        type: "conjunctionResult",
        payload: { results, elapsed_ms },
      });

    } catch (err) {
      self.postMessage({
        type: "conjunctionError",
        payload: { error: err.message || String(err) },
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * findSaferSlots — Stages 1, 1.5, & 2 (with Ephemeris Memory Cache)
   *   Stage 3 is dispatched to a worker pool via separate messages.
   * ═══════════════════════════════════════════════════════════════════ */
  if (type === "findSaferSlots") {
    const t0 = performance.now();
    try {
      const { targetOrbit, catalog, orbitParamLocks, safeSlotConfig, userRadius = 1.0, missionEpoch: missionEpochISO } = payload;
      const missionEpoch = missionEpochISO ? new Date(missionEpochISO) : new Date();

      const MU = 398600.4418;
      const R_EARTH = 6371;
      const COARSE_THRESHOLD = 50;
      const CANDIDATE_COUNT = 200;
      const SGP4_SURVIVORS = 50;

      // Ephemeris cache constants
      const CACHE_INTERVAL = 120;  // 2-minute resolution (seconds)
      const CACHE_DAYS = 7;
      const CACHE_STEPS = CACHE_DAYS * 24 * 60 / (CACHE_INTERVAL / 60); // 5040
      const FLOATS_PER_ENTRY = 3;  // x, y, z (position only)

      const TOLERANCE_MAP = {
        altitude:     { storeKey: "altTolerance",          min: 160,  max: 35786 },
        inclination:  { storeKey: "inclTolerance",         min: 0,    max: 180   },
        eccentricity: { storeKey: "eccentricityTolerance", min: 0,    max: 0.99  },
        raan:         { storeKey: "raanTolerance",         min: 0,    max: 360   },
        argPerigee:   { storeKey: "argPerigeeTolerance",   min: 0,    max: 360   },
        meanAnomaly:  { storeKey: "meanAnomalyTolerance",  min: 0,    max: 360   },
      };

      const unlockedParams = Object.keys(TOLERANCE_MAP).filter((k) => !orbitParamLocks[k]);

      if (unlockedParams.length === 0) {
        self.postMessage({ type: "safeSlotError", payload: { error: "All orbital parameters are locked. Unlock at least one parameter to search for safer slots." } });
        return;
      }

      /* ── Helpers ────────────────────────────────────────────────── */
      function buildSyntheticTLE(params, epoch = null) {
        const a = R_EARTH + params.altitude;
        const n_rad_s = Math.sqrt(MU / (a * a * a));
        const n_rev_day = n_rad_s * 86400 / (2 * Math.PI);
        const now = epoch || missionEpoch;  // Default to the user's mission epoch, never new Date()
        const yr2 = String(now.getUTCFullYear()).slice(-2);
        const jan1 = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        const dayOfYear = (now - jan1) / 86400000 + 1;
        const epochStr = `${yr2}${dayOfYear.toFixed(8).padStart(12, " ")}`;
        const inc = params.inclination.toFixed(4).padStart(8);
        const raanStr = params.raan.toFixed(4).padStart(8);
        const eccStr = params.eccentricity.toFixed(7).replace("0.", "").padStart(7, "0");
        const argP = params.argPerigee.toFixed(4).padStart(8);
        const mAnomaly = params.meanAnomaly.toFixed(4).padStart(8);
        const mmStr = n_rev_day.toFixed(8).padStart(11);
        const tle1 = `1 99999U 25001A   ${epochStr}  .00000000  00000-0  00000-0 0  9990`;
        const tle2 = `2 99999 ${inc} ${raanStr} ${eccStr} ${argP} ${mAnomaly} ${mmStr}    10`;
        return { tle1, tle2 };
      }
      function orbitalParams(satrec) {
        const n_rad_s = satrec.no / 60;
        const a = Math.pow(MU / (n_rad_s * n_rad_s), 1 / 3);
        const e = satrec.ecco;
        return { a, perigee: a * (1 - e) - R_EARTH, apogee: a * (1 + e) - R_EARTH, incl_deg: satrec.inclo * (180 / Math.PI) };
      }
      function propagateECI(satrec, date) {
        const pv = satellite.propagate(satrec, date);
        if (!pv || !pv.position || pv.position === false) return null;
        return { pos: pv.position, vel: pv.velocity };
      }
      function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      }
      function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

      // ════════════════════════════════════════════════════════════
      // STAGE 1 — Generate Candidates via LHS
      // ════════════════════════════════════════════════════════════
      self.postMessage({ type: "safeSlotProgress", payload: { stage: 1, pct: 0, msg: "Generating candidate orbits using Latin Hypercube Sampling..." } });

      const lhsPermutations = {};
      for (const paramKey of unlockedParams) {
        const indices = Array.from({ length: CANDIDATE_COUNT }, (_, i) => i);
        lhsPermutations[paramKey] = shuffleArray(indices);
      }

      const candidates = [];
      for (let i = 0; i < CANDIDATE_COUNT; i++) {
        const params = { ...targetOrbit };
        for (const paramKey of unlockedParams) {
          const tm = TOLERANCE_MAP[paramKey];
          const tolerance = safeSlotConfig[tm.storeKey] || 0;
          const base = targetOrbit[paramKey];
          const lo = Math.max(base - tolerance, tm.min);
          const hi = Math.min(base + tolerance, tm.max);
          const binSize = (hi - lo) / CANDIDATE_COUNT;
          const binIndex = lhsPermutations[paramKey][i];
          const binLo = lo + binIndex * binSize;
          params[paramKey] = clamp(binLo + Math.random() * binSize, tm.min, tm.max);
        }
        const tle = buildSyntheticTLE(params);
        const satrec = parseTLE(tle.tle1, tle.tle2);
        if (satrec) {
          candidates.push({ orbitParams: params, tle1: tle.tle1, tle2: tle.tle2, satrec });
        }
      }

      const baselineTLE = buildSyntheticTLE(targetOrbit);
      const baselineSatrec = parseTLE(baselineTLE.tle1, baselineTLE.tle2);

      self.postMessage({ type: "safeSlotProgress", payload: { stage: 1, pct: 50, msg: `Generated ${candidates.length} candidate orbits — parsing catalog...` } });

      // ── Parse full catalog once ──────────────────────────────
      const catalogRecs = [];
      for (const obj of catalog) {
        const rec = parseTLE(obj.tle1, obj.tle2);
        if (rec) {
          catalogRecs.push({ ...obj, satrec: rec, orbParams: orbitalParams(rec) });
        }
      }

      // ── Super-Hoots Envelope ─────────────────────────────────
      const allCandOrbParams = candidates.map((c) => orbitalParams(c.satrec));
      const baselineOrbParams = baselineSatrec ? orbitalParams(baselineSatrec) : null;

      let envelopeMinPerigee = Infinity;
      let envelopeMaxApogee = -Infinity;
      let envelopeMinIncl = Infinity;
      let envelopeMaxIncl = -Infinity;

      for (const op of allCandOrbParams) {
        if (op.perigee < envelopeMinPerigee) envelopeMinPerigee = op.perigee;
        if (op.apogee > envelopeMaxApogee) envelopeMaxApogee = op.apogee;
        if (op.incl_deg < envelopeMinIncl) envelopeMinIncl = op.incl_deg;
        if (op.incl_deg > envelopeMaxIncl) envelopeMaxIncl = op.incl_deg;
      }
      if (baselineOrbParams) {
        if (baselineOrbParams.perigee < envelopeMinPerigee) envelopeMinPerigee = baselineOrbParams.perigee;
        if (baselineOrbParams.apogee > envelopeMaxApogee) envelopeMaxApogee = baselineOrbParams.apogee;
        if (baselineOrbParams.incl_deg < envelopeMinIncl) envelopeMinIncl = baselineOrbParams.incl_deg;
        if (baselineOrbParams.incl_deg > envelopeMaxIncl) envelopeMaxIncl = baselineOrbParams.incl_deg;
      }
      envelopeMinPerigee -= 75;
      envelopeMaxApogee += 75;

      const threatNeighborhood = [];
      for (const cat of catalogRecs) {
        if (cat.orbParams.apogee < envelopeMinPerigee) continue;
        if (cat.orbParams.perigee > envelopeMaxApogee) continue;
        const catIncl = cat.orbParams.incl_deg;
        const inclMargin = 15;
        if (catIncl < envelopeMinIncl - inclMargin || catIncl > envelopeMaxIncl + inclMargin) continue;
        threatNeighborhood.push(cat);
      }

      self.postMessage({ type: "safeSlotProgress", payload: { stage: 1, pct: 100, msg: `Super-Hoots: ${threatNeighborhood.length} threats from ${catalogRecs.length} catalog objects` } });

      // ════════════════════════════════════════════════════════════
      // STAGE 1.5 — Build Ephemeris Memory Cache
      // ════════════════════════════════════════════════════════════
      let N_THREATS = threatNeighborhood.length;
      const MAX_CACHE_MB = 200; // Memory cap for the ephemeris cache

      // Check if cache would exceed memory cap; if so, increase interval or cap threats
      let cacheInterval = CACHE_INTERVAL;
      let cacheSteps = CACHE_STEPS;
      let rawCacheMB = N_THREATS * cacheSteps * FLOATS_PER_ENTRY * 8 / (1024 * 1024);

      if (rawCacheMB > MAX_CACHE_MB) {
        // Strategy 1: reduce resolution to 4-minute intervals
        cacheInterval = 240;
        cacheSteps = CACHE_DAYS * 24 * 60 / (cacheInterval / 60); // 2520
        rawCacheMB = N_THREATS * cacheSteps * FLOATS_PER_ENTRY * 8 / (1024 * 1024);
      }
      if (rawCacheMB > MAX_CACHE_MB && N_THREATS > 1000) {
        // Strategy 2: cap threat neighborhood to fit within memory budget
        const maxThreats = Math.floor(MAX_CACHE_MB * 1024 * 1024 / (cacheSteps * FLOATS_PER_ENTRY * 8));
        // Sort threats by altitude proximity to the envelope center
        const envelopeCenterAlt = (envelopeMinPerigee + envelopeMaxApogee) / 2;
        threatNeighborhood.sort((a, b) => {
          const aCenter = (a.orbParams.perigee + a.orbParams.apogee) / 2;
          const bCenter = (b.orbParams.perigee + b.orbParams.apogee) / 2;
          return Math.abs(aCenter - envelopeCenterAlt) - Math.abs(bCenter - envelopeCenterAlt);
        });
        threatNeighborhood.length = maxThreats;
        N_THREATS = threatNeighborhood.length;
        rawCacheMB = N_THREATS * cacheSteps * FLOATS_PER_ENTRY * 8 / (1024 * 1024);
      }

      const sabByteLength = N_THREATS * cacheSteps * FLOATS_PER_ENTRY * Float64Array.BYTES_PER_ELEMENT;
      const memMB = (sabByteLength / (1024 * 1024)).toFixed(1);

      self.postMessage({
        type: "safeSlotProgress",
        payload: { stage: 2, pct: 0, msg: `Building ephemeris cache: ${N_THREATS} threats x ${cacheSteps} steps (${memMB} MB)...` },
      });

      const start = missionEpoch;  // Anchor cache to the user's mission epoch

      // Allocate SharedArrayBuffer (or fallback to regular ArrayBuffer if SAB unavailable)
      // CRITICAL: Check crossOriginIsolated — SAB may construct inside a worker but fail
      // on postMessage transfer if the page lacks proper COOP/COEP headers.
      let sab;
      let usingSAB = false;
      const sabSupported = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true;
      if (sabSupported) {
        try {
          sab = new SharedArrayBuffer(sabByteLength);
          usingSAB = true;
        } catch (_e) {
          sab = new ArrayBuffer(sabByteLength);
          usingSAB = false;
        }
      } else {
        // SharedArrayBuffer not available (missing COOP/COEP headers or insecure context)
        // Fall back to regular ArrayBuffer — will be structured-cloned (copied) per worker
        sab = new ArrayBuffer(sabByteLength);
        usingSAB = false;
      }
      const ephemeris = new Float64Array(sab);

      // Build threat index map: catalog name -> integer index into the ephemeris array
      // This is the critical mapping that pool workers use to read the correct threat's coordinates
      const threatNames = [];
      const threatTLE1s = [];
      const threatTLE2s = [];
      const threatOrbParams = []; // perigee/apogee/incl for each threat (for per-candidate Hoots in pool)

      for (let t = 0; t < N_THREATS; t++) {
        const th = threatNeighborhood[t];
        threatNames.push(th.name);
        threatTLE1s.push(th.tle1);
        threatTLE2s.push(th.tle2);
        threatOrbParams.push(th.orbParams);
      }

      // Propagate all threats across the 7-day grid
      for (let t = 0; t < N_THREATS; t++) {
        const satrec = threatNeighborhood[t].satrec;
        for (let s = 0; s < cacheSteps; s++) {
          const date = new Date(start.getTime() + s * cacheInterval * 1000);
          const pv = satellite.propagate(satrec, date);
          const baseIdx = (t * cacheSteps + s) * FLOATS_PER_ENTRY;
          if (pv && pv.position && pv.position !== false) {
            ephemeris[baseIdx]     = pv.position.x;
            ephemeris[baseIdx + 1] = pv.position.y;
            ephemeris[baseIdx + 2] = pv.position.z;
          } else {
            ephemeris[baseIdx] = NaN; // mark invalid — workers check for this
            ephemeris[baseIdx + 1] = NaN;
            ephemeris[baseIdx + 2] = NaN;
          }
        }

        if ((t + 1) % 20 === 0 || t === N_THREATS - 1) {
          self.postMessage({
            type: "safeSlotProgress",
            payload: { stage: 2, pct: Math.round(((t + 1) / N_THREATS) * 30), msg: `Ephemeris cache: ${t + 1}/${N_THREATS} threats propagated (7 days, 2-min grid)` },
          });
        }
      }

      const cacheElapsed = Math.round(performance.now() - t0);
      self.postMessage({
        type: "safeSlotProgress",
        payload: { stage: 2, pct: 30, msg: `Cache built in ${(cacheElapsed / 1000).toFixed(1)}s — screening ${SGP4_SURVIVORS} candidates...` },
      });

      // ════════════════════════════════════════════════════════════
      // STAGE 2 — Cache-Accelerated Heuristic Screening
      // ════════════════════════════════════════════════════════════

      // Micro-Hoots: score each candidate using orbital params (no SGP4 — pure math)
      for (let i = 0; i < candidates.length; i++) {
        const cp = allCandOrbParams[i];
        let threatCount = 0;
        for (let t = 0; t < N_THREATS; t++) {
          const tp = threatOrbParams[t];
          if (tp.apogee < cp.perigee - 75) continue;
          if (tp.perigee > cp.apogee + 75) continue;
          const inclDiff = Math.abs(tp.incl_deg - cp.incl_deg);
          if (inclDiff > 180 - cp.incl_deg) continue;
          threatCount++;
        }
        candidates[i].threatCount = threatCount;
        candidates[i].coarseMinDist = 9999;
        candidates[i].closeApproachCount = 0;
        candidates[i].heuristicScore = threatCount;
      }

      // Sort + cull to top 50
      candidates.sort((a, b) => a.threatCount - b.threatCount);
      const sgp4Candidates = candidates.slice(0, SGP4_SURVIVORS);
      const culledCandidates = candidates.slice(SGP4_SURVIVORS);

      // Stage 2 coarse pass: SGP4 on candidates ONLY, threats read from cache
      // Stage 2 uses every 3rd cache entry = 6-minute effective interval
      const STAGE2_CACHE_SKIP = 3;    // read every 3rd cache step
      // 1-day span: 1440min / (cacheInterval/60) = cache steps for 1 day
      const ONE_DAY_CACHE_STEPS = Math.min(Math.floor(1440 / (cacheInterval / 60)), cacheSteps);

      for (let i = 0; i < sgp4Candidates.length; i++) {
        const cand = sgp4Candidates[i];
        const cp = orbitalParams(cand.satrec);

        // Build this candidate's threat index list from the neighborhood
        const candThreatIndices = [];
        for (let t = 0; t < N_THREATS; t++) {
          const tp = threatOrbParams[t];
          if (tp.apogee < cp.perigee - 75) continue;
          if (tp.perigee > cp.apogee + 75) continue;
          const inclDiff = Math.abs(tp.incl_deg - cp.incl_deg);
          if (inclDiff > 180 - cp.incl_deg) continue;
          candThreatIndices.push(t);
        }

        let coarseMinDist = Infinity;
        let closeApproachCount = 0;

        if (candThreatIndices.length > 0) {
          // Walk through 1-day of cache at 6-min intervals (every 3rd cache step)
          for (let cacheStep = 0; cacheStep < ONE_DAY_CACHE_STEPS; cacheStep += STAGE2_CACHE_SKIP) {
            const t = new Date(start.getTime() + cacheStep * cacheInterval * 1000);
            const candECI = propagateECI(cand.satrec, t);
            if (!candECI) continue;
            const cx = candECI.pos.x, cy = candECI.pos.y, cz = candECI.pos.z;

            for (const ti of candThreatIndices) {
              const baseIdx = (ti * cacheSteps + cacheStep) * FLOATS_PER_ENTRY;
              const tx = ephemeris[baseIdx];
              if (tx !== tx) continue; // NaN check (faster than isNaN)
              const ty = ephemeris[baseIdx + 1];
              const tz = ephemeris[baseIdx + 2];
              const dx = cx - tx, dy = cy - ty, dz = cz - tz;
              const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (dist < coarseMinDist) coarseMinDist = dist;
              if (dist < COARSE_THRESHOLD) closeApproachCount++;
            }
          }
        }
        if (coarseMinDist === Infinity) coarseMinDist = 9999;
        cand.coarseMinDist = coarseMinDist;
        cand.closeApproachCount = closeApproachCount;
        cand.heuristicScore = closeApproachCount * 50 + (1 / (coarseMinDist + 0.001));

        if ((i + 1) % 5 === 0 || i === sgp4Candidates.length - 1) {
          self.postMessage({
            type: "safeSlotProgress",
            payload: { stage: 2, pct: 30 + Math.round(((i + 1) / sgp4Candidates.length) * 60), msg: `Cache-accelerated screening: ${i + 1}/${sgp4Candidates.length} candidates` },
          });
        }
      }

      // Sort by heuristic score + variance-based finalist selection
      sgp4Candidates.sort((a, b) => a.heuristicScore - b.heuristicScore);

      let finalistCount;
      if (sgp4Candidates.length < 5) {
        finalistCount = sgp4Candidates.length;
      } else {
        const bestScore = sgp4Candidates[0].heuristicScore;
        const score6 = sgp4Candidates.length >= 6 ? sgp4Candidates[5].heuristicScore : Infinity;
        if (bestScore === 0 || (score6 - bestScore) / (bestScore + 0.001) > 0.20) {
          finalistCount = 5;
        } else {
          finalistCount = Math.min(10, sgp4Candidates.length);
        }
      }

      // Build scatter plot data
      const allForPlot = [
        ...sgp4Candidates.map((c, i) => ({
          orbitParams: c.orbitParams, threatCount: c.threatCount,
          coarseMinDist: c.coarseMinDist, closeApproachCount: c.closeApproachCount,
          heuristicScore: c.heuristicScore, isFinalist: i < finalistCount,
        })),
        ...culledCandidates.map((c) => ({
          orbitParams: c.orbitParams, threatCount: c.threatCount,
          coarseMinDist: c.coarseMinDist, closeApproachCount: c.closeApproachCount,
          heuristicScore: c.heuristicScore, isFinalist: false,
        })),
      ];

      const finalists = sgp4Candidates.slice(0, finalistCount);

      self.postMessage({
        type: "safeSlotProgress",
        payload: { stage: 2, pct: 100, msg: `Selected top ${finalistCount} finalists — handing off to worker pool...` },
      });

      // ── Emit Stage 2 results with the SharedArrayBuffer ────
      self.postMessage({
        type: "safeSlotStage2Complete",
        payload: {
          finalists: finalists.map((f) => ({ orbitParams: f.orbitParams, tle1: f.tle1, tle2: f.tle2 })),
          allCandidates: allForPlot,
          finalistCount,
          targetOrbit,
          userRadius,
          startTime: start.toISOString(),
          elapsed_stage12_ms: Math.round(performance.now() - t0),
          // Ephemeris cache
          ephemerisSAB: sab,             // SharedArrayBuffer (zero-copy) or ArrayBuffer (copied)
          usingSAB,
          cacheSteps,
          cacheInterval,
          threatCount: N_THREATS,
          threatNames,
          threatTLE1s,
          threatTLE2s,
          threatOrbParams,               // { perigee, apogee, incl_deg } per threat
        },
      });

    } catch (err) {
      self.postMessage({
        type: "safeSlotError",
        payload: { error: err.message || String(err) },
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * runFullPipeline — Stage 3 individual finalist analysis
   *   Uses Ephemeris Memory Cache for threat positions (zero SGP4 on threats in coarse pass).
   *   TCA bisection still uses live SGP4 (needs velocity + arbitrary timestamps).
   * ═══════════════════════════════════════════════════════════════════ */
  if (type === "runFullPipeline") {
    try {
      const {
        finalistIndex, orbitParams: fParams, tle1, tle2,
        userRadius = 1.0, startTime, targetOrbit,
        // Ephemeris cache
        ephemerisSAB, cacheSteps, cacheInterval,
        threatCount: N_THREATS, threatNames, threatTLE1s, threatTLE2s, threatOrbParams,
      } = payload;

      const MU = 398600.4418;
      const R_EARTH = 6371;
      const COARSE_THRESHOLD = 50;
      const FLOATS_PER_ENTRY = 3;

      function orbitalParams(satrec) {
        const n_rad_s = satrec.no / 60;
        const a = Math.pow(MU / (n_rad_s * n_rad_s), 1 / 3);
        const e = satrec.ecco;
        return { a, perigee: a * (1 - e) - R_EARTH, apogee: a * (1 + e) - R_EARTH, incl_deg: satrec.inclo * (180 / Math.PI) };
      }
      function propagateECI(satrec, date) {
        const pv = satellite.propagate(satrec, date);
        if (!pv || !pv.position || pv.position === false) return null;
        return { pos: pv.position, vel: pv.velocity };
      }
      function eciDist(a, b) {
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

      const candSatrec = parseTLE(tle1, tle2);
      if (!candSatrec) {
        self.postMessage({ type: "pipelineResult", payload: { finalistIndex, error: "Failed to parse finalist TLE" } });
        return;
      }

      const candParams = orbitalParams(candSatrec);

      // Create Float64Array view on the ephemeris cache (zero-copy if SAB)
      const ephemeris = new Float64Array(ephemerisSAB);

      // Stage A: Hoots filter — identify which threats are relevant to THIS candidate
      // Returns indices into the ephemeris cache
      const conjThreatIndices = [];
      for (let t = 0; t < N_THREATS; t++) {
        const tp = threatOrbParams[t];
        if (tp.apogee < candParams.perigee - 75) continue;
        if (tp.perigee > candParams.apogee + 75) continue;
        const inclDiff = Math.abs(tp.incl_deg - candParams.incl_deg);
        if (inclDiff > 180 - candParams.incl_deg) continue;
        conjThreatIndices.push(t);
      }

      if (conjThreatIndices.length === 0) {
        self.postMessage({
          type: "pipelineResult",
          payload: { finalistIndex, orbitParams: fParams, totalConjunctions: 0, worstPc: 0, minMissDistance: 9999, avgMissDistance: 9999, conjunctionDetails: [] },
        });
        return;
      }

      // Stage B: 7-day coarse pass — SGP4 ONLY on candidate, threats from cache
      const start = new Date(startTime);
      const totalCacheSteps = cacheSteps; // 5040
      const candState = new Array(conjThreatIndices.length);
      for (let c = 0; c < conjThreatIndices.length; c++) {
        candState[c] = { windows: [], inWindow: false, wStart: null };
      }

      for (let step = 0; step < totalCacheSteps; step++) {
        const t = new Date(start.getTime() + step * cacheInterval * 1000);
        const userECI = propagateECI(candSatrec, t);
        if (!userECI) continue;
        const cx = userECI.pos.x, cy = userECI.pos.y, cz = userECI.pos.z;

        for (let c = 0; c < conjThreatIndices.length; c++) {
          const ti = conjThreatIndices[c];
          const baseIdx = (ti * totalCacheSteps + step) * FLOATS_PER_ENTRY;
          const tx = ephemeris[baseIdx];
          if (tx !== tx) continue; // NaN check
          const ty = ephemeris[baseIdx + 1];
          const tz = ephemeris[baseIdx + 2];
          const dx = cx - tx, dy = cy - ty, dz = cz - tz;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          const cs = candState[c];
          if (dist < COARSE_THRESHOLD) {
            if (!cs.inWindow) { cs.inWindow = true; cs.wStart = t; }
          } else if (cs.inWindow) {
            cs.windows.push({ start: cs.wStart, end: t, threatIdx: ti });
            cs.inWindow = false;
          }
        }
      }

      // Close open windows
      const endTime = new Date(start.getTime() + (totalCacheSteps - 1) * cacheInterval * 1000);
      for (let c = 0; c < conjThreatIndices.length; c++) {
        if (candState[c].inWindow) {
          candState[c].windows.push({ start: candState[c].wStart, end: endTime, threatIdx: conjThreatIndices[c] });
        }
      }

      // Collect all windows
      const windowList = [];
      for (let c = 0; c < conjThreatIndices.length; c++) {
        for (const w of candState[c].windows) {
          windowList.push(w);
        }
      }

      if (windowList.length === 0) {
        self.postMessage({
          type: "pipelineResult",
          payload: { finalistIndex, orbitParams: fParams, totalConjunctions: 0, worstPc: 0, minMissDistance: 9999, avgMissDistance: 9999, conjunctionDetails: [] },
        });
        return;
      }

      // Stage C: TCA bisection — live SGP4 on BOTH candidate and threat (needs velocity + arbitrary timestamps)
      // Parse threat satrecs only for the threats that have windows (lazy, once per worker)
      const threatSatrecCache = {};
      function getThreatSatrec(threatIdx) {
        if (threatSatrecCache[threatIdx]) return threatSatrecCache[threatIdx];
        const rec = parseTLE(threatTLE1s[threatIdx], threatTLE2s[threatIdx]);
        threatSatrecCache[threatIdx] = rec;
        return rec;
      }

      const BISECT_TOLERANCE = 1000;
      const tcaResults = [];
      for (const wItem of windowList) {
        const threatSatrec = getThreatSatrec(wItem.threatIdx);
        if (!threatSatrec) continue;

        let tA = wItem.start.getTime();
        let tB = wItem.end.getTime();

        const fOfT = (tMs) => {
          const d = new Date(tMs);
          const u = propagateECI(candSatrec, d);
          const o = propagateECI(threatSatrec, d);
          if (!u || !o) return { val: NaN, u: null, o: null };
          const rRel = { x: o.pos.x - u.pos.x, y: o.pos.y - u.pos.y, z: o.pos.z - u.pos.z };
          const vRel = { x: o.vel.x - u.vel.x, y: o.vel.y - u.vel.y, z: o.vel.z - u.vel.z };
          const v = dot(rRel, vRel);
          if (!isFinite(v)) return { val: NaN, u: null, o: null };
          return { val: v, u, o, rRel, vRel };
        };

        let fA = fOfT(tA);
        let fB = fOfT(tB);
        // Circuit breaker: skip if NaN endpoints
        if (isNaN(fA.val) || isNaN(fB.val)) continue;
        let bestTCA = (tA + tB) / 2;
        let bestUser = null, bestObj = null, bestVRel = null;

        if (fA.val * fB.val > 0) {
          let minDist = Infinity;
          for (let s = 0; s <= 20; s++) {
            const tSample = tA + (tB - tA) * (s / 20);
            const ev = fOfT(tSample);
            if (ev.u && ev.o) {
              const d = eciDist(ev.u.pos, ev.o.pos);
              if (d < minDist) { minDist = d; bestTCA = tSample; bestUser = ev.u; bestObj = ev.o; bestVRel = ev.vRel; }
            }
          }
        } else {
          let bisectIters = 0;
          while (tB - tA > BISECT_TOLERANCE && bisectIters++ < 50) {
            const tMid = (tA + tB) / 2;
            const fMid = fOfT(tMid);
            if (isNaN(fMid.val)) break;
            if (fA.val * fMid.val <= 0) { tB = tMid; fB = fMid; }
            else { tA = tMid; fA = fMid; }
          }
          bestTCA = (tA + tB) / 2;
          const ev = fOfT(bestTCA);
          bestUser = ev.u; bestObj = ev.o; bestVRel = ev.vRel;
        }

        if (bestUser && bestObj) {
          const missDistance = eciDist(bestUser.pos, bestObj.pos);
          const vRelMag = bestVRel ? Math.sqrt(bestVRel.x ** 2 + bestVRel.y ** 2 + bestVRel.z ** 2) : 0;
          tcaResults.push({
            catalogName: threatNames[wItem.threatIdx],
            threatIdx: wItem.threatIdx,
            tca: new Date(bestTCA),
            miss_distance_km: missDistance,
            relative_velocity_kms: vRelMag,
            position1_ECI: { x: bestUser.pos.x, y: bestUser.pos.y, z: bestUser.pos.z },
            position2_ECI: { x: bestObj.pos.x, y: bestObj.pos.y, z: bestObj.pos.z },
            velocity1_ECI: { x: bestUser.vel.x, y: bestUser.vel.y, z: bestUser.vel.z },
            vRel_ECI: bestVRel ? { x: bestVRel.x, y: bestVRel.y, z: bestVRel.z } : null,
          });
        }
      }

      // Stage D: Unified risk scoring — uses shared computeRiskMetrics (same formula as main engine)
      const conjunctions = [];
      for (let i = 0; i < tcaResults.length; i++) {
        const r = tcaResults[i];
        const threatTLE1 = threatTLE1s?.[r.threatIdx] || "";
        const threatTLE2 = threatTLE2s?.[r.threatIdx] || "";

        const scored = computeRiskMetrics({
          tcaResult: r,
          catalogName: r.catalogName,
          catalogTLE1: threatTLE1,
          catalogTLE2: threatTLE2,
          userRadius,
          index: i,
          idPrefix: `ss-conj-${finalistIndex}`,
        });

        // Attach the primary (candidate) satellite's canonical TLE for B-plane arc rendering
        scored.primaryTLE1 = tle1;
        scored.primaryTLE2 = tle2;

        conjunctions.push(scored);
      }
      conjunctions.sort((a, b) => b.pc_upper_bound - a.pc_upper_bound);

      const totalConj = conjunctions.length;
      const worstPc = totalConj > 0 ? conjunctions[0].pc_upper_bound : 0;
      const minMiss = totalConj > 0 ? Math.min(...conjunctions.map((c) => c.miss_distance_km)) : 9999;
      const avgMiss = totalConj > 0 ? conjunctions.reduce((s, c) => s + c.miss_distance_km, 0) / totalConj : 9999;

      self.postMessage({
        type: "pipelineResult",
        payload: {
          finalistIndex,
          orbitParams: fParams,
          totalConjunctions: totalConj,
          worstPc,
          minMissDistance: minMiss,
          avgMissDistance: avgMiss,
          conjunctionDetails: conjunctions.slice(0, 20),
          tle1,   // candidate's canonical TLE — needed by Apply to Mission
          tle2,
        },
      });

    } catch (err) {
      self.postMessage({
        type: "pipelineResult",
        payload: { finalistIndex: payload?.finalistIndex ?? -1, error: err.message || String(err) },
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * calculateContacts — Cache-Accelerated AOS/LOS Contact Window Engine
   *
   * 5-stage pipeline:
   *   Stage 0: Latitude-band pre-filter (skip unreachable stations)
   *   Stage 1: Build single-object ephemeris cache (Float64Array)
   *   Stage 2: Cache-accelerated coarse elevation scan
   *   Stage 3: Precise AOS/LOS via bisection (1ms precision)
   *   Stage 4: Golden-section search for max elevation
   *   Stage 5: Assemble & post results
   *
   * Performance target: <500ms for 7-day window × 10 stations
   * ═══════════════════════════════════════════════════════════════════ */
  if (type === "calculateContacts") {
    const t0 = performance.now();
    try {
      const { target, stations, startTime, durationHours = 24 } = payload;

      const DEG2RAD = Math.PI / 180;
      const RAD2DEG = 180 / Math.PI;
      const R_EARTH = 6371; // km

      // ── Parse target TLE ─────────────────────────────────────────
      const satrec = parseTLE(target.tle1, target.tle2);
      if (!satrec) {
        self.postMessage({ type: "contactError", payload: { error: "Failed to parse target satellite TLE" } });
        return;
      }

      // Extract orbital parameters for latitude-band filter
      const n_rad_s = satrec.no / 60;
      const sma = Math.pow(398600.4418 / (n_rad_s * n_rad_s), 1 / 3);
      const ecc = satrec.ecco;
      const satAlt = sma * (1 + ecc) - R_EARTH; // apogee altitude for max visibility
      const inclDeg = satrec.inclo * RAD2DEG;

      // ════════════════════════════════════════════════════════════════
      // STAGE 0 — Latitude-Band Pre-Filter
      // ════════════════════════════════════════════════════════════════
      self.postMessage({ type: "contactProgress", payload: { stage: 0, pct: 0, msg: "Filtering ground stations by orbital geometry..." } });

      const maxEarthAngle = Math.acos(R_EARTH / (R_EARTH + satAlt)) * RAD2DEG;
      const maxReachableLat = Math.min(inclDeg + maxEarthAngle + 2, 90); // +2° safety margin

      const activeStations = stations.filter(s => Math.abs(s.lat) <= maxReachableLat);

      if (activeStations.length === 0) {
        self.postMessage({ type: "contactResult", payload: { contacts: [], elapsed_ms: Math.round(performance.now() - t0) } });
        return;
      }

      self.postMessage({ type: "contactProgress", payload: { stage: 0, pct: 100, msg: `${activeStations.length}/${stations.length} stations reachable (incl ${inclDeg.toFixed(1)}°, max lat ±${maxReachableLat.toFixed(1)}°)` } });

      // Pre-compute station geodetic coordinates in radians (they never change)
      const stationGd = activeStations.map(s => ({
        longitude: s.lon * DEG2RAD,
        latitude:  s.lat * DEG2RAD,
        height:    s.alt, // km above sea level
      }));

      // ════════════════════════════════════════════════════════════════
      // STAGE 1 — Build Single-Object Ephemeris Cache
      // ════════════════════════════════════════════════════════════════
      const CACHE_INTERVAL = 30; // seconds
      const durationSeconds = durationHours * 3600;
      const CACHE_STEPS = Math.ceil(durationSeconds / CACHE_INTERVAL) + 1;
      const start = new Date(startTime);

      self.postMessage({ type: "contactProgress", payload: { stage: 1, pct: 0, msg: `Building ephemeris cache: ${CACHE_STEPS} steps at ${CACHE_INTERVAL}s intervals (${(CACHE_STEPS * 3 * 8 / 1024).toFixed(0)} KB)...` } });

      // Allocate flat caches
      const eciCache = new Float64Array(CACHE_STEPS * 3); // x, y, z per step
      const gmstCache = new Float64Array(CACHE_STEPS);

      // Propagate satellite once into cache
      for (let s = 0; s < CACHE_STEPS; s++) {
        const dateMs = start.getTime() + s * CACHE_INTERVAL * 1000;
        const date = new Date(dateMs);
        const pv = satellite.propagate(satrec, date);
        const idx = s * 3;

        if (pv && pv.position && pv.position !== false) {
          eciCache[idx]     = pv.position.x;
          eciCache[idx + 1] = pv.position.y;
          eciCache[idx + 2] = pv.position.z;
        } else {
          eciCache[idx] = NaN;
          eciCache[idx + 1] = NaN;
          eciCache[idx + 2] = NaN;
        }
        gmstCache[s] = satellite.gstime(date);

        // Progress every 2000 steps
        if (s % 2000 === 0 && s > 0) {
          self.postMessage({ type: "contactProgress", payload: { stage: 1, pct: Math.round((s / CACHE_STEPS) * 100), msg: `Cache: ${s}/${CACHE_STEPS} positions propagated...` } });
        }
      }

      self.postMessage({ type: "contactProgress", payload: { stage: 1, pct: 100, msg: `Ephemeris cache built — ${CACHE_STEPS} positions in ${((performance.now() - t0) / 1000).toFixed(2)}s` } });

      // ════════════════════════════════════════════════════════════════
      // STAGE 2 — Cache-Accelerated Coarse Elevation Scan
      // ════════════════════════════════════════════════════════════════
      self.postMessage({ type: "contactProgress", payload: { stage: 2, pct: 0, msg: `Scanning ${activeStations.length} stations across ${durationHours}h window...` } });

      // Per-station state tracking
      const stationState = activeStations.map(() => ({
        inPass: false,
        passStartStep: -1,
        windows: [], // [{startStep, endStep}]
      }));

      for (let s = 0; s < CACHE_STEPS; s++) {
        const idx = s * 3;
        const ex = eciCache[idx];
        if (ex !== ex) continue; // NaN fast check

        const ey = eciCache[idx + 1];
        const ez = eciCache[idx + 2];
        const gmst = gmstCache[s];

        // ECI → ECF conversion ONCE per step (simple rotation matrix)
        const ecf = satellite.eciToEcf({ x: ex, y: ey, z: ez }, gmst);

        // Evaluate ALL stations against this single ECF position
        for (let g = 0; g < activeStations.length; g++) {
          const lookAngles = satellite.ecfToLookAngles(stationGd[g], ecf);
          const elevDeg = lookAngles.elevation * RAD2DEG;
          const mask = activeStations[g].elevationMask || 10;

          const ss = stationState[g];
          if (elevDeg >= mask) {
            if (!ss.inPass) {
              ss.inPass = true;
              ss.passStartStep = s;
            }
          } else if (ss.inPass) {
            ss.windows.push({ startStep: ss.passStartStep, endStep: s });
            ss.inPass = false;
          }
        }

        // Progress every 4000 steps
        if (s % 4000 === 0 && s > 0) {
          self.postMessage({ type: "contactProgress", payload: { stage: 2, pct: Math.round((s / CACHE_STEPS) * 100), msg: `Coarse scan: step ${s}/${CACHE_STEPS}...` } });
        }
      }

      // Close any open windows at end of scan
      for (let g = 0; g < activeStations.length; g++) {
        if (stationState[g].inPass) {
          stationState[g].windows.push({ startStep: stationState[g].passStartStep, endStep: CACHE_STEPS - 1 });
          stationState[g].inPass = false;
        }
      }

      // Collect total windows
      let totalWindows = 0;
      for (let g = 0; g < activeStations.length; g++) {
        totalWindows += stationState[g].windows.length;
      }

      self.postMessage({ type: "contactProgress", payload: { stage: 2, pct: 100, msg: `Found ${totalWindows} coarse pass windows across ${activeStations.length} stations` } });

      if (totalWindows === 0) {
        self.postMessage({ type: "contactResult", payload: { contacts: [], elapsed_ms: Math.round(performance.now() - t0) } });
        return;
      }

      // ════════════════════════════════════════════════════════════════
      // STAGE 3 — Precise AOS/LOS via Bisection (1ms precision)
      // ════════════════════════════════════════════════════════════════
      self.postMessage({ type: "contactProgress", payload: { stage: 3, pct: 0, msg: "Refining AOS/LOS times to millisecond precision..." } });

      // Helper: compute elevation at a given time for a station
      function computeLookAngles(tMs, gd) {
        const date = new Date(tMs);
        const pv = satellite.propagate(satrec, date);
        if (!pv || !pv.position || pv.position === false) return null;
        const gmst = satellite.gstime(date);
        const ecf = satellite.eciToEcf(pv.position, gmst);
        return satellite.ecfToLookAngles(gd, ecf);
      }

      // Bisection: find the exact millisecond where elevation crosses the mask
      // direction = "rising" (AOS) or "setting" (LOS)
      function bisectCrossing(tBelowMs, tAboveMs, gd, mask, maxIter) {
        for (let i = 0; i < maxIter && (tAboveMs - tBelowMs) > 1; i++) {
          const tMid = Math.floor((tBelowMs + tAboveMs) / 2);
          const look = computeLookAngles(tMid, gd);
          if (!look) break;
          const elevDeg = look.elevation * RAD2DEG;
          if (elevDeg >= mask) {
            tAboveMs = tMid;
          } else {
            tBelowMs = tMid;
          }
        }
        // Return the "above" time (first moment above mask)
        const finalLook = computeLookAngles(tAboveMs, gd);
        return {
          time: new Date(tAboveMs),
          azimuth: finalLook ? finalLook.azimuth * RAD2DEG : 0,
          elevation: finalLook ? finalLook.elevation * RAD2DEG : 0,
        };
      }

      const refinedWindows = [];
      let processedWindows = 0;

      for (let g = 0; g < activeStations.length; g++) {
        const gd = stationGd[g];
        const mask = activeStations[g].elevationMask || 10;

        for (const w of stationState[g].windows) {
          // Coarse boundary times in ms
          const coarseAosMs = start.getTime() + w.startStep * CACHE_INTERVAL * 1000;
          const coarseLosMs = start.getTime() + w.endStep * CACHE_INTERVAL * 1000;

          // For AOS: tBelow = one step before start, tAbove = start step
          const aosTBelow = start.getTime() + Math.max(0, w.startStep - 1) * CACHE_INTERVAL * 1000;
          const aosTAbove = coarseAosMs;

          // For LOS: tAbove = last step in window, tBelow = end step (first step below)
          const losTAbove = start.getTime() + Math.max(0, w.endStep - 1) * CACHE_INTERVAL * 1000;
          const losTBelow = coarseLosMs;

          // Bisect AOS (find exact moment elevation rises above mask)
          const aos = bisectCrossing(aosTBelow, aosTAbove, gd, mask, 25);

          // Bisect LOS (find exact moment elevation drops below mask)
          // For LOS, we swap: tAbove is in the window, tBelow is outside
          const los = bisectCrossing(losTBelow, losTAbove, gd, mask, 25);
          // LOS time is the "below" boundary — the first moment BELOW mask
          // Re-compute: we want the last moment ABOVE mask
          const losTime = new Date(los.time.getTime());
          const losLook = computeLookAngles(losTBelow, gd);
          const losAz = losLook ? losLook.azimuth * RAD2DEG : los.azimuth;

          refinedWindows.push({
            stationIdx: g,
            aosTime: aos.time,
            losTime: losTime,
            aosAzimuth: aos.azimuth,
            losAzimuth: losAz,
          });

          processedWindows++;
          if (processedWindows % 10 === 0 || processedWindows === totalWindows) {
            self.postMessage({ type: "contactProgress", payload: { stage: 3, pct: Math.round((processedWindows / totalWindows) * 100), msg: `Refined ${processedWindows}/${totalWindows} pass boundaries` } });
          }
        }
      }

      // ════════════════════════════════════════════════════════════════
      // STAGE 4 — Golden-Section Search for Max Elevation
      // ════════════════════════════════════════════════════════════════
      self.postMessage({ type: "contactProgress", payload: { stage: 4, pct: 0, msg: "Finding maximum elevation for each pass..." } });

      const PHI = (Math.sqrt(5) - 1) / 2; // Golden ratio conjugate ≈ 0.618

      const contacts = [];

      for (let i = 0; i < refinedWindows.length; i++) {
        const rw = refinedWindows[i];
        const gd = stationGd[rw.stationIdx];

        let a = rw.aosTime.getTime();
        let b = rw.losTime.getTime();

        // Ensure valid window (AOS < LOS)
        if (b <= a) continue;

        // Golden-section search for max elevation
        let c = b - PHI * (b - a);
        let d = a + PHI * (b - a);
        let elevC = null, elevD = null;

        const MAX_ITER = 25;
        const TOLERANCE_MS = 100; // 100ms precision for max elevation time

        for (let iter = 0; iter < MAX_ITER && (b - a) > TOLERANCE_MS; iter++) {
          const lookC = computeLookAngles(c, gd);
          const lookD = computeLookAngles(d, gd);

          elevC = lookC ? lookC.elevation * RAD2DEG : -90;
          elevD = lookD ? lookD.elevation * RAD2DEG : -90;

          if (elevC > elevD) {
            b = d;
          } else {
            a = c;
          }
          c = b - PHI * (b - a);
          d = a + PHI * (b - a);
        }

        // Compute final max elevation
        const peakMs = Math.floor((a + b) / 2);
        const peakLook = computeLookAngles(peakMs, gd);
        const maxElev = peakLook ? peakLook.elevation * RAD2DEG : 0;

        const duration = (rw.losTime.getTime() - rw.aosTime.getTime()) / 1000; // seconds

        // Skip degenerate passes (< 5 seconds or negative elevation)
        if (duration < 5 || maxElev < (activeStations[rw.stationIdx].elevationMask || 10)) continue;

        contacts.push({
          stationId:    activeStations[rw.stationIdx].id,
          stationName:  activeStations[rw.stationIdx].name,
          stationColor: activeStations[rw.stationIdx].color,
          aos:          rw.aosTime.toISOString(),
          los:          rw.losTime.toISOString(),
          duration:     Math.round(duration * 10) / 10, // seconds, 1 decimal
          maxElevation: Math.round(maxElev * 100) / 100, // degrees, 2 decimals
          aosAzimuth:   Math.round(rw.aosAzimuth * 100) / 100, // degrees
          losAzimuth:   Math.round(rw.losAzimuth * 100) / 100, // degrees
        });

        if (i % 10 === 0 || i === refinedWindows.length - 1) {
          self.postMessage({ type: "contactProgress", payload: { stage: 4, pct: Math.round(((i + 1) / refinedWindows.length) * 100), msg: `Max elevation: ${i + 1}/${refinedWindows.length} passes analyzed` } });
        }
      }

      // ════════════════════════════════════════════════════════════════
      // STAGE 5 — Sort & Post Results
      // ════════════════════════════════════════════════════════════════
      contacts.sort((a, b) => new Date(a.aos) - new Date(b.aos));

      const elapsed_ms = Math.round(performance.now() - t0);
      self.postMessage({
        type: "contactProgress",
        payload: { stage: 5, pct: 100, msg: `Complete — ${contacts.length} contact windows in ${(elapsed_ms / 1000).toFixed(2)}s` },
      });
      self.postMessage({
        type: "contactResult",
        payload: { contacts, elapsed_ms },
      });

    } catch (err) {
      self.postMessage({
        type: "contactError",
        payload: { error: err.message || String(err) },
      });
    }
  }
};

