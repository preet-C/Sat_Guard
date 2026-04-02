import { useState, useEffect, useRef, useCallback } from "react";
import useSatguardStore from "../store/satguardStore";
import InfoTip from "./Tooltip";
import {
  getStations,
  addStation,
  removeStation,
  updateStation,
} from "../utils/groundStations";
import {
  LockIcon, UnlockIcon,
  EyeIcon, EyeOffIcon,
  EditIcon, TrashIcon,
  CloseIcon, ChevronLeftIcon, ChevronRightIcon,
  PlusIcon, SatelliteIcon,
} from "./ui/Icons";
import Select from "./ui/Select";

/* ── Satellite size presets ────────────────────────────────────────── */
const SIZE_PRESETS = [
  { label: "CubeSat", value: 0.1 },
  { label: "SmallSat", value: 0.5 },
  { label: "Medium", value: 2.0 },
  { label: "Large", value: 5.0 },
  { label: "Custom", value: null },
];

/* ── Orbital element definitions ──────────────────────────────────── */
const ORBIT_FIELDS = [
  { key: "altitude",    label: "Altitude",       unit: "km",  min: 160,  max: 35786, step: 1,     default: 550,  tip: "Height above Earth's surface at the orbit",                      errMsg: "Must be between 160 and 35,786 km",   gridCol: "1 / -1" },
  { key: "inclination", label: "Inclination",    unit: "deg", min: 0,    max: 180,   step: 0.1,   default: 97.0, tip: "Angle between the orbital plane and Earth's equator",            errMsg: "Must be between 0° and 180°",          gridCol: null },
  { key: "eccentricity",label: "Eccentricity",   unit: "",    min: 0,    max: 0.99,  step: 0.001, default: 0.0,  tip: "Shape of the orbit: 0 = circular, closer to 1 = more elliptical",errMsg: "Must be between 0 and 0.99",           gridCol: null },
  { key: "raan",        label: "RAAN",           unit: "deg", min: 0,    max: 360,   step: 0.1,   default: 0.0,  tip: "Right Ascension of Ascending Node — where the orbit crosses the equator", errMsg: "Must be between 0° and 360°", gridCol: null },
  { key: "argPerigee",  label: "Arg. Perigee",   unit: "deg", min: 0,    max: 360,   step: 0.1,   default: 0.0,  tip: "Angle from ascending node to the closest approach point",       errMsg: "Must be between 0° and 360°",          gridCol: null },
  { key: "meanAnomaly", label: "Mean Anomaly",   unit: "deg", min: 0,    max: 360,   step: 0.1,   default: 0.0,  tip: "Satellite's position along the orbit at epoch",                 errMsg: "Must be between 0° and 360°",          gridCol: "1 / -1" },
];

/* ── Helper: validate a single orbital field ─────────────────────── */
function fieldError(field, value) {
  if (value === "" || value === undefined) return null;
  const v = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(v)) return field.errMsg;
  if (v < field.min || v > field.max) return field.errMsg;
  return null;
}

/* ── Helper: Build a synthetic TLE pair from orbital parameters ───── */
function buildSyntheticTLE({ name, altitude, inclination, eccentricity, raan, argPerigee, meanAnomaly, epoch }) {
  if (!epoch) throw new Error("buildSyntheticTLE requires an explicit epoch — never use new Date()");
  const MU = 398600.4418;
  const R_EARTH = 6371.0;
  const a = R_EARTH + altitude;
  const n_rad_s = Math.sqrt(MU / (a * a * a));
  const n_rev_day = n_rad_s * 86400 / (2 * Math.PI);

  const now = epoch;
  const yr = now.getUTCFullYear();
  const yr2 = String(yr).slice(-2);
  const jan1 = new Date(Date.UTC(yr, 0, 1));
  const dayOfYear = (now - jan1) / 86400000 + 1;
  const epochStr = `${yr2}${dayOfYear.toFixed(8).padStart(12, " ")}`;

  const inc = inclination.toFixed(4).padStart(8);
  const raanStr = raan.toFixed(4).padStart(8);
  const eccStr = eccentricity.toFixed(7).replace("0.", "").padStart(7, "0");
  const argP = argPerigee.toFixed(4).padStart(8);
  const mAnomaly = meanAnomaly.toFixed(4).padStart(8);
  const mmStr = n_rev_day.toFixed(8).padStart(11);

  const noradId = "99999";
  const satName = (name || "MY-SAT").substring(0, 24);

  const tle1 = `1 ${noradId}U 25001A   ${epochStr}  .00000000  00000-0  00000-0 0  9990`;
  const tle2 = `2 ${noradId} ${inc} ${raanStr} ${eccStr} ${argP} ${mAnomaly} ${mmStr}    10`;

  return { name: satName, tle1, tle2 };
}

/* ── Shared input styles ─────────────────────────────────────────── */
const INPUT_BORDER_ERR = "1px solid var(--color-danger)";
const UNIFIED_BORDER = "1px solid rgba(0,212,255,0.25)";

/**
 * OrbitInput.jsx — Mission configuration panel
 * Two-tab input (Parameters / TLE), satellite sizing,
 * conjunction analysis trigger, ground station manager.
 */
export default function OrbitInput() {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState("params");

  /* ── Orbital element state ─────────────────────────────────────── */
  const defaultParams = {};
  ORBIT_FIELDS.forEach((f) => { defaultParams[f.key] = f.default; });
  const [orbitParams, setOrbitParams] = useState(defaultParams);
  const [dirtyFields, setDirtyFields] = useState({}); // track which fields user has edited
  const [satName, setSatName] = useState("MY-SAT");
  const [orbitCount, setOrbitCount] = useState(1); // 1 or 3 orbital periods
  const [showAdvanced, setShowAdvanced] = useState(false); // Advanced safe-slot toggle
  const [predictionWindow, setPredictionWindow] = useState(24); // Contact window hours: 12, 24, 72, 168

  /* ── TLE state ─────────────────────────────────────────────────── */
  const [tleText, setTleText] = useState(
    "1 25544U 98067A   24170.54791667  .00016717  00000-0  10270-3 0  9002\n2 25544  51.6393 210.1830 0001234  45.6789 314.3210 15.49925012456789"
  );

  /* ── Satellite size ────────────────────────────────────────────── */
  const [sizePreset, setSizePreset] = useState("SmallSat");
  const [customRadius, setCustomRadius] = useState(1.0);
  const [customRadiusDirty, setCustomRadiusDirty] = useState(false);
  const setUserSatelliteRadius = useSatguardStore((s) => s.setUserSatelliteRadius);

  useEffect(() => {
    const preset = SIZE_PRESETS.find((p) => p.label === sizePreset);
    const radius = preset && preset.value !== null ? preset.value : customRadius;
    setUserSatelliteRadius(radius);
  }, [sizePreset, customRadius, setUserSatelliteRadius]);

  /* ── Zustand selectors ─────────────────────────────────────────── */
  const parsedSatellites = useSatguardStore((s) => s.parsedSatellites);
  const conjunctionAnalysis = useSatguardStore((s) => s.conjunctionAnalysis);
  const setConjunctionAnalysis = useSatguardStore((s) => s.setConjunctionAnalysis);
  const setConjunctionProgress = useSatguardStore((s) => s.setConjunctionProgress);
  const userSatelliteRadius = useSatguardStore((s) => s.userSatelliteRadius);
  const setTargetOrbitParams = useSatguardStore((s) => s.setTargetOrbitParams);
  const targetOrbitParams = useSatguardStore((s) => s.targetOrbitParams);
  const orbitParamLocks = useSatguardStore((s) => s.orbitParamLocks);
  const setOrbitParamLocks = useSatguardStore((s) => s.setOrbitParamLocks);
  const safeSlotConfig = useSatguardStore((s) => s.safeSlotConfig);
  const setSafeSlotConfig = useSatguardStore((s) => s.setSafeSlotConfig);
  const safeSlotAnalysis = useSatguardStore((s) => s.safeSlotAnalysis);
  const setSafeSlotAnalysis = useSatguardStore((s) => s.setSafeSlotAnalysis);
  const setSafeSlotProgress = useSatguardStore((s) => s.setSafeSlotProgress);
  const setTimelineCollapsed = useSatguardStore((s) => s.setTimelineCollapsed);
  const missionEpoch = useSatguardStore((s) => s.missionEpoch);
  const setContacts = useSatguardStore((s) => s.setContacts);
  const contactsLoading = useSatguardStore((s) => s.contactsLoading);
  const setContactsLoading = useSatguardStore((s) => s.setContactsLoading);
  const setContactsError = useSatguardStore((s) => s.setContactsError);
  const setContactsProgress = useSatguardStore((s) => s.setContactsProgress);
  const setMissionEpoch = useSatguardStore((s) => s.setMissionEpoch);

  /* ── Debounced orbit preview (300ms) ───────────────────────────── */
  const orbitDebounceRef = useRef(null);
  useEffect(() => {
    if (activeTab !== "params") return;
    if (orbitDebounceRef.current) clearTimeout(orbitDebounceRef.current);
    orbitDebounceRef.current = setTimeout(() => {
      const p = orbitParams;
      // Only push if all params are valid numbers
      const valid = ORBIT_FIELDS.every((f) => {
        const v = typeof p[f.key] === "number" ? p[f.key] : parseFloat(p[f.key]);
        return !isNaN(v) && v >= f.min && v <= f.max;
      });
      if (valid) {
        setTargetOrbitParams({
          altitude:     Number(p.altitude),
          inclination:  Number(p.inclination),
          eccentricity: Number(p.eccentricity),
          raan:         Number(p.raan),
          argPerigee:   Number(p.argPerigee),
          meanAnomaly:  Number(p.meanAnomaly),
          orbitCount,
        });
      }
    }, 300);
    return () => { if (orbitDebounceRef.current) clearTimeout(orbitDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orbitParams, activeTab, orbitCount]);

  /* ── Sync local inputs FROM global store (Apply to Mission) ───── */
  useEffect(() => {
    setOrbitParams((prev) => {
      let changed = false;
      const next = {};
      for (const f of ORBIT_FIELDS) {
        const storeVal = targetOrbitParams[f.key];
        const localVal = typeof prev[f.key] === "number" ? prev[f.key] : parseFloat(prev[f.key]);
        if (storeVal !== undefined && !isNaN(storeVal) && Math.abs(storeVal - localVal) > 1e-10) {
          next[f.key] = storeVal;
          changed = true;
        } else {
          next[f.key] = prev[f.key];
        }
      }
      return changed ? next : prev;
    });
    if (targetOrbitParams.orbitCount !== undefined) {
      setOrbitCount((prev) => targetOrbitParams.orbitCount !== prev ? targetOrbitParams.orbitCount : prev);
    }
  }, [targetOrbitParams]);

  /* ── Worker ref + pool refs ────────────────────────────────────── */
  const workerRef = useRef(null);
  const poolRef = useRef([]);    // temp worker pool for Stage 3
  const poolResultsRef = useRef({ pending: 0, results: [], allCandidates: [], baselineResult: null, targetOrbit: null, finalistCount: 0, t0: 0 });

  // Cleanup helper for pool workers
  const cleanupPool = useCallback(() => {
    for (const w of poolRef.current) {
      try { w.terminate(); } catch (_) { /* ignore */ }
    }
    poolRef.current = [];
  }, []);

  useEffect(() => {
    workerRef.current = new Worker(
      new URL("../workers/conjunctionWorker.js", import.meta.url),
      { type: "module" }
    );

    workerRef.current.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === "conjunctionResult") {
        setConjunctionAnalysis({
          results: payload.results,
          loading: false,
          error: null,
          lastRun: new Date().toISOString(),
          source: "engine",
          safeSlotRank: null,
        });
        setConjunctionProgress(null);
      } else if (type === "conjunctionError") {
        setConjunctionAnalysis({ loading: false, error: payload.error });
        setConjunctionProgress(null);
      } else if (type === "conjunctionProgress") {
        setConjunctionProgress(payload);
      } else if (type === "safeSlotError") {
        setSafeSlotAnalysis({ loading: false, error: payload.error });
        setSafeSlotProgress(null);
        cleanupPool();
      } else if (type === "safeSlotProgress") {
        setSafeSlotProgress(payload);
      } else if (type === "safeSlotStage2Complete") {
        // ── Dispatch Stage 3 to a worker pool with Ephemeris Cache ──
        const {
          finalists, allCandidates, finalistCount,
          targetOrbit: tgtOrbit, userRadius: uRadius, startTime, elapsed_stage12_ms,
          // Ephemeris cache
          ephemerisSAB, usingSAB, cacheSteps, cacheInterval,
          threatCount: nThreats, threatNames, threatTLE1s, threatTLE2s, threatOrbParams,
        } = payload;

        const sabMode = usingSAB ? "SharedArrayBuffer (zero-copy)" : "ArrayBuffer (copied)";
        setSafeSlotProgress({ stage: 3, pct: 0, msg: `Spawning worker pool [${sabMode}] for ${finalistCount} finalists...` });

        // Determine pool size
        const cores = navigator.hardwareConcurrency || 4;
        const poolSize = Math.min(Math.max(cores - 1, 2), finalistCount + 1, 4);

        // Build baseline TLE
        const MU = 398600.4418;
        const R_EARTH = 6371;
        const buildTLE = (params) => {
          const a = R_EARTH + params.altitude;
          const n_rad_s = Math.sqrt(MU / (a * a * a));
          const n_rev_day = n_rad_s * 86400 / (2 * Math.PI);
          const now = missionEpoch;  // Use global mission epoch — NOT new Date()
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
          return {
            tle1: `1 99999U 25001A   ${epochStr}  .00000000  00000-0  00000-0 0  9990`,
            tle2: `2 99999 ${inc} ${raanStr} ${eccStr} ${argP} ${mAnomaly} ${mmStr}    10`,
          };
        };

        // Jobs: baseline (index = -1) + all finalists
        const baselineTLE = buildTLE(tgtOrbit);
        const jobs = [
          { finalistIndex: -1, orbitParams: tgtOrbit, tle1: baselineTLE.tle1, tle2: baselineTLE.tle2 },
          ...finalists.map((f, i) => ({ finalistIndex: i, orbitParams: f.orbitParams, tle1: f.tle1, tle2: f.tle2 })),
        ];

        // Pool tracking
        const totalJobs = jobs.length;
        let completedJobs = 0;
        const pipelineResults = [];
        let baselineMetrics = { totalConjunctions: 0, worstPc: 0, minMissDistance: 9999 };

        poolResultsRef.current = { pending: totalJobs, results: [], allCandidates, baselineResult: null, targetOrbit: tgtOrbit, finalistCount, t0: elapsed_stage12_ms };

        // Spawn pool workers
        cleanupPool();
        const pool = [];
        for (let p = 0; p < poolSize; p++) {
          const pw = new Worker(
            new URL("../workers/conjunctionWorker.js", import.meta.url),
            { type: "module" }
          );
          pool.push(pw);
        }
        poolRef.current = pool;

        // Result handler
        const handlePoolResult = (e) => {
          const { type: rType, payload: rPayload } = e.data;
          if (rType !== "pipelineResult") return;

          completedJobs++;

          if (rPayload.finalistIndex === -1) {
            baselineMetrics = {
              totalConjunctions: rPayload.totalConjunctions || 0,
              worstPc: rPayload.worstPc || 0,
              minMissDistance: rPayload.minMissDistance || 9999,
              orbitParams: tgtOrbit,
              deltaV_ms: 0,
            };
          } else {
            pipelineResults.push(rPayload);
          }

          setSafeSlotProgress({
            stage: 3,
            pct: Math.round((completedJobs / totalJobs) * 100),
            msg: `Deep analysis ${completedJobs}/${totalJobs} (parallel) — ${rPayload.totalConjunctions || 0} conjunctions`,
          });

          if (completedJobs >= totalJobs) {
            const R_E = 6371;
            const mu = 398600.4418;

            const finalistResults = pipelineResults.map((r) => {
              const a_current = R_E + tgtOrbit.altitude;
              const v_current = Math.sqrt(mu / a_current);
              const a_new = R_E + r.orbitParams.altitude;
              const v_new = Math.sqrt(mu / a_new);
              const deltaV_kms = Math.abs(v_new - v_current);
              const inclDelta = Math.abs(r.orbitParams.inclination - tgtOrbit.inclination) * (Math.PI / 180);
              const inclCost = 2 * v_current * Math.sin(inclDelta / 2);
              const totalDeltaV_ms = (deltaV_kms + inclCost) * 1000;

              const safetyScore = (r.totalConjunctions || 0) * 1000 + (r.worstPc || 0) * 1e8 - (r.minMissDistance || 0) * 10;

              let reason = "";
              const conjDiff = baselineMetrics.totalConjunctions - (r.totalConjunctions || 0);
              const missDiff = (r.minMissDistance || 0) - baselineMetrics.minMissDistance;
              if ((r.totalConjunctions || 0) === 0 && baselineMetrics.totalConjunctions > 0) {
                reason = `No conjunctions detected in 7-day window (current orbit has ${baselineMetrics.totalConjunctions})`;
              } else if ((r.totalConjunctions || 0) === 0 && baselineMetrics.totalConjunctions === 0) {
                reason = "Clean orbit — no conjunctions detected, same as current";
              } else if (conjDiff > 0 && missDiff > 0) {
                const pctFewer = Math.round((conjDiff / Math.max(baselineMetrics.totalConjunctions, 1)) * 100);
                reason = `${pctFewer}% fewer conjunctions, min miss improved by +${missDiff.toFixed(1)} km`;
              } else if (conjDiff > 0) {
                const pctFewer = Math.round((conjDiff / Math.max(baselineMetrics.totalConjunctions, 1)) * 100);
                reason = `${pctFewer}% fewer conjunctions than current orbit`;
              } else if (missDiff > 0) {
                reason = `Min miss distance ${missDiff.toFixed(1)} km safer than current orbit`;
              } else {
                reason = `Similar conjunction profile — ${r.totalConjunctions || 0} encounters, min miss ${(r.minMissDistance || 0).toFixed(1)} km`;
              }

              return {
                orbitParams: r.orbitParams,
                totalConjunctions: r.totalConjunctions || 0,
                worstPc: r.worstPc || 0,
                minMissDistance: r.minMissDistance || 9999,
                avgMissDistance: r.avgMissDistance || 9999,
                safetyScore,
                reason,
                deltaV_ms: Math.round(totalDeltaV_ms * 10) / 10,
                conjunctionDetails: r.conjunctionDetails || [],
                tle1: r.tle1 || null,  // candidate's canonical TLE for Apply to Mission
                tle2: r.tle2 || null,
              };
            });

            finalistResults.sort((a, b) => a.safetyScore - b.safetyScore);
            const top3 = finalistResults.slice(0, 3).map((r, i) => ({ rank: i + 1, ...r }));

            setSafeSlotProgress({ stage: 3, pct: 100, msg: `Complete — top 3 safer slots found` });

            setSafeSlotAnalysis({
              results: top3,
              allCandidates,
              baselineMetrics,
              loading: false,
              error: null,
              lastRun: new Date().toISOString(),
            });
            setSafeSlotProgress(null);
            cleanupPool();
          }
        };

        // Attach handlers + dispatch jobs (wrapped in try-catch to prevent crash cascades)
        try {
          for (const pw of pool) {
            pw.onmessage = handlePoolResult;
            pw.onerror = (err) => {
              console.error("[SafeSlotPool] Worker error:", err);
              completedJobs++;
              // Circuit breaker: only finalize once
              if (completedJobs === totalJobs) {
                handlePoolResult({ data: { type: "pipelineResult", payload: { finalistIndex: -99, totalConjunctions: 0, worstPc: 0, minMissDistance: 9999, avgMissDistance: 9999, conjunctionDetails: [] } } });
              }
            };
          }

          // Distribute jobs round-robin with ephemeris cache
          // If SAB transfer fails (DataCloneError), fall back to ArrayBuffer copies
          let transferBuffer = ephemerisSAB;
          let sabTransferFailed = false;

          for (let j = 0; j < jobs.length; j++) {
            const job = jobs[j];
            const workerIdx = j % pool.length;
            const jobPayload = {
              finalistIndex: job.finalistIndex,
              orbitParams: job.orbitParams,
              tle1: job.tle1,
              tle2: job.tle2,
              userRadius: uRadius,
              startTime,
              targetOrbit: tgtOrbit,
              ephemerisSAB: transferBuffer,
              cacheSteps,
              cacheInterval,
              threatCount: nThreats,
              threatNames,
              threatTLE1s,
              threatTLE2s,
              threatOrbParams,
            };

            try {
              pool[workerIdx].postMessage({ type: "runFullPipeline", payload: jobPayload });
            } catch (transferErr) {
              // SAB transfer blocked — convert to regular ArrayBuffer and retry
              if (!sabTransferFailed && transferErr.name === "DataCloneError" && ephemerisSAB instanceof SharedArrayBuffer) {
                console.warn("[SafeSlotPool] SharedArrayBuffer transfer blocked — falling back to ArrayBuffer copies");
                sabTransferFailed = true;
                const ab = new ArrayBuffer(ephemerisSAB.byteLength);
                new Float64Array(ab).set(new Float64Array(ephemerisSAB));
                transferBuffer = ab;
                // Retry this job with the ArrayBuffer copy
                pool[workerIdx].postMessage({ type: "runFullPipeline", payload: { ...jobPayload, ephemerisSAB: transferBuffer } });
              } else {
                // Unknown error or repeated failure — count as completed to prevent hang
                console.error("[SafeSlotPool] Failed to dispatch job:", transferErr);
                completedJobs++;
                if (completedJobs >= totalJobs) {
                  setSafeSlotAnalysis({ loading: false, error: `Worker dispatch failed: ${transferErr.message}` });
                  setSafeSlotProgress(null);
                  cleanupPool();
                }
              }
            }
          }
        } catch (poolErr) {
          // Total pool failure — clean up and report
          console.error("[SafeSlotPool] Fatal pool error:", poolErr);
          cleanupPool();
          setSafeSlotAnalysis({ loading: false, error: `Worker pool failed: ${poolErr.message}` });
          setSafeSlotProgress(null);
        }
      } else if (type === "contactResult") {
        setContacts(payload.contacts);
        setContactsLoading(false);
        setContactsError(null);
        setContactsProgress(null);
      } else if (type === "contactError") {
        setContactsLoading(false);
        setContactsError(payload.error);
        setContactsProgress(null);
      } else if (type === "contactProgress") {
        setContactsProgress(payload);
      }
    };

    return () => {
      workerRef.current?.terminate();
      cleanupPool();
    };
  }, [setConjunctionAnalysis, setConjunctionProgress, setSafeSlotAnalysis, setSafeSlotProgress, cleanupPool, setContacts, setContactsLoading, setContactsError, setContactsProgress]);

  /* ── Analyze handler ───────────────────────────────────────────── */
  const [validationError, setValidationError] = useState(null);

  const handleAnalyze = useCallback(() => {
    setValidationError(null);

    let target;
    if (activeTab === "params") {
      // Check each field
      for (const f of ORBIT_FIELDS) {
        const err = fieldError(f, orbitParams[f.key]);
        if (err) { setValidationError(`${f.label}: ${err}`); return; }
      }
      // Use the global missionEpoch — deterministic, user-controlled
      target = buildSyntheticTLE({ name: satName, ...orbitParams, epoch: missionEpoch });
    } else {
      const lines = tleText.trim().split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) { setValidationError("Paste two TLE lines"); return; }
      target = { name: satName, tle1: lines[0], tle2: lines[1] };
    }

    if (!parsedSatellites || parsedSatellites.length === 0) {
      setValidationError("No catalog loaded — wait for TLE data to finish loading");
      return;
    }

    setConjunctionAnalysis({ loading: true, error: null, results: [], targetOrbit: target });
    setConjunctionProgress({ stage: 0, pct: 0, msg: "Initializing…" });

    const catalog = parsedSatellites.map(({ name, tle1, tle2 }) => ({ name, tle1, tle2 }));

    workerRef.current?.postMessage({
      type: "analyzeConjunctions",
      payload: {
        target,
        catalog,
        userRadius: userSatelliteRadius,
        startTime: missionEpoch.toISOString(),
      },
    });
  }, [activeTab, orbitParams, satName, tleText, parsedSatellites, userSatelliteRadius, missionEpoch, setConjunctionAnalysis]);

  /* ── Find Safer Slots handler ──────────────────────────────────── */
  const handleFindSaferSlots = useCallback(() => {
    setValidationError(null);

    // Validate orbit params
    if (activeTab === "params") {
      for (const f of ORBIT_FIELDS) {
        const err = fieldError(f, orbitParams[f.key]);
        if (err) { setValidationError(`${f.label}: ${err}`); return; }
      }
    }

    // Check at least 1 param is unlocked
    const unlockedCount = Object.values(orbitParamLocks).filter((v) => !v).length;
    if (unlockedCount === 0) {
      setValidationError("All parameters are locked. Unlock at least one orbital parameter to search.");
      return;
    }

    if (!parsedSatellites || parsedSatellites.length === 0) {
      setValidationError("No catalog loaded — wait for TLE data to finish loading");
      return;
    }

    // Build target orbit params
    const targetOrbit = {
      altitude: Number(orbitParams.altitude),
      inclination: Number(orbitParams.inclination),
      eccentricity: Number(orbitParams.eccentricity),
      raan: Number(orbitParams.raan),
      argPerigee: Number(orbitParams.argPerigee),
      meanAnomaly: Number(orbitParams.meanAnomaly),
    };

    setSafeSlotAnalysis({ loading: true, error: null, results: [], allCandidates: [], baselineMetrics: null });
    setSafeSlotProgress({ stage: 0, pct: 0, msg: "Initializing safe slot search..." });

    // Auto-expand the Mission Analysis drawer
    setTimelineCollapsed(false);

    const catalog = parsedSatellites.map(({ name, tle1, tle2 }) => ({ name, tle1, tle2 }));

    workerRef.current?.postMessage({
      type: "findSaferSlots",
      payload: {
        targetOrbit,
        catalog,
        orbitParamLocks,
        safeSlotConfig,
        userRadius: userSatelliteRadius,
        missionEpoch: missionEpoch.toISOString(),
      },
    });
  }, [activeTab, orbitParams, orbitParamLocks, parsedSatellites, userSatelliteRadius, missionEpoch, safeSlotConfig, setSafeSlotAnalysis, setSafeSlotProgress, setTimelineCollapsed]);

  /* ── Calculate Contacts handler ─────────────────────────────────── */
  const handleCalculateContacts = useCallback(() => {
    setValidationError(null);

    let target;
    if (activeTab === "params") {
      for (const f of ORBIT_FIELDS) {
        const err = fieldError(f, orbitParams[f.key]);
        if (err) { setValidationError(`${f.label}: ${err}`); return; }
      }
      target = buildSyntheticTLE({ name: satName, ...orbitParams, epoch: missionEpoch });
    } else {
      const lines = tleText.trim().split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) { setValidationError("Paste two TLE lines"); return; }
      target = { name: satName, tle1: lines[0], tle2: lines[1] };
    }

    const visibleStations = getStations().filter(s => s.visible);
    if (visibleStations.length === 0) {
      setValidationError("No visible ground stations — enable at least one station");
      return;
    }

    setContactsLoading(true);
    setContactsError(null);
    setContacts([]);
    setContactsProgress({ stage: 0, pct: 0, msg: "Initializing contact analysis..." });
    setTimelineCollapsed(false);

    workerRef.current?.postMessage({
      type: "calculateContacts",
      payload: {
        target,
        stations: visibleStations,
        startTime: missionEpoch.toISOString(),
        durationHours: predictionWindow,
      },
    });
  }, [activeTab, orbitParams, satName, tleText, missionEpoch, predictionWindow, setContactsLoading, setContactsError, setContacts, setContactsProgress, setTimelineCollapsed]);

  /* ── Ground station manager state ───────────────────────────────── */
  const [stations, setStations] = useState(() => getStations());
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ name: "", lat: "", lon: "", alt: "", elevationMask: "10" });
  const [formErrors, setFormErrors] = useState({});

  useEffect(() => {
    const handler = () => setStations(getStations());
    window.addEventListener("groundStationsChanged", handler);
    return () => window.removeEventListener("groundStationsChanged", handler);
  }, []);

  function validate(data) {
    const errors = {};
    if (!data.name.trim()) errors.name = "Required";
    const lat = parseFloat(data.lat);
    if (isNaN(lat) || lat < -90 || lat > 90) errors.lat = "-90 to 90";
    const lon = parseFloat(data.lon);
    if (isNaN(lon) || lon < -180 || lon > 180) errors.lon = "-180 to 180";
    const alt = parseFloat(data.alt);
    if (data.alt !== "" && (isNaN(alt) || alt < 0)) errors.alt = "≥ 0";
    const elMask = parseFloat(data.elevationMask);
    if (isNaN(elMask) || elMask < 0 || elMask > 90) errors.elevationMask = "0° to 90°";
    return errors;
  }
  function handleAdd() {
    const errors = validate(formData);
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }
    const updated = addStation({ name: formData.name.trim(), lat: parseFloat(formData.lat), lon: parseFloat(formData.lon), alt: parseFloat(formData.alt) || 0, elevationMask: parseFloat(formData.elevationMask) || 10 });
    setStations(updated);
    setFormData({ name: "", lat: "", lon: "", alt: "", elevationMask: "10" });
    setFormErrors({});
    setShowAddForm(false);
  }
  function handleSaveEdit() {
    const errors = validate(formData);
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }
    const updated = updateStation(editingId, { name: formData.name.trim(), lat: parseFloat(formData.lat), lon: parseFloat(formData.lon), alt: parseFloat(formData.alt) || 0, elevationMask: parseFloat(formData.elevationMask) || 10 });
    setStations(updated);
    setEditingId(null);
    setFormData({ name: "", lat: "", lon: "", alt: "", elevationMask: "10" });
    setFormErrors({});
  }
  function handleDelete(id) { setStations(removeStation(id)); }
  function handleToggleVisibility(id) {
    const gs = stations.find((s) => s.id === id);
    if (!gs) return;
    setStations(updateStation(id, { visible: !gs.visible }));
  }
  function startEdit(gs) {
    setEditingId(gs.id);
    setFormData({ name: gs.name, lat: String(gs.lat), lon: String(gs.lon), alt: String(gs.alt), elevationMask: String(gs.elevationMask ?? 10) });
    setFormErrors({});
    setShowAddForm(false);
  }
  function cancelEdit() {
    setEditingId(null);
    setFormData({ name: "", lat: "", lon: "", alt: "", elevationMask: "10" });
    setFormErrors({});
  }

  /* ── Derived ───────────────────────────────────────────────────── */
  const isLoading = conjunctionAnalysis.loading;
  const customRadiusErr = customRadiusDirty && customRadius <= 0 ? "Must be greater than 0 m" : null;

  return (
    <>
      {/* Panel */}
      <aside
        id="orbit-input-panel"
        className="fixed z-40 panel-glass rounded-r-xl panel-slide-left flex flex-col"
        style={{
          top: "60px",
          left: 0,
          width: "320px",
          height: "calc(100vh - 230px)",
          maxHeight: "calc(100vh - 230px)",
          overflow: "hidden",
          overflowX: "hidden",
          boxSizing: "border-box",
          transition: "transform 0.3s ease",
          transform: collapsed ? "translateX(-320px)" : "translateX(0)",
        }}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <h2 className="text-sm font-semibold tracking-wide flex items-center gap-2" style={{ color: "var(--color-text-primary)" }}>
            <SatelliteIcon size={14} style={{ color: "var(--color-accent)" }} />
            Mission config
          </h2>
          <button
            onClick={() => setCollapsed(true)}
            className="w-6 h-6 flex items-center justify-center rounded text-xs cursor-pointer transition-colors duration-200"
            style={{
              color: "var(--color-text-secondary)",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid var(--color-border)",
            }}
            title="Close panel"
          >
            <CloseIcon size={12} />
          </button>
        </div>

        {/* SCROLLABLE Content Area */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-4 animate-fade-in" style={{ padding: "12px 12px 32px 12px", minHeight: 0, scrollbarWidth: "thin", scrollbarColor: "rgba(0,212,255,0.3) transparent", overflowX: "hidden", boxSizing: "border-box", maxWidth: "100%" }}>

          {/* ── Tab Switcher ──────────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              borderRadius: "8px",
              overflow: "hidden",
              border: "1px solid var(--color-border)",
              background: "rgba(255,255,255,0.02)",
              flexShrink: 0,
            }}
          >
            {[
              { id: "params", label: "Parameters" },
              { id: "tle", label: "TLE" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  height: "32px",
                  lineHeight: "32px",
                  display: "block",
                  textAlign: "center",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s",
                  background: activeTab === tab.id ? "rgba(0, 212, 255, 0.12)" : "transparent",
                  color: activeTab === tab.id ? "var(--color-accent)" : "var(--color-text-muted)",
                  border: "none",
                  borderBottom: activeTab === tab.id ? "2px solid var(--color-accent)" : "2px solid transparent",
                  padding: 0,
                  margin: 0,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── PARAMETERS TAB ────────────────────────────────────── */}
          {activeTab === "params" && (
            <div className="flex flex-col gap-3 animate-fade-in">
              {/* Satellite Name */}
              <div>
                <Label>
                  Satellite name
                  <InfoTip text="Identifier for your satellite in results" />
                </Label>
                <input
                  type="text"
                  value={satName}
                  onChange={(e) => setSatName(e.target.value)}
                  className="w-full text-xs"
                  style={{
                    height: "26px",
                    padding: "0 8px",
                    border: UNIFIED_BORDER,
                    borderRadius: "6px",
                    background: "rgba(255,255,255,0.04)",
                    color: "var(--color-text-primary)",
                    outline: "none",
                  }}
                />
              </div>

              {/* Mission Epoch */}
              <div>
                <Label>
                  Mission epoch (UTC)
                  <InfoTip text="Anchor time for all synthetic TLE generation. Both the main engine and safe-slot pipelines use this epoch to ensure deterministic, synchronized propagation." />
                </Label>
                <input
                  type="datetime-local"
                  value={(() => {
                    const d = missionEpoch;
                    const pad = (n) => String(n).padStart(2, "0");
                    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
                  })()}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) {
                      // Parse as UTC (input gives local, but we treat it as UTC)
                      const [datePart, timePart] = v.split("T");
                      const [yr, mo, da] = datePart.split("-").map(Number);
                      const [hr, mi] = timePart.split(":").map(Number);
                      setMissionEpoch(new Date(Date.UTC(yr, mo - 1, da, hr, mi, 0, 0)));
                    }
                  }}
                  className="w-full text-xs"
                  style={{
                    height: "26px",
                    padding: "0 8px",
                    borderTop: UNIFIED_BORDER,
                    borderRight: UNIFIED_BORDER,
                    borderBottom: UNIFIED_BORDER,
                    borderLeft: UNIFIED_BORDER,
                    borderRadius: "6px",
                    background: "rgba(255,255,255,0.04)",
                    color: "var(--color-text-primary)",
                    outline: "none",
                    colorScheme: "dark",
                  }}
                />
              </div>

              {/* Section label */}
              <SectionLabel>Orbital Elements</SectionLabel>

              {/* Grid for orbital elements */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "6px",
                  maxWidth: "100%",
                }}
              >
                {ORBIT_FIELDS.map((f) => {
                  const isDirty = !!dirtyFields[f.key];
                  const err = isDirty ? fieldError(f, orbitParams[f.key]) : null;
                  const isLocked = !!orbitParamLocks[f.key];

                  return (
                    <div
                      key={f.key}
                      style={f.gridCol ? { gridColumn: f.gridCol } : undefined}
                    >
                      <Label>
                        {f.label}
                        <InfoTip text={f.tip} />
                      </Label>

                      <div style={{
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "stretch",
                        border: err ? INPUT_BORDER_ERR : isLocked ? "1px solid rgba(100,116,139,0.3)" : UNIFIED_BORDER,
                        borderRadius: "6px",
                        overflow: "hidden",
                        height: "26px",
                        opacity: isLocked ? 0.8 : 1,
                        transition: "opacity 0.2s, border-color 0.2s",
                      }}>
                        <input
                          type="number"
                          value={orbitParams[f.key]}
                          onChange={(e) => {
                            const v = e.target.value === "" ? "" : parseFloat(e.target.value);
                            setOrbitParams((p) => ({ ...p, [f.key]: v }));
                            setDirtyFields((d) => ({ ...d, [f.key]: true }));
                          }}
                          min={f.min}
                          max={f.max}
                          step={f.step}
                          className="text-xs font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          style={{
                            flexGrow: 1,
                            minWidth: 0,
                            height: "26px",
                            padding: "0 8px",
                            border: "none",
                            background: "rgba(255,255,255,0.04)",
                            color: "var(--color-text-primary)",
                            outline: "none",
                            borderRadius: 0,
                          }}
                        />
                        {/* Lock icon toggle */}
                        <button
                          onClick={() => setOrbitParamLocks({ ...orbitParamLocks, [f.key]: !isLocked })}
                          title={isLocked ? `Unlock ${f.label}` : `Lock ${f.label}`}
                          style={{
                            width: "24px",
                            height: "26px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "transparent",
                            border: "none",
                            borderLeft: err ? INPUT_BORDER_ERR : isLocked ? "1px solid rgba(100,116,139,0.3)" : UNIFIED_BORDER,
                            cursor: "pointer",
                            fontSize: "12px",
                            padding: 0,
                            color: isLocked ? "#64748b" : "#00d4ff",
                            transition: "color 0.2s",
                            flexShrink: 0,
                          }}
                        >
                          {isLocked ? <LockIcon size={12} /> : <UnlockIcon size={12} />}
                        </button>
                        {f.unit && (
                          <span
                            className="font-mono flex-shrink-0"
                            style={{
                              width: "auto",
                              minWidth: "36px",
                              height: "26px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderLeft: err ? INPUT_BORDER_ERR : isLocked ? "1px solid rgba(100,116,139,0.3)" : UNIFIED_BORDER,
                              background: "rgba(0,212,255,0.08)",
                              color: "rgba(255,255,255,0.5)",
                              fontSize: "11px",
                            }}
                          >
                            {f.unit}
                          </span>
                        )}
                      </div>

                      {err && (
                        <div className="text-[9px] mt-0.5" style={{ color: "var(--color-danger)" }}>
                          {err}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Hint */}
              <p className="text-[10px] leading-tight" style={{ color: "var(--color-text-muted)" }}>
                Leaving defaults gives a sun-synchronous-like orbit. Paste a TLE for mission-specific accuracy.
              </p>
            </div>
          )}

          {/* ── TLE TAB ───────────────────────────────────────────── */}
          {activeTab === "tle" && (
            <div className="flex flex-col gap-3 animate-fade-in">
              <div>
                <Label>
                  Satellite name
                  <InfoTip text="Identifier for your satellite in results" />
                </Label>
                <input
                  type="text"
                  value={satName}
                  onChange={(e) => setSatName(e.target.value)}
                  className="w-full text-xs"
                  style={{
                    height: "26px",
                    padding: "0 8px",
                    border: UNIFIED_BORDER,
                    borderRadius: "6px",
                    background: "rgba(255,255,255,0.04)",
                    color: "var(--color-text-primary)",
                    outline: "none",
                  }}
                />
              </div>
              <div>
                <Label>
                  TLE input
                  <InfoTip text="Paste two-line element set — line 1 starts with '1', line 2 starts with '2'" />
                </Label>
                <textarea
                  rows={3}
                  className="w-full rounded-md px-3 py-2 text-xs font-mono resize-none"
                  style={{
                    border: UNIFIED_BORDER,
                    background: "rgba(255,255,255,0.04)",
                    color: "var(--color-text-secondary)",
                    outline: "none",
                  }}
                  value={tleText}
                  onChange={(e) => setTleText(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* ── ORBIT PREVIEW toggle ──────────────────────────────── */}
          <div>
            <SectionLabel>ORBIT PREVIEW</SectionLabel>
            <div
              style={{
                display: "flex",
                borderRadius: "6px",
                overflow: "hidden",
                border: "1px solid rgba(0,212,255,0.25)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              {[{ val: 1, label: "1 orbit" }, { val: 3, label: "3 orbits" }].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => {
                    setOrbitCount(opt.val);
                    // Immediately push new orbitCount to store (bypass debounce for responsiveness)
                    const p = orbitParams;
                    const valid = ORBIT_FIELDS.every((f) => {
                      const v = typeof p[f.key] === "number" ? p[f.key] : parseFloat(p[f.key]);
                      return !isNaN(v) && v >= f.min && v <= f.max;
                    });
                    if (valid) {
                      setTargetOrbitParams({
                        altitude: Number(p.altitude), inclination: Number(p.inclination),
                        eccentricity: Number(p.eccentricity), raan: Number(p.raan),
                        argPerigee: Number(p.argPerigee), meanAnomaly: Number(p.meanAnomaly),
                        orbitCount: opt.val,
                      });
                    }
                  }}
                  style={{
                    flex: 1,
                    height: "28px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    background: orbitCount === opt.val ? "rgba(0, 212, 255, 0.15)" : "transparent",
                    color: orbitCount === opt.val ? "#00d4ff" : "var(--color-text-muted)",
                    border: "none",
                    borderRight: opt.val === 1 ? "1px solid rgba(0,212,255,0.25)" : "none",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] mt-1" style={{ color: "var(--color-text-muted)" }}>
              {orbitCount === 1 ? "~96 min ground track" : "~288 min ground track (3 passes)"}
            </p>
          </div>

          {/* ── "My Satellite" size selector (always visible) ─────── */}
          <div>
            <SectionLabel>SPACECRAFT CONFIG</SectionLabel>
            <Label>
              Size preset
              <InfoTip text="Sets the hard-body radius used for collision probability calculation" />
            </Label>
            <Select
              value={sizePreset}
              onChange={(val) => setSizePreset(val)}
              size="sm"
              options={SIZE_PRESETS.map((p) => ({
                value: p.label,
                label: p.label + (p.value !== null ? ` (${p.value}m)` : ""),
              }))}
            />

            {sizePreset === "Custom" && (
              <div className="mt-2">
                <Label>Radius</Label>
                
                <div style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "stretch",
                  border: customRadiusErr ? INPUT_BORDER_ERR : UNIFIED_BORDER,
                  borderRadius: "6px",
                  overflow: "hidden",
                  height: "26px"
                }}>
                  <input
                    type="number"
                    value={customRadius}
                    onChange={(e) => {
                      setCustomRadius(parseFloat(e.target.value) || 0);
                      setCustomRadiusDirty(true);
                    }}
                    min={0.01}
                    max={50}
                    step={0.1}
                    className="text-xs font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    style={{
                      flexGrow: 1,
                      minWidth: 0,
                      height: "26px",
                      padding: "0 8px",
                      border: "none",
                      background: "rgba(255,255,255,0.04)",
                      color: "var(--color-text-primary)",
                      outline: "none",
                      borderRadius: 0,
                    }}
                  />
                  <span
                    className="font-mono flex-shrink-0 flex items-center justify-center"
                    style={{
                      width: "auto",
                      minWidth: "36px",
                      height: "26px",
                      borderLeft: customRadiusErr ? INPUT_BORDER_ERR : UNIFIED_BORDER,
                      background: "rgba(0,212,255,0.08)",
                      color: "rgba(255,255,255,0.5)",
                      fontSize: "11px",
                    }}
                  >
                    m
                  </span>
                  </div>


                {customRadiusErr && (
                  <div className="text-[9px] mt-0.5" style={{ color: "var(--color-danger)" }}>
                    {customRadiusErr}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Validation error ──────────────────────────────────── */}
          {validationError && (
            <div
              className="text-xs px-3 py-2 rounded-md"
              style={{
                background: "rgba(255,71,87,0.1)",
                border: "1px solid rgba(255,71,87,0.3)",
                color: "#ff4757",
              }}
            >
              {validationError}
            </div>
          )}

          {/* Last run info */}
          {conjunctionAnalysis.source === "safeSlot" && (
            <p className="text-[10px] text-center" style={{ color: "#ffa502", fontStyle: "italic" }}>
              Previewing Safe Slot #{conjunctionAnalysis.safeSlotRank || ""} — run analysis to update baseline
            </p>
          )}
          {conjunctionAnalysis.source !== "safeSlot" && conjunctionAnalysis.lastRun && !isLoading && !conjunctionAnalysis.error && (
            (conjunctionAnalysis.results?.length ?? 0) === 0 ? (
              <p className="text-[10px] text-center" style={{ color: "#4ade80" }}>
                No conjunctions detected in 7-day window
              </p>
            ) : (
              <p className="text-[10px] text-center" style={{ color: "var(--color-text-muted)" }}>
                Last run: {new Date(conjunctionAnalysis.lastRun).toLocaleTimeString()} · {conjunctionAnalysis.results.length} conjunctions found
              </p>
            )
          )}
          {conjunctionAnalysis.source !== "safeSlot" && conjunctionAnalysis.error && (
            <div
              className="text-xs px-3 py-2 rounded-md"
              style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.3)", color: "#ff4757" }}
            >
              {conjunctionAnalysis.error}
            </div>
          )}

          {/* ── ANALYSIS TOOLS ───────────────────────────────────── */}
          <div style={{ marginTop: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", color: "#64748b", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                Analysis Tools
              </span>
              <div style={{ flex: 1, height: "1px", background: "rgba(100,116,139,0.3)" }} />
            </div>

            {/* Run Conjunction Analysis button — ALWAYS visible */}
            <button
              onClick={handleAnalyze}
              disabled={isLoading}
              className="w-full cursor-pointer transition-all duration-200 glow-pulse"
              style={{
                height: "38px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
                letterSpacing: "0.05em",
                background: isLoading ? "rgba(0, 212, 255, 0.08)" : "linear-gradient(135deg, #00d4ff 0%, #0090b3 100%)",
                color: isLoading ? "var(--color-accent)" : "#0a0a1a",
                border: isLoading ? "1px solid var(--color-border-accent)" : "none",
                opacity: isLoading ? 0.8 : 1, cursor: isLoading ? "wait" : "pointer",
                marginBottom: "14px",
              }}
              onMouseEnter={(e) => { if (!isLoading) { e.currentTarget.style.opacity = "0.9"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
              onMouseLeave={(e) => { if (!isLoading) { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateY(0)"; } }}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
                  Analyzing…
                </span>
              ) : "Run Conjunction Analysis"}
            </button>

            {/* ── Contact Window Analysis ──────────────── */}
            <div style={{ display: "flex", gap: "6px", alignItems: "stretch", marginBottom: "14px" }}>
              <button
                onClick={handleCalculateContacts}
                disabled={contactsLoading}
                className="cursor-pointer transition-all duration-200"
                style={{
                  flex: 1, height: "38px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
                  letterSpacing: "0.03em",
                  background: contactsLoading ? "rgba(46, 213, 115, 0.08)" : "linear-gradient(135deg, #2ed573 0%, #1e9c54 100%)",
                  color: contactsLoading ? "#2ed573" : "#0a0a1a",
                  border: contactsLoading ? "1px solid rgba(46, 213, 115, 0.3)" : "none",
                  opacity: contactsLoading ? 0.8 : 1, cursor: contactsLoading ? "wait" : "pointer",
                }}
                onMouseEnter={(e) => { if (!contactsLoading) { e.currentTarget.style.opacity = "0.9"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
                onMouseLeave={(e) => { if (!contactsLoading) { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateY(0)"; } }}
              >
                {contactsLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#2ed573", borderTopColor: "transparent" }} />
                    Calculating…
                  </span>
                ) : "Contact Windows"}
              </button>
              <Select
                value={predictionWindow}
                onChange={(val) => setPredictionWindow(Number(val))}
                width="100px"
                size="sm"
                accentColor="#2ed573"
                options={[
                  { value: 12, label: "12 Hours" },
                  { value: 24, label: "24 Hours" },
                  { value: 72, label: "3 Days" },
                  { value: 168, label: "7 Days" },
                ]}
              />
            </div>

            {/* Safe Slot Search */}
            <div style={{ fontSize: "14px", color: "#94a3b8", marginBottom: "8px" }}>Safe Slot Search</div>

            {/* Preset pills */}
            {(() => {
              const PRESET_SCALES = { tight: 0.33, normal: 0.67, wide: 1.0 };
              const TOLERANCE_DEFS = [
                { key: "altitude",     storeKey: "altTolerance",           label: "Altitude",      unit: "km", min: 10,    max: 150,  step: 5,     default: 50 },
                { key: "inclination",  storeKey: "inclTolerance",          label: "Inclination",   unit: "°",  min: 0.5,   max: 10,   step: 0.5,   default: 3 },
                { key: "eccentricity", storeKey: "eccentricityTolerance",  label: "Eccentricity",  unit: "",   min: 0.001, max: 0.1,  step: 0.001, default: 0.01 },
                { key: "raan",         storeKey: "raanTolerance",          label: "RAAN",          unit: "°",  min: 1,     max: 30,   step: 1,     default: 10 },
                { key: "argPerigee",   storeKey: "argPerigeeTolerance",    label: "Arg. Perigee",  unit: "°",  min: 1,     max: 30,   step: 1,     default: 10 },
                { key: "meanAnomaly",  storeKey: "meanAnomalyTolerance",   label: "Mean Anomaly",  unit: "°",  min: 1,     max: 30,   step: 1,     default: 10 },
              ];
              const unlockedDefs = TOLERANCE_DEFS.filter((d) => !orbitParamLocks[d.key]);
              const fmtVal = (d) => {
                const v = safeSlotConfig[d.storeKey] ?? d.default;
                return d.step < 1 ? `±${v}${d.unit}` : `±${v}${d.unit}`;
              };

              return (
                <>
                  <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
                    {[
                      { mode: "tight",  label: "Tight" },
                      { mode: "normal", label: "Normal" },
                      { mode: "wide",   label: "Wide" },
                    ].map((p) => {
                      const sel = safeSlotConfig.mode === p.mode;
                      const scale = PRESET_SCALES[p.mode];
                      const desc = unlockedDefs.map((d) => {
                        const v = +(d.min + (d.max - d.min) * scale).toFixed(d.step < 0.01 ? 3 : d.step < 1 ? 1 : 0);
                        return `±${v}${d.unit}`;
                      }).join(" / ");
                      return (
                        <button
                          key={p.mode}
                          onClick={() => {
                            const upd = { mode: p.mode };
                            unlockedDefs.forEach((d) => {
                              upd[d.storeKey] = +(d.min + (d.max - d.min) * scale).toFixed(d.step < 0.01 ? 3 : d.step < 1 ? 1 : 0);
                            });
                            setSafeSlotConfig(upd);
                          }}
                          style={{
                            flex: 1, minWidth: "80px", padding: "6px 4px", borderRadius: "6px",
                            fontSize: "11px", fontWeight: 600, cursor: "pointer", textAlign: "center",
                            transition: "all 0.2s",
                            background: sel ? "#0f172a" : "transparent",
                            border: sel ? "1px solid #00d4ff" : "1px solid rgba(255,255,255,0.15)",
                            color: sel ? "#ffffff" : "#64748b",
                          }}
                        >
                          <div>{p.label}</div>
                          <div style={{ fontSize: "8px", fontWeight: 400, marginTop: "2px", opacity: 0.7, lineHeight: 1.3 }}>{desc}</div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Quick mode summary */}
                  {!showAdvanced && (
                    <p style={{ fontSize: "10px", color: "#64748b", marginBottom: "8px", lineHeight: 1.4 }}>
                      Searching: {unlockedDefs.map((d) => `${d.label} ${fmtVal(d)}`).join(", ")}
                    </p>
                  )}

                  {/* Advanced toggle */}
                  <button
                    onClick={() => setShowAdvanced((v) => !v)}
                    style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: "11px", cursor: "pointer", padding: "2px 0", marginBottom: showAdvanced ? "8px" : "12px", display: "flex", alignItems: "center", gap: "4px", transition: "color 0.2s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#00d4ff"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "#94a3b8"; }}
                  >
                    Advanced {showAdvanced ? "▴" : "▾"}
                  </button>

                  {/* Advanced sliders — one per unlocked param */}
                  {showAdvanced && (
                    <div className="animate-fade-in" style={{ marginBottom: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                      {unlockedDefs.map((d) => (
                        <div key={d.key}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                            <span style={{ fontSize: "11px", color: "#94a3b8" }}>{d.label} tolerance</span>
                            <span style={{ fontSize: "11px", color: "#00d4ff", fontFamily: "var(--font-mono)" }}>
                              ±{safeSlotConfig[d.storeKey] ?? d.default}{d.unit}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={d.min} max={d.max} step={d.step}
                            value={safeSlotConfig[d.storeKey] ?? d.default}
                            onChange={(e) => setSafeSlotConfig({ [d.storeKey]: parseFloat(e.target.value) })}
                            style={{ width: "100%", accentColor: "#00d4ff", height: "4px", cursor: "pointer" }}
                          />
                        </div>
                      ))}
                      <div style={{ fontSize: "11px", color: "#64748b", textAlign: "center" }}>
                        ~{Math.min(200, unlockedDefs.reduce((acc, d) => acc * Math.max(1, Math.round(((safeSlotConfig[d.storeKey] ?? d.default) * 2) / d.step)), 1))} slots to evaluate
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Find Safer Slots button */}
            <button
              onClick={handleFindSaferSlots}
              disabled={safeSlotAnalysis.loading}
              className="w-full cursor-pointer transition-all duration-200"
              style={{
                height: "38px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
                letterSpacing: "0.05em",
                background: safeSlotAnalysis.loading ? "rgba(15, 76, 117, 0.5)" : "#0f4c75",
                color: "#ffffff",
                border: "1px solid #00d4ff",
                opacity: safeSlotAnalysis.loading ? 0.7 : 1,
                cursor: safeSlotAnalysis.loading ? "wait" : "pointer",
              }}
              onMouseEnter={(e) => { if (!safeSlotAnalysis.loading) { e.currentTarget.style.opacity = "0.9"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
              onMouseLeave={(e) => { if (!safeSlotAnalysis.loading) { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateY(0)"; } }}
            >
              {safeSlotAnalysis.loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#00d4ff", borderTopColor: "transparent" }} />
                  Searching...
                </span>
              ) : "Find Safer Slots"}
            </button>
          </div>

          {/* Divider */}
          <hr className="shrink-0" style={{ borderColor: "var(--color-border)", marginTop: "8px" }} />

          {/* ── Ground Station Manager ────────────────── */}
          <div className="flex flex-col shrink-0" style={{ paddingLeft: "4px" }}>
            <div className="flex items-center justify-between mb-2 shrink-0">
              <Label style={{ margin: 0 }}>Ground stations</Label>
              <span className="text-xs font-mono" style={{ color: "var(--color-text-muted)" }}>
                {stations.filter((s) => s.visible).length}/{stations.length}
              </span>
            </div>

            <div className="flex flex-col gap-0 mb-2">
              {stations.map((gs, idx) => (
                <div key={gs.id}>
                  {editingId === gs.id ? (
                    <div
                      className="rounded-md p-2 flex flex-col gap-1.5"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--color-border-accent)" }}
                    >
                      <MiniInput placeholder="Name" value={formData.name} onChange={(v) => setFormData((f) => ({ ...f, name: v }))} error={formErrors.name} />
                      <div className="flex gap-1">
                        <MiniInput placeholder="Lat" value={formData.lat} onChange={(v) => setFormData((f) => ({ ...f, lat: v }))} error={formErrors.lat} />
                        <MiniInput placeholder="Lon" value={formData.lon} onChange={(v) => setFormData((f) => ({ ...f, lon: v }))} error={formErrors.lon} />
                      </div>
                      <div className="flex gap-1">
                        <MiniInput placeholder="Alt (km)" value={formData.alt} onChange={(v) => setFormData((f) => ({ ...f, alt: v }))} error={formErrors.alt} />
                        <MiniInput placeholder="Elev Mask (°)" value={formData.elevationMask} onChange={(v) => setFormData((f) => ({ ...f, elevationMask: v }))} error={formErrors.elevationMask} />
                      </div>
                      <div className="flex gap-1">
                        <SmallBtn onClick={handleSaveEdit} accent>Save</SmallBtn>
                        <SmallBtn onClick={cancelEdit}>Cancel</SmallBtn>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-2 rounded-md px-2 group"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid transparent",
                        opacity: gs.visible ? 1 : 0.45,
                        transition: "all 0.15s ease",
                        padding: "6px 8px",
                        borderBottom: idx < stations.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; if (idx < stations.length - 1) e.currentTarget.style.borderBottom = "1px solid rgba(255,255,255,0.06)"; }}
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: gs.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                          {gs.name}
                        </div>
                        <div className="font-mono" style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                          {gs.lat.toFixed(2)}°, {gs.lon.toFixed(2)}° · {gs.elevationMask ?? 10}° mask
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0 items-center">
                        <IconBtn title={gs.visible ? "Hide" : "Show"} onClick={() => handleToggleVisibility(gs.id)}>
                          {gs.visible ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
                        </IconBtn>
                        <IconBtn title="Edit" onClick={() => startEdit(gs)}><EditIcon size={13} /></IconBtn>
                        <IconBtn title="Delete" onClick={() => handleDelete(gs.id)}><TrashIcon size={13} /></IconBtn>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {showAddForm ? (
              <div
                className="rounded-md p-2 flex flex-col gap-1.5 animate-fade-in"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--color-border-accent)" }}
              >
                <MiniInput placeholder="Station name" value={formData.name} onChange={(v) => setFormData((f) => ({ ...f, name: v }))} error={formErrors.name} />
                <div className="flex gap-1">
                  <MiniInput placeholder="Lat (-90…90)" value={formData.lat} onChange={(v) => setFormData((f) => ({ ...f, lat: v }))} error={formErrors.lat} />
                  <MiniInput placeholder="Lon (-180…180)" value={formData.lon} onChange={(v) => setFormData((f) => ({ ...f, lon: v }))} error={formErrors.lon} />
                </div>
                <div className="flex gap-1">
                  <MiniInput placeholder="Altitude (km)" value={formData.alt} onChange={(v) => setFormData((f) => ({ ...f, alt: v }))} error={formErrors.alt} />
                  <MiniInput placeholder="Elev Mask (°)" value={formData.elevationMask} onChange={(v) => setFormData((f) => ({ ...f, elevationMask: v }))} error={formErrors.elevationMask} />
                </div>
                <div style={{ fontSize: "9px", color: "#64748b", lineHeight: 1.3, marginTop: "-2px" }}>
                  Min elevation: 0° – 90°. Recommended 5° – 15° for terrain & refraction.
                </div>
                <div className="flex gap-1">
                  <SmallBtn onClick={handleAdd} accent>Add</SmallBtn>
                  <SmallBtn onClick={() => { setShowAddForm(false); setFormErrors({}); setFormData({ name: "", lat: "", lon: "", alt: "", elevationMask: "10" }); }}>
                    Cancel
                  </SmallBtn>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setShowAddForm(true); setEditingId(null); setFormData({ name: "", lat: "", lon: "", alt: "", elevationMask: "10" }); setFormErrors({}); }}
                className="w-full cursor-pointer transition-all duration-200"
                style={{
                  height: "34px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
                  background: "#0f4c75", color: "#ffffff", border: "1px solid #00d4ff",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.9"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
              >
                <span className="flex items-center justify-center gap-1.5"><PlusIcon size={13} /> Add station</span>
              </button>
            )}
          </div>

        </div> {/* End SCROLLABLE Content Area */}

      </aside>

      {/* Edge toggle button (visible when collapsed) */}
      <button
        id="orbit-input-toggle"
        className="fixed z-40 flex items-center justify-center cursor-pointer transition-all duration-300"
        style={{
          top: "50%",
          left: collapsed ? "0" : "320px",
          transform: "translateY(-50%)",
          width: "20px",
          height: "56px",
          background: "rgba(22, 33, 62, 0.96)",
          border: "1px solid var(--color-border)",
          borderLeft: collapsed ? "1px solid var(--color-border)" : "none",
          borderRadius: "0 8px 8px 0",
          color: "var(--color-text-secondary)",
          fontSize: "12px",
        }}
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? "Open mission config" : "Close mission config"}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--color-accent)";
          e.currentTarget.style.borderColor = "var(--color-border-accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--color-text-secondary)";
          e.currentTarget.style.borderColor = "var(--color-border)";
        }}
      >
        {collapsed ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
      </button>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * Helper Components
 * ═══════════════════════════════════════════════════════════════════ */

function Label({ children, style }) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        fontSize: "11px",
        fontWeight: 500,
        letterSpacing: "0.05em",
        color: "rgba(255,255,255,0.6)",
        textTransform: "uppercase",
        marginBottom: "4px",
        ...style
      }}
    >
      {children}
    </label>
  );
}


function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.1em",
        color: "#00d4ff",
        textTransform: "uppercase",
        borderBottom: "1px solid rgba(0,212,255,0.2)",
        paddingBottom: "4px",
        marginBottom: "10px",
      }}
    >
      {children}
    </div>
  );
}

function MiniInput({ placeholder, value, onChange, error }) {
  return (
    <div className="flex-1">
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded px-2 py-1 text-xs"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${error ? "var(--color-danger)" : "var(--color-border)"}`,
          color: "var(--color-text-primary)",
          outline: "none",
        }}
      />
      {error && (
        <div className="text-[9px] mt-0.5" style={{ color: "var(--color-danger)" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function IconBtn({ children, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center rounded text-sm cursor-pointer transition-colors duration-150"
      style={{
        background: "transparent",
        border: "none",
        color: "var(--color-text-muted)",
        padding: 0,
        lineHeight: 1,
        width: "28px",
        height: "28px",
        minWidth: "28px",
        minHeight: "28px",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-accent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-muted)"; }}
    >
      {children}
    </button>
  );
}

function SmallBtn({ children, onClick, accent }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 py-1 rounded text-xs font-medium cursor-pointer transition-all duration-150"
      style={{
        background: accent
          ? "linear-gradient(135deg, #00d4ff 0%, #0090b3 100%)"
          : "rgba(255,255,255,0.06)",
        color: accent ? "#0a0a1a" : "var(--color-text-secondary)",
        border: accent ? "none" : "1px solid var(--color-border)",
      }}
    >
      {children}
    </button>
  );
}
