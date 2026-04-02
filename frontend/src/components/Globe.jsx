import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import {
  Ion,
  Viewer,
  Cartesian2,
  Cartesian3,
  IonImageryProvider,
  TileMapServiceImageryProvider,
  buildModuleUrl,
  PointPrimitiveCollection,
  BillboardCollection,
  LabelCollection,
  Color,
  NearFarScalar,
  VerticalOrigin,
  HorizontalOrigin,
  LabelStyle,
  HeadingPitchRange,
  Math as CesiumMath,
  PolylineDashMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from "cesium";
import * as satellite from "satellite.js";

import useSatguardStore from "../store/satguardStore";
import { parseTLE, propagatePosition } from "../utils/propagator";
import { getStations } from "../utils/groundStations";

/* ── Default camera destination: India ────────────────────────── */
const INDIA_VIEW = Cartesian3.fromDegrees(78.9629, 20.5937, 25000000);

/* ── Cesium Ion Token ─────────────────────────────────────────── */
Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_TOKEN || "";

/* ── Exported viewer reference for other components ───────────── */
export let viewerRef = null;

/* ── Constants ────────────────────────────────────────────────── */
const SAT_COLOR_CYAN = Color.fromCssColorString("#00d4ff");
const SAT_DISPLAY_COUNT = 100;   // points rendered on the globe
const SAT_CATALOG_MAX = 10_000;  // parse up to 10k for conjunction screening (perf limit)

// 3-tier LOD thresholds (camera height in metres)
const LOD_HIGH_ALT = 10_000_000; // >10 000 km → 1px static dots
const LOD_MID_ALT  =  2_000_000; // 2 000–10 000 km → 2px
                                  // <2 000 km → 3px + cyan halo
const SAT_SIZE_FAR  = 1;
const SAT_SIZE_MID  = 2;
const SAT_SIZE_NEAR = 3;

/**
 * Create a pin marker canvas for ground stations.
 */
function createStationMarkerCanvas(color = "#00d4ff", size = 24) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size + 8;
  const ctx = canvas.getContext("2d");

  // Pin circle
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Pin stem
  ctx.beginPath();
  ctx.moveTo(size / 2 - 3, size - 2);
  ctx.lineTo(size / 2, size + 6);
  ctx.lineTo(size / 2 + 3, size - 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Inner dot
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  return canvas;
}

/**
 * Parse raw TLE text into satellite records.
 * TLE 3LE format: name line, then line 1, then line 2 — repeating.
 */
function parseTLEData(rawTLE, maxCount = Infinity) {
  if (!rawTLE) return [];
  const lines = rawTLE.split("\n").map((l) => l.trim()).filter(Boolean);
  const satellites = [];

  for (let i = 0; i < lines.length - 2 && satellites.length < maxCount; i += 3) {
    try {
      // Space-Track 3LE prefixes name with "0 " — strip it
      let name = lines[i];
      if (name.startsWith("0 ")) name = name.slice(2);
      const tle1 = lines[i + 1];
      const tle2 = lines[i + 2];
      if (!tle1?.startsWith("1 ") || !tle2?.startsWith("2 ")) continue;
      const satrec = parseTLE(tle1, tle2);
      if (satrec && satrec.error === 0) {
        satellites.push({ name, tle1, tle2, satrec });
      }
    } catch {
      // Skip malformed TLE triplets
      continue;
    }
  }
  console.log(`[SatGuard] Parsed ${satellites.length} satellites from TLE data (${lines.length} lines)`);
  return satellites;
}

/**
 * Globe.jsx — Full-screen CesiumJS 3D Earth viewer
 *
 * Renders:
 *   • ~100 satellites as PointPrimitiveCollection (high perf)
 *   • Ground stations as BillboardCollection + LabelCollection
 *   • LOD: satellites resize based on camera distance
 *   • Positions update every second based on Zustand simTime
 */
export default function Globe() {
  const containerRef = useRef(null);
  const viewerInstanceRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [webglError, setWebglError] = useState(false);

  // Refs for Cesium primitives (managed outside React render)
  const satPointsRef = useRef(null);
  const satDataRef = useRef([]);
  const gsBillboardsRef = useRef(null);
  const gsLabelsRef = useRef(null);
  const rafIdRef = useRef(null);           // requestAnimationFrame ID
  const cameraListenerRef = useRef(null);  // camera.changed removal fn
  const markerCacheRef = useRef({});
  const [initComplete, setInitComplete] = useState(false); // gates TLE effect
  const bplaneCleanupRef = useRef([]);     // B-plane geometry/label entities (cleared on conj. change)
  const bplaneOrbitRef = useRef([]);       // B-plane orbit arc entities (separate from above)
  const targetOrbitLineRef = useRef([]);   // Target orbit preview entities; always shown
  const screenSpaceHandlerRef = useRef(null); // ScreenSpaceEventHandler for hover

  // Hover label overlay state
  const [hoverLabel, setHoverLabel] = useState({ visible: false, name: "", x: 0, y: 0 });

  // Zustand
  const tleData = useSatguardStore((s) => s.tleData);
  const setCesiumReady = useSatguardStore((s) => s.setCesiumReady);
  const setSimTime = useSatguardStore((s) => s.setSimTime);
  const setParsedSatellites = useSatguardStore((s) => s.setParsedSatellites);
  const selectedConjunction = useSatguardStore((s) => s.selectedConjunction);
  const simTime = useSatguardStore((s) => s.simTime);
  const targetOrbitParams = useSatguardStore((s) => s.targetOrbitParams);
  const previewOrbitParams = useSatguardStore((s) => s.previewOrbitParams);
  const effectiveOrbitParams = previewOrbitParams || targetOrbitParams;
  const conjunctionSource = useSatguardStore((s) => s.conjunctionAnalysis.source);
  const missionEpoch = useSatguardStore((s) => s.missionEpoch);

  /* ── Get or create a marker canvas for a given color ─────────── */
  const getMarkerCanvas = useCallback((color) => {
    if (!markerCacheRef.current[color]) {
      markerCacheRef.current[color] = createStationMarkerCanvas(color, 24);
    }
    return markerCacheRef.current[color];
  }, []);

  /* ── Helper: render ground stations on the globe ─────────────── */
  const renderGroundStations = useCallback(() => {
    const viewer = viewerInstanceRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    // Remove old primitives
    if (gsBillboardsRef.current) {
      try { viewer.scene.primitives.remove(gsBillboardsRef.current); } catch { /* already removed */ }
      gsBillboardsRef.current = null;
    }
    if (gsLabelsRef.current) {
      try { viewer.scene.primitives.remove(gsLabelsRef.current); } catch { /* already removed */ }
      gsLabelsRef.current = null;
    }

    const stations = getStations();
    const billboards = new BillboardCollection();
    const labels = new LabelCollection();

    stations.forEach((gs) => {
      if (!gs.visible) return;

      const position = Cartesian3.fromDegrees(gs.lon, gs.lat, gs.alt * 1000);

      billboards.add({
        position,
        image: getMarkerCanvas(gs.color || "#00d4ff"),
        verticalOrigin: VerticalOrigin.BOTTOM,
        width: 24,
        height: 32,
        scale: 0.6,
        scaleByDistance: new NearFarScalar(1e3, 0.8, 1e7, 0.4),
      });

      labels.add({
        position,
        text: gs.name,
        font: "18px Inter, sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        horizontalOrigin: HorizontalOrigin.CENTER,
        pixelOffset: new Cartesian2(0, -20),
        scaleByDistance: new NearFarScalar(1.5e6, 1.2, 1.5e8, 0.4),
        translucencyByDistance: new NearFarScalar(1.5e7, 1.0, 1.5e8, 0.6),
        showBackground: true,
        backgroundColor: new Color(0.04, 0.04, 0.1, 0.85),
        backgroundPadding: new Cartesian2(8, 5),
      });
    });

    viewer.scene.primitives.add(billboards);
    viewer.scene.primitives.add(labels);
    gsBillboardsRef.current = billboards;
    gsLabelsRef.current = labels;
    console.log(`[SatGuard] Rendered ${stations.filter((s) => s.visible).length} ground stations`);
  }, [getMarkerCanvas]);

  /* ── Main viewer init effect ─────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;

    // ── WebGL check ──────────────────────────────────────────────
    const testCanvas = document.createElement("canvas");
    const gl =
      testCanvas.getContext("webgl") ||
      testCanvas.getContext("experimental-webgl");
    if (!gl) {
      setWebglError(true);
      return;
    }

    // Prevent StrictMode re-init while first async IIFE is still running
    // by tracking destruction explicitly
    let destroyed = false;
    let viewer;

    (async () => {
      /* 1. Create viewer */
      viewer = new Viewer(containerRef.current, {
        imageryProvider: false,
        timeline: false,
        animation: false,
        geocoder: false,
        homeButton: false,
        baseLayerPicker: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        fullscreenButton: false,
        vrButton: false,
        infoBox: false,
        selectionIndicator: false,
      });

      viewer.cesiumWidget.creditContainer.style.display = "none";
      viewer.scene.screenSpaceCameraController.minimumZoomDistance = 200000;
      viewer.scene.screenSpaceCameraController.maximumZoomDistance = 200000000;

      /* ── Atmosphere & visual polish ─────────────────────────── */
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.globe.showGroundAtmosphere = true;
      viewer.scene.globe.enableLighting = true;

      /* 2. Imagery */
      let provider;
      try {
        provider = await IonImageryProvider.fromAssetId(2);
      } catch (err) {
        console.warn("Ion imagery failed, using local NaturalEarthII:", err);
        try {
          provider = await TileMapServiceImageryProvider.fromUrl(
            buildModuleUrl("Assets/Textures/NaturalEarthII")
          );
        } catch (err2) {
          console.error("All imagery providers failed:", err2);
        }
      }

      // ─── StrictMode guard: if cleanup ran while we awaited, bail out ───
      if (destroyed || viewer.isDestroyed()) {
        if (!viewer.isDestroyed()) viewer.destroy();
        console.log("[SatGuard] Init aborted — viewer was destroyed during async init (StrictMode)");
        return;
      }

      // Only now commit the viewer to refs
      viewerInstanceRef.current = viewer;
      viewerRef = viewer;

      if (provider) {
        viewer.imageryLayers.addImageryProvider(provider);
      }

      /* 3. Fly to India */
      viewer.camera.flyTo({ destination: INDIA_VIEW, duration: 0 });

      /* 4. Detect tile load */
      const removeListener =
        viewer.scene.globe.tileLoadProgressEvent.addEventListener(
          (remaining) => {
            if (remaining === 0) {
              setLoaded(true);
              removeListener();
            }
          }
        );

      /* 5. Create satellite PointPrimitiveCollection */
      const satPoints = new PointPrimitiveCollection();
      viewer.scene.primitives.add(satPoints);
      satPointsRef.current = satPoints;
      console.log("[SatGuard] PointPrimitiveCollection created and added to scene");

      /* ── Camera LOD listener (event-driven, not per-tick) ──── */
      viewer.camera.percentageChanged = 0.05; // fire only on meaningful moves
      const onCameraChanged = () => {
        const sp = satPointsRef.current;
        if (!sp) return;
        const height = viewer.camera.positionCartographic?.height ?? Infinity;

        let pixelSize, showOutline;
        if (height > LOD_HIGH_ALT) {
          pixelSize = SAT_SIZE_FAR;   // 1px
          showOutline = false;
        } else if (height > LOD_MID_ALT) {
          pixelSize = SAT_SIZE_MID;   // 2px
          showOutline = false;
        } else {
          pixelSize = SAT_SIZE_NEAR;  // 3px + cyan halo
          showOutline = true;
        }

        for (let i = 0; i < sp.length; i++) {
          const pt = sp.get(i);
          if (!pt) continue;
          pt.pixelSize = pixelSize;
          pt.outlineColor = SAT_COLOR_CYAN;
          pt.outlineWidth = showOutline ? 2 : 0;
        }
      };
      cameraListenerRef.current = viewer.camera.changed.addEventListener(onCameraChanged);
      // Run once immediately so initial zoom level is correct
      onCameraChanged();

      /* 6. Render ground stations */
      try {
        renderGroundStations();
      } catch (err) {
        console.error("[SatGuard] Ground station render failed:", err);
      }

      /* 7. Mark init complete */
      setInitComplete(true);
      setCesiumReady(true);
      console.log("[SatGuard] Viewer init complete");
    })();

    return () => {
      destroyed = true;
      // Cancel rAF loop
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      // Remove camera.changed listener
      if (cameraListenerRef.current) {
        cameraListenerRef.current();
        cameraListenerRef.current = null;
      }
      if (viewer && !viewer.isDestroyed()) {
        viewer.destroy();
      }
      viewerInstanceRef.current = null;
      viewerRef = null;
      satPointsRef.current = null;
      setInitComplete(false);
      useSatguardStore.getState().setCesiumReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Parse TLE when data arrives ─────────────────────────────── */
  useEffect(() => {
    if (!tleData.satellites || tleData.loading) return;
    if (!initComplete) {
      console.log("[SatGuard] TLE data arrived but viewer init not complete yet — will retry when ready");
      return;
    }

    // Parse ALL satellites for the conjunction screening catalog
    const fullCatalog = parseTLEData(tleData.satellites, SAT_CATALOG_MAX);
    setParsedSatellites(fullCatalog);

    // Use only the first SAT_DISPLAY_COUNT for globe rendering (performance)
    const displaySet = fullCatalog.slice(0, SAT_DISPLAY_COUNT);
    satDataRef.current = displaySet;
    console.log(`[SatGuard] Full catalog: ${fullCatalog.length} · Globe display: ${displaySet.length}`);

    const satPoints = satPointsRef.current;
    if (!satPoints) {
      console.warn("[SatGuard] satPointsRef is null — cannot add satellite points");
      return;
    }

    // Clear existing points and add fresh ones
    satPoints.removeAll();
    displaySet.forEach(() => {
      satPoints.add({
        position: Cartesian3.ZERO,
        pixelSize: SAT_SIZE_NEAR,
        color: SAT_COLOR_CYAN,
        show: false,
      });
    });
    console.log(`[SatGuard] Added ${displaySet.length} point primitives to collection`);

    // ── Immediately run first propagation + start rAF loop ────────
    const viewer = viewerInstanceRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    // Cancel any existing rAF loop
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    /** Propagate all satellite positions (no LOD — that's on camera.changed) */
    function propagateAll() {
      const sats = satDataRef.current;
      if (sats.length === 0) return 0;

      const v = viewerInstanceRef.current;
      if (!v || v.isDestroyed()) return 0;

      const currentTime = new Date();
      setSimTime(currentTime);

      let successCount = 0;
      for (let i = 0; i < sats.length; i++) {
        const sp = satPointsRef.current;
        if (!sp) return successCount;
        const point = sp.get(i);
        if (!point) continue;

        const pos = propagatePosition(sats[i].satrec, currentTime);
        if (pos && isFinite(pos.lat) && isFinite(pos.lon) && isFinite(pos.alt)) {
          point.position = Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt * 1000);
          point.show = true;
          successCount++;
        } else {
          point.show = false;
        }
      }
      return successCount;
    }

    const firstCount = propagateAll();
    console.log(`[SatGuard] First propagation: ${firstCount}/${displaySet.length} satellites positioned successfully`);

    // rAF loop — propagate at ~1 Hz (every 1000ms), synced with render
    let lastPropTime = performance.now();
    function tick(now) {
      if (now - lastPropTime >= 1000) {
        propagateAll();
        lastPropTime = now;
      }
      rafIdRef.current = requestAnimationFrame(tick);
    }
    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [tleData.satellites, tleData.loading, initComplete, setSimTime, setParsedSatellites]);

  /* ── Listen for ground station changes ───────────────────────── */
  useEffect(() => {
    const handler = () => renderGroundStations();
    window.addEventListener("groundStationsChanged", handler);
    return () => window.removeEventListener("groundStationsChanged", handler);
  }, [renderGroundStations]);

  /* ── CONTEXT 1: Target orbit ground-track preview ─────────────── */
  useEffect(() => {
    const viewer = viewerInstanceRef.current;
    if (!viewer || viewer.isDestroyed() || !initComplete) return;

    // Remove previous target orbit entities
    for (const ent of targetOrbitLineRef.current) {
      try { viewer.entities.remove(ent); } catch { /* already gone */ }
    }
    targetOrbitLineRef.current = [];

    const { altitude, inclination, eccentricity, raan, argPerigee, meanAnomaly, orbitCount = 1 } = effectiveOrbitParams;

    // Build synthetic TLE (reuse OrbitInput's logic)
    const MU = 398600.4418;
    const R_EARTH = 6371.0;
    const a = R_EARTH + altitude;
    const n_rad_s = Math.sqrt(MU / (a * a * a));
    const n_rev_day = n_rad_s * 86400 / (2 * Math.PI);
    const now = missionEpoch;  // Use global mission epoch — NOT new Date()
    const yr2 = String(now.getUTCFullYear()).slice(-2);
    const jan1 = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const dayOfYear = (now - jan1) / 86400000 + 1;
    const epochStr = `${yr2}${dayOfYear.toFixed(8).padStart(12, " ")}`;
    const eccStr = eccentricity.toFixed(7).replace("0.", "").padStart(7, "0");
    const tle1 = `1 99999U 25001A   ${epochStr}  .00000000  00000-0  00000-0 0  9990`;
    const tle2 = `2 99999 ${inclination.toFixed(4).padStart(8)} ${raan.toFixed(4).padStart(8)} ${eccStr} ${argPerigee.toFixed(4).padStart(8)} ${meanAnomaly.toFixed(4).padStart(8)} ${n_rev_day.toFixed(8).padStart(11)}    10`;

    let satrec;
    try {
      satrec = satellite.twoline2satrec(tle1.trim(), tle2.trim());
      if (!satrec || satrec.error !== 0) {
        console.warn("[TargetOrbit] TLE parse error:", satrec?.error);
        return;
      }
    } catch (err) {
      console.warn("[TargetOrbit] TLE parse exception:", err);
      return;
    }

    // Propagate orbitCount full orbits: 60 points per orbit at 96s intervals (~96 min per orbit)
    const PREVIEW_STEPS = orbitCount * 60;
    const PREVIEW_INTERVAL_S = 96; // seconds between points
    const path = [];
    for (let i = 0; i < PREVIEW_STEPS; i++) {
      const t = new Date(now.getTime() + i * PREVIEW_INTERVAL_S * 1000);
      const pv = satellite.propagate(satrec, t);
      if (!pv.position || pv.position === false) continue;
      const gmst = satellite.gstime(t);
      const geo = satellite.eciToGeodetic(pv.position, gmst);
      const lat = satellite.degreesLat(geo.latitude);
      const lon = satellite.degreesLong(geo.longitude);
      const alt = geo.height * 1000; // km → m
      if (isFinite(lat) && isFinite(lon) && isFinite(alt)) {
        path.push(Cartesian3.fromDegrees(lon, lat, alt));
      }
    }

    if (path.length < 2) return;

    // Render solid cyan polyline
    const lineEntity = viewer.entities.add({
      name: "orbit:target",
      polyline: {
        positions: path,
        width: 2,
        material: Color.fromCssColorString("#00d4ff"),
        clampToGround: false,
      },
    });
    targetOrbitLineRef.current.push(lineEntity);

    // Label "Target Orbit" at the first point
    const labelEntity = viewer.entities.add({
      name: "orbit:target:label",
      position: path[0],
      label: {
        text: "Target Orbit",
        font: "12px Inter, sans-serif",
        fillColor: Color.fromCssColorString("#00d4ff"),
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        horizontalOrigin: HorizontalOrigin.LEFT,
        pixelOffset: new Cartesian2(6, -4),
        showBackground: true,
        backgroundColor: new Color(0, 0.08, 0.12, 0.75),
        backgroundPadding: new Cartesian2(6, 4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    targetOrbitLineRef.current.push(labelEntity);

    // If a conjunction is currently selected (B-plane overlay active),
    // hide these new orbit entities to avoid visual overlap
    if (useSatguardStore.getState().selectedConjunction) {
      for (const ent of targetOrbitLineRef.current) {
        try { ent.show = false; } catch { /* noop */ }
      }
    }
    console.log("[TargetOrbit] Ground track rendered:", path.length, "points");
  }, [effectiveOrbitParams, missionEpoch, initComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Hover interaction (ScreenSpaceEventHandler) ──────────────── */
  useEffect(() => {
    if (!initComplete) return;
    const viewer = viewerInstanceRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    screenSpaceHandlerRef.current = handler;

    handler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.endPosition);
      if (picked && picked.id && picked.id.name &&
          (picked.id.name.startsWith("orbit:") || picked.id.name.startsWith("bplane-orbit:"))) {
        // Map entity name to display name
        let displayName = picked.id.name;
        if (displayName === "orbit:target") displayName = "Target Orbit";
        else if (displayName.startsWith("bplane-orbit:mysat")) displayName = "MY-SAT orbit";
        else if (displayName.startsWith("bplane-orbit:secondary:")) {
          displayName = displayName.replace("bplane-orbit:secondary:", "");
        }

        // Convert Cesium 2D screen pos to DOM coordinates
        const canvas = viewer.scene.canvas;
        const rect = canvas.getBoundingClientRect();
        setHoverLabel({
          visible: true,
          name: displayName,
          x: movement.endPosition.x + rect.left,
          y: movement.endPosition.y + rect.top,
        });
      } else {
        setHoverLabel({ visible: false, name: "", x: 0, y: 0 });
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    return () => {
      if (!handler.isDestroyed()) handler.destroy();
      screenSpaceHandlerRef.current = null;
    };
  }, [initComplete]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    const viewer = viewerInstanceRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    // ── Cleanup previous B-plane entities (geometry + labels) ────────
    const oldItems = bplaneCleanupRef.current;
    for (const item of oldItems) {
      try { viewer.entities.remove(item); } catch { /* already removed */ }
    }
    bplaneCleanupRef.current = [];

    // ── Cleanup previous B-plane orbit arc entities ───────────────────
    for (const item of bplaneOrbitRef.current) {
      try { viewer.entities.remove(item); } catch { /* already removed */ }
    }
    bplaneOrbitRef.current = [];

    // FIX 1: Restore target orbit preview visibility when conjunction is cleared
    if (!selectedConjunction) {
      for (const ent of targetOrbitLineRef.current) {
        try { ent.show = true; } catch { /* noop */ }
      }
      return;
    }

    // Hide target orbit preview to avoid duplicate blue line with B-plane primary arc
    for (const ent of targetOrbitLineRef.current) {
      try { ent.show = false; } catch { /* noop */ }
    }

    const conj = selectedConjunction;
    const { position1_ECI, position2_ECI, vRel_ECI } = conj;

    // Guard: skip B-plane geometry if ECI data is missing (e.g. lightweight conjunction details)
    if (!position1_ECI || !position2_ECI || !vRel_ECI) {
      console.warn("[B-plane] Conjunction missing ECI data; skipping B-plane geometry.");
      return;
    }

    // ── Helper: ECI {x,y,z} (km) → Cesium Cartesian3 ────────────
    function eciToCartesian3(eci, tcaDate) {
      const gmst = satellite.gstime(tcaDate);
      const geo = satellite.eciToGeodetic(
        { x: eci.x, y: eci.y, z: eci.z },
        gmst
      );
      const latDeg = satellite.degreesLat(geo.latitude);
      const lonDeg = satellite.degreesLong(geo.longitude);
      const altM = geo.height * 1000; // km → m
      return Cartesian3.fromDegrees(lonDeg, latDeg, altM);
    }

    const tcaDate = new Date(conj.tca_iso_string);
    const pos1C3 = eciToCartesian3(position1_ECI, tcaDate);
    const pos2C3 = eciToCartesian3(position2_ECI, tcaDate);
    const midpoint = new Cartesian3(
      (pos1C3.x + pos2C3.x) / 2,
      (pos1C3.y + pos2C3.y) / 2,
      (pos1C3.z + pos2C3.z) / 2
    );

    // ── 1. Camera fly-to ─────────────────────────────────────────
    viewer.camera.flyTo({
      destination: pos1C3,
      duration: 2.0,
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-45), 500000),
    });

    // ── 2. Encounter plane (Primitive + modelMatrix) ─────────────
    // B-plane basis vectors from vRel_ECI
    const vRelMag = Math.sqrt(vRel_ECI.x ** 2 + vRel_ECI.y ** 2 + vRel_ECI.z ** 2);
    const z_hat = { x: vRel_ECI.x / vRelMag, y: vRel_ECI.y / vRelMag, z: vRel_ECI.z / vRelMag };

    // r_rel = pos2 - pos1 (in ECI km)
    const rRel = {
      x: position2_ECI.x - position1_ECI.x,
      y: position2_ECI.y - position1_ECI.y,
      z: position2_ECI.z - position1_ECI.z,
    };
    // x_hat = normalize(r_rel × z_hat)
    const cross = {
      x: rRel.y * z_hat.z - rRel.z * z_hat.y,
      y: rRel.z * z_hat.x - rRel.x * z_hat.z,
      z: rRel.x * z_hat.y - rRel.y * z_hat.x,
    };
    const crossMag = Math.sqrt(cross.x ** 2 + cross.y ** 2 + cross.z ** 2);
    const x_hat = crossMag > 1e-12
      ? { x: cross.x / crossMag, y: cross.y / crossMag, z: cross.z / crossMag }
      : { x: 1, y: 0, z: 0 }; // fallback if parallel
    // y_hat = z_hat × x_hat
    const y_hat = {
      x: z_hat.y * x_hat.z - z_hat.z * x_hat.y,
      y: z_hat.z * x_hat.x - z_hat.x * x_hat.z,
      z: z_hat.x * x_hat.y - z_hat.y * x_hat.x,
    };

    // ── Helper: generate ellipse vertices in the B-plane ────────
    // CesiumJS EllipseGeometry requires center on the ellipsoid surface
    // (it calls geodeticSurfaceNormal internally). For an arbitrarily-
    // oriented plane in space we must build polygon vertices manually.
    function bplaneEllipseVerts(center3, semiA, semiB, segments = 64) {
      const verts = [];
      for (let i = 0; i < segments; i++) {
        const theta = (2 * Math.PI * i) / segments;
        const dx = semiA * Math.cos(theta); // along x_hat
        const dy = semiB * Math.sin(theta); // along y_hat
        verts.push(new Cartesian3(
          center3.x + x_hat.x * dx + y_hat.x * dy,
          center3.y + x_hat.y * dx + y_hat.y * dy,
          center3.z + x_hat.z * dx + y_hat.z * dy,
        ));
      }
      return verts;
    }

    // Encounter plane fill (polygon)
    try {
      const planeVerts = bplaneEllipseVerts(midpoint, 50000, 50000, 72);
      const planeEntity = viewer.entities.add({
        polygon: {
          hierarchy: planeVerts,
          material: Color.CYAN.withAlpha(0.15),
          perPositionHeight: true,
        },
      });
      planeEntity._type = "entity";
      bplaneCleanupRef.current.push(planeEntity);

      // Encounter plane outline (polyline loop)
      const outlineVerts = [...planeVerts, planeVerts[0]]; // close the loop
      const outlineEntity = viewer.entities.add({
        polyline: {
          positions: outlineVerts,
          width: 1.5,
          material: Color.CYAN,
        },
      });
      outlineEntity._type = "entity";
      bplaneCleanupRef.current.push(outlineEntity);
    } catch (err) {
      console.warn("[B-plane] Encounter plane render failed:", err);
    }

    // ── 3. Miss vector polyline ──────────────────────────────────
    const missLine = viewer.entities.add({
      polyline: {
        positions: [pos1C3, pos2C3],
        width: 2,
        material: Color.WHITE,
      },
    });
    missLine._type = "entity";
    bplaneCleanupRef.current.push(missLine);

    // Miss label at midpoint
    const missLabel = viewer.entities.add({
      position: midpoint,
      label: {
        text: `Miss: ${conj.miss_distance_km.toFixed(2)} km`,
        font: "14pt sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        horizontalOrigin: HorizontalOrigin.CENTER,
        pixelOffset: new Cartesian2(0, -20),
        showBackground: true,
        backgroundColor: new Color(0.04, 0.04, 0.1, 0.85),
        backgroundPadding: new Cartesian2(8, 5),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    missLabel._type = "entity";
    bplaneCleanupRef.current.push(missLabel);

    // ── 4. Uncertainty ellipse ───────────────────────────────────
    const sigmaT = (conj.sigma_T_km || 5) * 1000; // km → m
    const sigmaN = (conj.sigma_N_km || 0.5) * 1000;
    try {
      const uncertVerts = bplaneEllipseVerts(
        pos2C3,
        Math.max(sigmaT, sigmaN),
        Math.min(sigmaT, sigmaN),
        48
      );
      const uncertEntity = viewer.entities.add({
        polygon: {
          hierarchy: uncertVerts,
          material: Color.ORANGE.withAlpha(0.3),
          perPositionHeight: true,
        },
      });
      uncertEntity._type = "entity";
      bplaneCleanupRef.current.push(uncertEntity);
    } catch (err) {
      console.warn("[B-plane] Uncertainty ellipse render failed:", err);
    }

    // Uncertainty label
    const uncertLabel = viewer.entities.add({
      position: pos2C3,
      label: {
        text: "1σ uncertainty",
        font: "14pt sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        horizontalOrigin: HorizontalOrigin.LEFT,
        pixelOffset: new Cartesian2(0, -20),
        showBackground: true,
        backgroundColor: new Color(0.04, 0.04, 0.1, 0.85),
        backgroundPadding: new Cartesian2(8, 5),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    uncertLabel._type = "entity";
    bplaneCleanupRef.current.push(uncertLabel);

    // ── 5. HBR circle ────────────────────────────────────────────
    const hbrRadius = Math.max((conj.hbr_combined_m || 5), 10); // min 10m for CesiumJS rendering
    try {
      const hbrEntity = viewer.entities.add({
        position: pos1C3,
        ellipse: {
          semiMajorAxis: hbrRadius,
          semiMinorAxis: hbrRadius,
          fill: false,
          outline: true,
          outlineColor: Color.RED,
          outlineWidth: 2,
          numberOfVerticalLines: 0,
        },
      });
      bplaneCleanupRef.current.push(hbrEntity);
    } catch (err) {
      console.warn("[B-plane] HBR circle render failed:", err);
    }

    // HBR label
    const hbrLabel = viewer.entities.add({
      position: pos1C3,
      label: {
        text: "Combined HBR",
        font: "14pt sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        horizontalOrigin: HorizontalOrigin.LEFT,
        pixelOffset: new Cartesian2(0, -20),
        showBackground: true,
        backgroundColor: new Color(0.04, 0.04, 0.1, 0.85),
        backgroundPadding: new Cartesian2(8, 5),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    hbrLabel._type = "entity";
    bplaneCleanupRef.current.push(hbrLabel);

    console.log("[B-plane] Visualization rendered for", conj.catalogName);

    // ── CONTEXT 2: B-plane orbit arcs (±45 min around TCA) ──────────
    // Helper: inline propagate one arc segment, returns Cartesian3[]
    function propagateArc(satrec2, centerDate, minutesBefore, minutesAfter, stepSec) {
      const arcPath = [];
      const startMs = centerDate.getTime() - minutesBefore * 60 * 1000;
      const endMs   = centerDate.getTime() + minutesAfter  * 60 * 1000;
      for (let ms = startMs; ms <= endMs; ms += stepSec * 1000) {
        const t2 = new Date(ms);
        const pv2 = satellite.propagate(satrec2, t2);
        if (!pv2.position || pv2.position === false) continue;
        const gmst2 = satellite.gstime(t2);
        const geo2  = satellite.eciToGeodetic(pv2.position, gmst2);
        const lat2  = satellite.degreesLat(geo2.latitude);
        const lon2  = satellite.degreesLong(geo2.longitude);
        const alt2  = geo2.height * 1000; // km → m
        if (isFinite(lat2) && isFinite(lon2) && isFinite(alt2)) {
          arcPath.push(Cartesian3.fromDegrees(lon2, lat2, alt2));
        }
      }
      return arcPath;
    }

    // 1. User satellite arc — 3-tier TLE priority for epoch-correct rendering
    try {
      let userSatrec = null;

      // Priority 1: Use the primary TLE attached to the conjunction itself (canonical, epoch-locked)
      if (conj.primaryTLE1 && conj.primaryTLE2) {
        const sr = satellite.twoline2satrec(conj.primaryTLE1.trim(), conj.primaryTLE2.trim());
        if (sr && sr.error === 0) userSatrec = sr;
      }

      // Priority 2: Use the target orbit TLE from conjunctionAnalysis state
      if (!userSatrec) {
        const conjState = useSatguardStore.getState().conjunctionAnalysis;
        const targetOrbitInfo = conjState.targetOrbit;
        if (targetOrbitInfo?.tle1 && targetOrbitInfo?.tle2) {
          const sr = satellite.twoline2satrec(targetOrbitInfo.tle1.trim(), targetOrbitInfo.tle2.trim());
          if (sr && sr.error === 0) userSatrec = sr;
        }
      }

      // Priority 3: Fallback — build synthetic TLE from targetOrbitParams (may epoch-drift)
      if (!userSatrec) {
        const tOp = useSatguardStore.getState().targetOrbitParams;
        const MU = 398600.4418, R_EARTH2 = 6371.0;
        const a2 = R_EARTH2 + tOp.altitude;
        const n_rad2 = Math.sqrt(MU / (a2 * a2 * a2));
        const n_rev2 = n_rad2 * 86400 / (2 * Math.PI);
        const now2 = useSatguardStore.getState().missionEpoch;  // Use global mission epoch
        const yr2b = String(now2.getUTCFullYear()).slice(-2);
        const jan1b = new Date(Date.UTC(now2.getUTCFullYear(), 0, 1));
        const doy2 = (now2 - jan1b) / 86400000 + 1;
        const epStr2 = `${yr2b}${doy2.toFixed(8).padStart(12, " ")}`;
        const eccStr2 = (tOp.eccentricity || 0).toFixed(7).replace("0.", "").padStart(7, "0");
        const stle1 = `1 99999U 25001A   ${epStr2}  .00000000  00000-0  00000-0 0  9990`;
        const stle2 = `2 99999 ${tOp.inclination.toFixed(4).padStart(8)} ${tOp.raan.toFixed(4).padStart(8)} ${eccStr2} ${tOp.argPerigee.toFixed(4).padStart(8)} ${tOp.meanAnomaly.toFixed(4).padStart(8)} ${n_rev2.toFixed(8).padStart(11)}    10`;
        const sr = satellite.twoline2satrec(stle1.trim(), stle2.trim());
        if (sr && sr.error === 0) userSatrec = sr;
      }

      if (userSatrec) {
        const userArc = propagateArc(userSatrec, tcaDate, 45, 45, 30);
        if (userArc.length >= 2) {
          const userArcEnt = viewer.entities.add({
            name: "bplane-orbit:mysat",
            polyline: {
              positions: userArc,
              width: 2.5,
              material: Color.fromCssColorString("#00d4ff"),
              clampToGround: false,
            },
          });
          bplaneOrbitRef.current.push(userArcEnt);
        }
      }
    } catch (err) {
      console.warn("[B-plane] User sat orbit arc failed:", err);
    }

    // 2. Secondary (encounter) satellite arc — dashed orange
    try {
      if (conj.tle1 && conj.tle2) {
        const secSatrec = satellite.twoline2satrec(conj.tle1.trim(), conj.tle2.trim());
        if (secSatrec && secSatrec.error === 0) {
          const secArc = propagateArc(secSatrec, tcaDate, 45, 45, 30);
          if (secArc.length >= 2) {
            const secArcEnt = viewer.entities.add({
              name: `bplane-orbit:secondary:${conj.catalogName}`,
              polyline: {
                positions: secArc,
                width: 2,
                material: new PolylineDashMaterialProperty({
                  color: Color.fromCssColorString("#f97316"),
                  dashLength: 16,
                  dashPattern: 0xff00,
                }),
                clampToGround: false,
              },
            });
            bplaneOrbitRef.current.push(secArcEnt);
          }
        }
      }
    } catch (err) {
      console.warn("[B-plane] Secondary orbit arc failed:", err);
    }
  }, [selectedConjunction, conjunctionSource]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Reset camera to India overview */
  const handleResetView = () => {
    const v = viewerInstanceRef.current;
    if (v && !v.isDestroyed()) {
      v.camera.flyTo({ destination: INDIA_VIEW, duration: 1.5 });
    }
  };

  /* Star-field dots */
  const stars = useMemo(
    () =>
      Array.from({ length: 60 }, () => ({
        size: Math.random() * 2 + 1,
        top: Math.random() * 100,
        left: Math.random() * 100,
        opacity: Math.random() * 0.4 + 0.1,
      })),
    []
  );

  /* ── WebGL unsupported fallback ─────────────────────────────── */
  if (webglError) {
    return (
      <div
        className="absolute inset-0 z-0 flex flex-col items-center justify-center"
        style={{
          background: "radial-gradient(ellipse at 50% 50%, #1a1a2e 0%, #0d0d1a 60%, #050510 100%)",
        }}
      >
        <div
          className="text-red-400 text-center p-8 rounded-xl max-w-md"
          style={{
            background: "rgba(220, 38, 38, 0.08)",
            border: "1px solid rgba(220, 38, 38, 0.25)",
          }}
        >
          <h2
            className="text-2xl font-bold mb-3"
            style={{ color: "rgba(56, 189, 248, 1)" }}
          >
            SatGuard
          </h2>
          <p className="font-semibold mb-2 text-red-400">WebGL Not Available</p>
          <p className="text-sm" style={{ color: "rgba(148, 163, 184, 0.9)" }}>
            SatGuard requires WebGL to render the 3D globe. Please use a modern
            browser like Chrome, Firefox, or Edge with hardware acceleration
            enabled.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      id="globe-canvas"
      className="absolute inset-0 z-0"
      style={{
        background:
          "radial-gradient(ellipse at 50% 50%, #1a1a2e 0%, #0d0d1a 60%, #050510 100%)",
      }}
    >
      {/* Star-field placeholder — fades when tiles arrive */}
      <div
        className="absolute inset-0 overflow-hidden pointer-events-none"
        style={{
          opacity: loaded ? 0 : 1,
          transition: "opacity 0.8s ease",
          zIndex: 0,
        }}
      >
        {stars.map((s, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              width: `${s.size}px`,
              height: `${s.size}px`,
              top: `${s.top}%`,
              left: `${s.left}%`,
              opacity: s.opacity,
            }}
          />
        ))}

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center animate-fade-in">
            <div
              className="text-sm tracking-widest uppercase mb-2"
              style={{ color: "var(--color-text-muted)" }}
            >
              Globe Canvas
            </div>
            <div
              className="text-xs font-mono"
              style={{ color: "var(--color-text-muted)" }}
            >
              CesiumJS 3D Earth — loading&hellip;
            </div>
          </div>
        </div>
      </div>

      {/* Cesium Viewer container */}
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 1,
        }}
      />

      {/* Reset View button */}
      <button
        id="reset-view-btn"
        onClick={handleResetView}
        title="Reset View"
        style={{
          position: "fixed",
          bottom: "9rem",
          right: "1rem",
          zIndex: 45,
          width: "36px",
          height: "36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "8px",
          border: "1px solid rgba(56, 189, 248, 0.25)",
          background: "rgba(15, 23, 42, 0.65)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          color: "rgba(148, 163, 184, 0.9)",
          cursor: "pointer",
          transition: "all 0.2s ease",
          fontSize: "16px",
          lineHeight: 1,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(15, 23, 42, 0.85)";
          e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.5)";
          e.currentTarget.style.color = "rgba(56, 189, 248, 0.9)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(15, 23, 42, 0.65)";
          e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.25)";
          e.currentTarget.style.color = "rgba(148, 163, 184, 0.9)";
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      </button>

      {/* ── Hover orbit label overlay ─────────────────────────────── */}
      {hoverLabel.visible && (
        <div
          style={{
            position: "fixed",
            left: hoverLabel.x + 14,
            top: hoverLabel.y - 10,
            zIndex: 60,
            pointerEvents: "none",
            background: "rgba(10, 10, 30, 0.82)",
            border: "1px solid rgba(0, 212, 255, 0.45)",
            borderRadius: "6px",
            padding: "4px 10px",
            fontSize: "12px",
            fontWeight: 600,
            color: "#00d4ff",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            letterSpacing: "0.03em",
            whiteSpace: "nowrap",
            boxShadow: "0 2px 12px rgba(0,212,255,0.18)",
          }}
        >
          {hoverLabel.name}
        </div>
      )}
    </div>
  );
}
