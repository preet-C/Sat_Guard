import HeroScroll from "./HeroScroll";

/**
 * LandingPage — Full scrollytelling hero experience
 *
 * Renders the HeroScroll canvas + overlays.
 * The `onEnter` callback navigates the user into the main SatGuard dashboard.
 */
export default function LandingPage({ onEnter }) {
  return (
    <div
      id="landing-page"
      className="w-full min-h-screen"
      style={{ background: "#050505" }}
    >
      {/* ── Floating top-left brand mark ──────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-6 sm:px-10 py-5 pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          {/* Minimal logo mark */}
          <div className="relative w-8 h-8 flex items-center justify-center">
            <svg
              viewBox="0 0 32 32"
              className="w-full h-full"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Orbit ring */}
              <ellipse
                cx="16" cy="16" rx="14" ry="6"
                stroke="white"
                strokeWidth="0.8"
                opacity="0.5"
                transform="rotate(-20 16 16)"
              />
              {/* Core dot */}
              <circle cx="16" cy="16" r="2.5" fill="white" opacity="0.9" />
              {/* Satellite dot */}
              <circle cx="27" cy="12" r="1.2" fill="white" opacity="0.7" />
            </svg>
          </div>
          <span className="text-xs font-mono tracking-[0.35em] uppercase text-white/50 hidden sm:inline">
            SatGuard
          </span>
        </div>

        {/* Skip to dashboard link */}
        <button
          onClick={onEnter}
          className="pointer-events-auto text-[11px] font-mono tracking-[0.25em] uppercase text-white/30 hover:text-white/70 transition-colors duration-300 cursor-pointer"
        >
          Skip →
        </button>
      </header>

      {/* ── Hero scroll sequence ─────────────────────────────────── */}
      <HeroScroll onEnter={onEnter} />

      {/* ── Post-scroll footer ───────────────────────────────────── */}
      <footer
        className="relative z-20 flex items-center justify-center py-10"
        style={{ background: "#050505" }}
      >
        <p className="text-[10px] font-mono tracking-[0.3em] uppercase text-white/20">
          © 2026 SatGuard · Orbital Intelligence Platform
        </p>
      </footer>
    </div>
  );
}
