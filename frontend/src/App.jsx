import { useEffect, useState, useCallback } from "react";
import Globe from "./components/Globe";
import TopBar from "./components/TopBar";
import OrbitInput from "./components/OrbitInput";
import ConjunctionPanel from "./components/ConjunctionPanel";
import ContactTimeline from "./components/ContactTimeline";
import InfoBanner from "./components/InfoBanner";
import LandingPage from "./components/LandingPage";
import useSatguardStore from "./store/satguardStore";
import useDeviceCapability from "./hooks/useDeviceCapability";

/**
 * App.jsx — Root shell with landing → dashboard transition
 *
 * On first visit, shows the scrollytelling LandingPage.
 * "Launch Console" button transitions into the main dashboard.
 */
export default function App() {
  const [view, setView] = useState("landing"); // "landing" | "entering" | "dashboard"
  const [dismissedDeviceWarning, setDismissedDeviceWarning] = useState(false);
  const caps = useDeviceCapability();

  const cesiumReady = useSatguardStore((s) => s.cesiumReady);
  const tleData = useSatguardStore((s) => s.tleData);
  const fetchTle = useSatguardStore((s) => s.fetchTle);

  const tleReady = !tleData.loading && !!tleData.satellites;
  const loadingComplete = cesiumReady && tleReady;
  const initError = tleData.error;

  // ── fetchTle() call when entering dashboard ────────────────────
  useEffect(() => {
    if (view === "entering" || view === "dashboard") {
      const { fetchTle } = useSatguardStore.getState();
      fetchTle();
    }
  }, [view]);

  // ── Progressive loading message timer ───────────────────────────
  const [loadingElapsed, setLoadingElapsed] = useState(0);

  useEffect(() => {
    if (!tleData.loading || !tleData.loadingStartTime) {
      setLoadingElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingElapsed(Date.now() - tleData.loadingStartTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [tleData.loading, tleData.loadingStartTime]);

  const getLoadingMessage = () => {
    if (loadingElapsed > 10_000) {
      return "Loading TLE catalog from Celestrak — this may take up to 30 seconds on first load...";
    }
    return "Connecting to orbital data service...";
  };

  const handleRetry = () => {
    fetchTle();
  };

  // ── Transition handler: landing → dashboard ────────────────────
  const handleEnterDashboard = useCallback(() => {
    setView("entering");
    // Short timeout for the fade-out animation to play
    setTimeout(() => {
      setView("dashboard");
      // Scroll to top for the dashboard view
      window.scrollTo(0, 0);
    }, 600);
  }, []);

  /* ═══════════════════════════════════════════════════════════════ */
  /* ── Landing Page View ──────────────────────────────────────── */
  /* ═══════════════════════════════════════════════════════════════ */
  if (view === "landing" || view === "entering") {
    return (
      <div
        className="landing-root"
        style={{
          opacity: view === "entering" ? 0 : 1,
          transition: "opacity 0.6s ease-in-out",
        }}
      >
        <LandingPage onEnter={handleEnterDashboard} />
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /* ── Dashboard View ─────────────────────────────────────────── */
  /* ═══════════════════════════════════════════════════════════════ */
  return (
    <div id="satguard-root" className="dashboard-root relative w-full h-full overflow-hidden">
      {/* ── Device capability warning overlay ─────────────────────── */}
      {(!caps.canRunDashboard && !dismissedDeviceWarning) && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-6"
          style={{
            background: "rgba(5, 5, 16, 0.95)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          <div className="max-w-md text-center">
            {/* Icon */}
            <div className="w-16 h-16 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ background: "rgba(255, 165, 2, 0.1)", border: "1px solid rgba(255, 165, 2, 0.3)" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffa502" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>

            <h2 className="text-xl font-bold text-white mb-3">Desktop Recommended</h2>

            <p className="text-sm text-white/60 leading-relaxed mb-2">
              SatGuard's orbital dashboard uses a <span style={{ color: "#00d4ff" }}>3D CesiumJS globe</span>,{" "}
              <span style={{ color: "#00d4ff" }}>real-time SGP4 propagation</span>, and{" "}
              <span style={{ color: "#00d4ff" }}>WebGL rendering</span> that require a desktop browser.
            </p>

            {!caps.hasWebGL && (
              <p className="text-xs text-red-400/80 mb-4 px-4 py-2 rounded-md" style={{ background: "rgba(255,71,87,0.08)", border: "1px solid rgba(255,71,87,0.2)" }}>
                Your browser does not support WebGL, which is required for the 3D globe.
              </p>
            )}

            {caps.isMobile && (
              <p className="text-xs text-white/40 mb-4">
                For the best experience, please open SatGuard on a laptop or desktop computer with Chrome, Edge, or Firefox.
              </p>
            )}

            <div className="flex flex-col gap-3 mt-6">
              <button
                onClick={() => {
                  setView("landing");
                  window.scrollTo(0, 0);
                }}
                className="w-full py-3 text-sm font-medium tracking-wider uppercase rounded-md cursor-pointer transition-all duration-300"
                style={{
                  background: "rgba(0, 212, 255, 0.12)",
                  border: "1px solid rgba(0, 212, 255, 0.3)",
                  color: "#00d4ff",
                }}
              >
                ← Back to Landing Page
              </button>

              {caps.hasWebGL && (
                <button
                  onClick={() => setDismissedDeviceWarning(true)}
                  className="w-full py-2.5 text-xs font-mono tracking-wider uppercase rounded-md cursor-pointer transition-all duration-300"
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    color: "rgba(255, 255, 255, 0.4)",
                  }}
                >
                  Continue Anyway →
                </button>
              )}
            </div>

            <p className="text-[10px] text-white/20 mt-6 font-mono">
              {caps.cores} cores · {caps.memory}GB RAM · WebGL: {caps.hasWebGL ? "✓" : "✗"}
            </p>
          </div>
        </div>
      )}
      {/* z-0  — Globe canvas (base layer) */}
      <Globe />

      {/* z-50 — Fixed top bar */}
      <TopBar />
      <InfoBanner />

      {/* z-40 — Floating side panels */}
      <OrbitInput />
      <ConjunctionPanel />

      {/* z-40 — Fixed bottom timeline */}
      <ContactTimeline />

      {/* z-[100] — Loading / Error Overlay */}
      {(!loadingComplete || initError) && (
        <div
          className="absolute inset-0 z-[100] flex flex-col items-center justify-center pointer-events-auto"
          style={{
            background: "rgba(5, 5, 16, 0.85)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          <h1
            className="text-5xl font-bold mb-8 tracking-wider"
            style={{
              color: "rgba(56, 189, 248, 1)",
              textShadow: "0 0 20px rgba(56, 189, 248, 0.5)",
            }}
          >
            SatGuard
          </h1>
          {initError ? (
            <div className="flex flex-col items-center">
              <div
                className="text-red-400 mb-6 max-w-md text-center p-4 rounded-lg"
                style={{
                  background: "rgba(220, 38, 38, 0.1)",
                  border: "1px solid rgba(220, 38, 38, 0.3)",
                }}
              >
                <p className="font-semibold mb-1">Failed to load orbital data</p>
                {initError.split("\n").map((line, i) => (
                  <p key={i} className={`text-sm ${i > 0 ? "opacity-60 font-mono mt-1" : "opacity-80"}`}>
                    {line}
                  </p>
                ))}
              </div>
              {tleData.retryCount >= 3 ? (
                <div className="flex flex-col items-center gap-3">
                  <button
                    onClick={() => {
                      useSatguardStore.getState().setTleData({ retryCount: 0 });
                      handleRetry();
                    }}
                    className="px-6 py-2 rounded-lg font-medium transition-colors"
                    style={{
                      background: "rgba(56, 189, 248, 0.15)",
                      border: "1px solid rgba(56, 189, 248, 0.3)",
                      color: "rgba(56, 189, 248, 1)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(56, 189, 248, 0.25)";
                      e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.6)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(56, 189, 248, 0.15)";
                      e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.3)";
                    }}
                  >
                    Try Again
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleRetry}
                  className="px-6 py-2 rounded-lg font-medium transition-colors"
                  style={{
                    background: "rgba(56, 189, 248, 0.15)",
                    border: "1px solid rgba(56, 189, 248, 0.3)",
                    color: "rgba(56, 189, 248, 1)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(56, 189, 248, 0.25)";
                    e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.6)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(56, 189, 248, 0.15)";
                    e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.3)";
                  }}
                >
                  Retry
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 mb-6 relative">
                <div
                  className="absolute inset-0 rounded-full border-t-2 border-r-2 animate-spin"
                  style={{ borderColor: "#38bdf8" }}
                ></div>
                <div
                  className="absolute inset-0 rounded-full animate-ping opacity-20"
                  style={{ backgroundColor: "#38bdf8" }}
                ></div>
              </div>
              <p
                className="font-mono text-sm tracking-widest animate-pulse max-w-sm text-center"
                style={{ color: "rgba(148, 163, 184, 0.9)" }}
              >
                {getLoadingMessage()}
              </p>
              <div className="mt-4 flex gap-4 text-xs font-mono opacity-50">
                <span style={{ color: cesiumReady ? "#4ade80" : "#94a3b8" }}>
                  [{cesiumReady ? "OK" : ".."}] Engine
                </span>
                <span style={{ color: tleReady ? "#4ade80" : "#94a3b8" }}>
                  [{tleReady ? "OK" : ".."}] Ephemeris
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}