/**
 * useDeviceCapability.js — Device capability detection for SatGuard
 *
 * Detects:
 *   • Mobile/tablet vs desktop (screen size + touch + UA heuristics)
 *   • Low-end hardware (core count, deviceMemory, reduced-motion pref)
 *   • WebGL support (required for CesiumJS dashboard)
 *   • Video scrub support (required for scrollytelling)
 *
 * IMPORTANT: This never blocks desktop users. It only gates mobile/low-end
 * paths to prevent broken UX.
 */

import { useState, useEffect, useMemo } from "react";

/* ── Static detections (computed once, never change) ──────────────── */

function detectCapabilities() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";

  // ── Mobile/Tablet detection ──
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isTouchPrimary =
    typeof window !== "undefined" &&
    (("ontouchstart" in window) || navigator.maxTouchPoints > 0);
  const isSmallScreen = typeof window !== "undefined" && window.innerWidth < 768;
  const isMedScreen = typeof window !== "undefined" && window.innerWidth < 1024;
  // iPad in desktop mode reports "MacIntel" but has touch
  const isIPadDesktopMode = platform === "MacIntel" && navigator.maxTouchPoints > 1;

  const isMobile = isMobileUA || isSmallScreen || isIPadDesktopMode;
  const isTablet = !isSmallScreen && isMedScreen && (isTouchPrimary || isIPadDesktopMode);

  // ── Hardware tier ──
  const cores = navigator.hardwareConcurrency || 2;
  const memory = navigator.deviceMemory || 4; // GB, defaults to 4 if unsupported
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const isLowEnd = cores <= 2 || memory <= 2 || prefersReducedMotion;

  // ── WebGL check (required for CesiumJS) ──
  let hasWebGL = false;
  try {
    const c = document.createElement("canvas");
    hasWebGL = !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
  } catch {
    hasWebGL = false;
  }

  // ── Video element support ──
  const hasVideo = typeof HTMLVideoElement !== "undefined";
  const hasRVFC = hasVideo && "requestVideoFrameCallback" in HTMLVideoElement.prototype;

  // ── Canvas 2D (always available, but check anyway) ──
  let hasCanvas2D = false;
  try {
    const c = document.createElement("canvas");
    hasCanvas2D = !!c.getContext("2d");
  } catch {
    hasCanvas2D = false;
  }

  // ── Scrollytelling capability ──
  // Desktop with video support = full video scrubbing
  // Mobile or low-end = static fallback (poster + text)
  const canRunScrollytelling = !isMobile && hasVideo && hasCanvas2D && !prefersReducedMotion;

  // ── Dashboard capability ──
  // Requires WebGL + reasonable hardware + desktop
  const canRunDashboard = hasWebGL && !isMobile && !isLowEnd;

  return {
    isMobile,
    isTablet,
    isSmallScreen,
    isTouchPrimary,
    isLowEnd,
    hasWebGL,
    hasVideo,
    hasRVFC,
    hasCanvas2D,
    prefersReducedMotion,
    canRunScrollytelling,
    canRunDashboard,
    cores,
    memory,
  };
}

/* ── Singleton cache (avoids re-computation) ──────────────────────── */
let cachedCapabilities = null;

export function getDeviceCapabilities() {
  if (!cachedCapabilities) {
    cachedCapabilities = detectCapabilities();
  }
  return cachedCapabilities;
}

/* ── React hook ───────────────────────────────────────────────────── */
export default function useDeviceCapability() {
  const [caps, setCaps] = useState(() => getDeviceCapabilities());

  // Re-detect on resize (handles orientation changes on tablets)
  useEffect(() => {
    function handleResize() {
      cachedCapabilities = null; // bust cache
      setCaps(detectCapabilities());
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return caps;
}
