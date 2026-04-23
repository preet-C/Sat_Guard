/**
 * useDeviceCapability.js — Device capability detection for SatGuard
 *
 * PHILOSOPHY: Be extremely permissive. Only block features when we are
 * CERTAIN the device cannot run them. A desktop with "reduce motion"
 * enabled is NOT a reason to kill scrollytelling. A touch-screen laptop
 * is NOT mobile.
 *
 * The ONLY hard gates:
 *   • Scrollytelling: blocked on real phones (mobile UA + small screen)
 *   • Dashboard: blocked when there is NO WebGL at all
 */

import { useState, useEffect } from "react";

/* ── Static detections ───────────────────────────────────────────────── */

function detectCapabilities() {
  const ua = navigator.userAgent || "";

  // ── True phone detection (MUST match UA AND have small screen) ──
  // Touch-screen laptops, 2-in-1s, and tablets with keyboards are NOT phones.
  const isMobileUA = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  // Note: iPad is intentionally NOT in the list. iPads are tablets, not phones.
  const isPhoneScreen = typeof window !== "undefined" && window.screen.width < 768;
  // Use screen.width (physical), not innerWidth (can change with window resize)

  const isMobile = isMobileUA && isPhoneScreen;

  // ── Tablet: iPad or Android tablet ──
  const isIPad = /iPad/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroidTablet = /Android/i.test(ua) && !/Mobile/i.test(ua);
  const isTablet = isIPad || isAndroidTablet;

  // ── Hardware info (informational only, NOT used for gating) ──
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── WebGL check (required for CesiumJS) ──
  let hasWebGL = false;
  try {
    const c = document.createElement("canvas");
    hasWebGL = !!(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl"));
  } catch {
    hasWebGL = false;
  }

  // ── Video / Canvas support ──
  const hasVideo = typeof HTMLVideoElement !== "undefined";
  const hasRVFC = hasVideo && "requestVideoFrameCallback" in HTMLVideoElement.prototype;
  let hasCanvas2D = false;
  try {
    hasCanvas2D = !!document.createElement("canvas").getContext("2d");
  } catch {
    hasCanvas2D = false;
  }

  // ══════════════════════════════════════════════════════════════════
  // CAPABILITY GATES — intentionally permissive
  // ══════════════════════════════════════════════════════════════════

  // Scrollytelling: only block on REAL phones.
  // Desktop with reduce-motion? Fine — let the video scrub run.
  // Touch-screen laptop? Fine. Tablet? Fine (landscape is big enough).
  // The ONLY thing that kills it: a genuine phone with a tiny screen.
  const canRunScrollytelling = hasVideo && hasCanvas2D && !isMobile;

  // Dashboard: only block if there is literally no WebGL.
  // Mobile phones get the warning, but tablets and everything else proceed.
  const canRunDashboard = hasWebGL && !isMobile;

  return {
    isMobile,
    isTablet,
    isPhoneScreen,
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

/* ── Singleton cache ─────────────────────────────────────────────────── */
let cachedCapabilities = null;

export function getDeviceCapabilities() {
  if (!cachedCapabilities) {
    cachedCapabilities = detectCapabilities();
  }
  return cachedCapabilities;
}

/* ── React hook ──────────────────────────────────────────────────────── */
export default function useDeviceCapability() {
  // Compute once on mount — do NOT re-detect on resize.
  // window.screen.width is physical and doesn't change.
  // Re-detecting on resize caused flickering between modes.
  const [caps] = useState(() => getDeviceCapabilities());
  return caps;
}
