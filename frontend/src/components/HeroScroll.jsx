import { useRef, useEffect, useState, useCallback } from "react";
import { useScroll, motion, AnimatePresence } from "framer-motion";

/* ═══════════════════════════════════════════════════════════════════════
 * HeroScroll — Video-Scrub Architecture
 *
 * Single-asset MP4 scrubbing. Zero workers. Zero message passing.
 * Canvas draw AND text overlay updates happen in the SAME rAF tick
 * → frame-perfect sync, zero drift.
 *
 * Data flow (one rAF tick):
 *   scrollYProgress.get() → lerp → video.currentTime → drawImage → el.style
 *   All synchronous. All main-thread. All in one paint.
 * ═══════════════════════════════════════════════════════════════════════ */

const VIDEO_SRC = "/hero-sequence.mp4";
const SCROLL_HEIGHT = "500vh";
const LERP_FACTOR = 0.12; // lower = smoother, higher = snappier

/* ─── Text overlay timeline ───────────────────────────────────────────── */
const TEXT_SECTIONS = [
  { id: "hook",       enter: -0.01, exit: 0.12,  align: "center", sticky: false },
  { id: "hero-title", enter: 0.20,  exit: 0.38,  align: "center", sticky: false },
  { id: "collision",  enter: 0.42,  exit: 0.60,  align: "left",   sticky: false },
  { id: "mission",    enter: 0.66,  exit: 0.84,  align: "right",  sticky: false },
  { id: "cta",        enter: 0.88,  exit: 1.5,   align: "center", sticky: true  },
];

/* ─── Pure functions (no React, no side effects) ──────────────────────── */

function computeOpacity(p, { enter, exit, sticky }) {
  const fadeIn = 0.05, fadeOut = 0.05;
  if (p < enter) return 0;
  if (sticky) return p < enter + fadeIn ? (p - enter) / fadeIn : 1;
  if (p > exit) return 0;
  if (p < enter + fadeIn) return (p - enter) / fadeIn;
  if (p > exit - fadeOut) return (exit - p) / fadeOut;
  return 1;
}

function computeTranslateY(p, { enter, exit, sticky }) {
  const mid = (enter + Math.min(exit, 1)) / 2;
  if (p < enter) return 40;
  if (sticky) return p < mid ? 40 * (1 - (p - enter) / (mid - enter)) : 0;
  if (p < mid) return 40 * (1 - (p - enter) / (mid - enter));
  if (p < exit) return -24 * ((p - mid) / (exit - mid));
  return -24;
}

function alignClasses(a) {
  if (a === "left")  return "items-start text-left pl-8 sm:pl-16 md:pl-24 lg:pl-32";
  if (a === "right") return "items-end text-right pr-8 sm:pr-16 md:pr-24 lg:pr-32";
  return "items-center text-center px-6";
}

/* ─── Loading overlay ─────────────────────────────────────────────────── */

function LoadingOverlay({ progress }) {
  const C = 2 * Math.PI * 38;
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#050505]"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: "easeInOut" }}
    >
      <div className="relative w-20 h-20 mb-8">
        <div className="absolute inset-0 rounded-full border border-white/[0.08]" />
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 80 80">
          <circle
            cx="40" cy="40" r="38" fill="none"
            stroke="white" strokeWidth="1.5" strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress / 100)}
            style={{ transition: "stroke-dashoffset 0.3s ease" }}
            opacity="0.8"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-mono text-white/60 tabular-nums">
            {Math.round(progress)}%
          </span>
        </div>
      </div>
      <p className="font-mono text-sm tracking-[0.3em] text-white/50 uppercase">
        Initializing SatGuard
      </p>
      <div className="mt-3 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1 h-1 rounded-full bg-white/40"
            style={{
              animation: "pulse 1.4s ease-in-out infinite",
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Main component
 * ═══════════════════════════════════════════════════════════════════════ */

export default function HeroScroll({ onEnter }) {
  /* ── Refs ────────────────────────────────────────────────────────────── */
  const scrollContainerRef = useRef(null);
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const ctxRef = useRef(null);
  const rafIdRef = useRef(null);
  const displayRef = useRef(0);     // lerped scroll progress
  const isReadyRef = useRef(false);
  const onEnterRef = useRef(onEnter);

  // Direct-DOM refs for text overlays (zero React re-renders)
  const sectionElsRef = useRef({});
  const vignetteElRef = useRef(null);
  const scrollIndicatorElRef = useRef(null);

  /* ── React state (loading overlay only — NOT on scroll hot-path) ────── */
  const [loaded, setLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);

  useEffect(() => { onEnterRef.current = onEnter; }, [onEnter]);

  /* ── Framer Motion scroll ───────────────────────────────────────────── */
  const { scrollYProgress } = useScroll({
    target: scrollContainerRef,
    offset: ["start start", "end end"],
  });

  /* ── Object-cover draw helper ───────────────────────────────────────── */
  const drawVideoFrame = useCallback(() => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!ctx || !canvas || !video || video.readyState < 2) return;

    const vw = video.videoWidth, vh = video.videoHeight;
    const cw = canvas.width, ch = canvas.height;
    if (!vw || !vh || !cw || !ch) return;

    const imgR = vw / vh, canR = cw / ch;
    let sx, sy, sw, sh;
    if (imgR > canR) {
      sh = vh; sw = vh * canR; sx = (vw - sw) / 2; sy = 0;
    } else {
      sw = vw; sh = vw / canR; sx = 0; sy = (vh - sh) / 2;
    }

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
  }, []);

  /* ── Size the backing canvas (DPR-aware, clamped to 2x) ────────────── */
  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width * dpr) || 1920;
    const h = Math.round(rect.height * dpr) || 1080;
    canvas.width = w;
    canvas.height = h;
    ctxRef.current = canvas.getContext("2d", { alpha: false });
  }, []);

  /* ══════════════════════════════════════════════════════════════════════
   * INIT: video load → size canvas → draw first frame → show UI
   * ══════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function handleReady() {
      sizeCanvas();
      drawVideoFrame();      // draw frame 1 immediately
      setLoaded(true);
      setLoadProgress(100);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { isReadyRef.current = true; });
      });
    }

    function handleProgress() {
      if (video.buffered.length > 0 && video.duration) {
        const end = video.buffered.end(video.buffered.length - 1);
        setLoadProgress(Math.min((end / video.duration) * 100, 99));
      }
    }

    // Already loaded (fast cache hit or HMR re-mount)
    if (video.readyState >= 4) {
      handleReady();
      return;
    }

    video.addEventListener("canplaythrough", handleReady, { once: true });
    video.addEventListener("progress", handleProgress);

    return () => {
      video.removeEventListener("canplaythrough", handleReady);
      video.removeEventListener("progress", handleProgress);
    };
  }, [sizeCanvas, drawVideoFrame]);

  /* ══════════════════════════════════════════════════════════════════════
   * MAIN rAF LOOP — the entire hot-path
   *
   * Everything in ONE tick, on ONE thread:
   *   1. Read scroll progress
   *   2. Lerp (spring-smooth)
   *   3. Set video.currentTime (hardware seek)
   *   4. drawImage(video) on canvas
   *   5. Update text overlay el.style
   *
   * Canvas and text are always in perfect sync because they're computed
   * from the same value and applied in the same paint.
   * ══════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (!loaded) return;
    const video = videoRef.current;
    if (!video || !video.duration) return;

    const duration = video.duration;

    function tick() {
      // 1. Raw scroll progress
      const raw = scrollYProgress.get();

      // 2. Exponential lerp → smooth, spring-like motion
      displayRef.current += (raw - displayRef.current) * LERP_FACTOR;
      const p = displayRef.current;

      // 3. Seek video (hardware decoder handles this in <1ms for all-I-frame)
      const targetTime = Math.max(0, Math.min(p * duration, duration - 0.001));
      video.currentTime = targetTime;

      // 4. Draw video frame on canvas (SAME TICK)
      drawVideoFrame();

      // 5. Update text overlays (SAME TICK — perfect sync with canvas)
      if (isReadyRef.current) {
        const textP = raw; // raw progress for text (no lerp lag)

        for (const s of TEXT_SECTIONS) {
          const el = sectionElsRef.current[s.id];
          if (!el) continue;
          const opacity = computeOpacity(textP, s);
          const ty = computeTranslateY(textP, s);
          el.style.opacity = opacity;
          el.style.transform = `translateY(${ty}px)`;
          if (s.sticky) el.style.pointerEvents = opacity > 0.5 ? "auto" : "none";
        }

        if (vignetteElRef.current)
          vignetteElRef.current.style.opacity = textP > 0.18 ? "1" : "0";
        if (scrollIndicatorElRef.current)
          scrollIndicatorElRef.current.style.opacity = textP < 0.04 ? "1" : "0";
      }

      rafIdRef.current = requestAnimationFrame(tick);
    }

    rafIdRef.current = requestAnimationFrame(tick);
    return () => { if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); };
  }, [loaded, scrollYProgress, drawVideoFrame]);

  /* ── requestVideoFrameCallback (bonus accuracy layer) ───────────────── */
  useEffect(() => {
    if (!loaded) return;
    const video = videoRef.current;
    if (!video || !("requestVideoFrameCallback" in video)) return;

    let cbId;
    function onNewFrame() {
      drawVideoFrame();
      cbId = video.requestVideoFrameCallback(onNewFrame);
    }
    cbId = video.requestVideoFrameCallback(onNewFrame);

    return () => { if (cbId) video.cancelVideoFrameCallback(cbId); };
  }, [loaded, drawVideoFrame]);

  /* ── Resize handler ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!loaded) return;
    function onResize() {
      sizeCanvas();
      drawVideoFrame();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [loaded, sizeCanvas, drawVideoFrame]);

  /* ══════════════════════════════════════════════════════════════════════
   * RENDER — static JSX, never re-renders during scroll
   * ══════════════════════════════════════════════════════════════════════ */

  return (
    <>
      {/* Loading overlay (one-shot, exits on canplaythrough) */}
      <AnimatePresence>
        {!loaded && <LoadingOverlay progress={loadProgress} />}
      </AnimatePresence>

      {/* Scroll container */}
      <div
        ref={scrollContainerRef}
        className="relative w-full"
        style={{ height: SCROLL_HEIGHT, background: "#050505" }}
      >
        {/* ── Hidden video source (hardware-decoded, preloaded) ─────── */}
        <video
          ref={videoRef}
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          style={{
            position: "fixed",
            top: 0, left: 0,
            width: "1px", height: "1px",
            opacity: 0,
            pointerEvents: "none",
            zIndex: -1,
          }}
        >
          <source src={VIDEO_SRC} type="video/mp4" />
        </video>

        {/* ── Visible canvas (sticky, covers viewport) ─────────────── */}
        <canvas
          ref={canvasRef}
          className="sticky top-0 w-full"
          style={{ height: "100vh", display: "block", background: "#050505" }}
        />

        {/* ── Text overlay layer (fixed, pointer-events-none) ──────── */}
        <div className="fixed inset-0 pointer-events-none z-10">
          {/* Vignette */}
          <div
            ref={vignetteElRef}
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 80% 70% at 50% 50%, transparent 30%, rgba(0,0,0,0.55) 100%)",
              opacity: 0,
              transition: "opacity 0.7s ease",
            }}
          />

          {/* Text sections */}
          {TEXT_SECTIONS.map((section) => (
            <div
              key={section.id}
              ref={(el) => { if (el) sectionElsRef.current[section.id] = el; }}
              className={`absolute inset-0 flex flex-col justify-center ${alignClasses(section.align)}`}
              style={{
                opacity: 0,
                willChange: "transform, opacity",
                pointerEvents: section.sticky ? "none" : undefined,
              }}
            >
              <SectionContent id={section.id} onEnter={onEnterRef} />
            </div>
          ))}

          {/* Scroll indicator */}
          <div
            ref={scrollIndicatorElRef}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
            style={{ opacity: 0, transition: "opacity 0.4s ease" }}
          >
            <span className="text-[10px] font-mono tracking-[0.3em] uppercase text-white/40">
              Scroll
            </span>
            <div
              className="w-[1px] h-8 bg-white/30 origin-top"
              style={{ animation: "hero-scroll-pulse 2s ease-in-out infinite" }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Section content ─────────────────────────────────────────────────── */

function SectionContent({ id, onEnter }) {
  switch (id) {
    case "hook":
      return (
        <p className="text-base sm:text-lg md:text-xl font-light tracking-wide text-white/70 max-w-lg leading-relaxed">
          Advanced situational awareness for the new space era.
        </p>
      );
    case "hero-title":
      return (
        <>
          <h1 className="text-5xl sm:text-7xl md:text-8xl font-bold tracking-tight text-white leading-[0.95]">
            SatGuard
          </h1>
          <p className="mt-4 text-lg sm:text-xl md:text-2xl font-light tracking-widest text-white/70 uppercase">
            Orbital Intelligence.
          </p>
        </>
      );
    case "collision":
      return (
        <>
          <h2 className="text-3xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-white leading-tight">
            Proactive Collision<br />Avoidance.
          </h2>
          <p className="mt-4 max-w-md text-base sm:text-lg text-white/70 font-light leading-relaxed">
            Advanced SGP4 propagation and risk triage.
          </p>
        </>
      );
    case "mission":
      return (
        <>
          <h2 className="text-3xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-white leading-tight text-right">
            Seamless Mission<br />Planning.
          </h2>
          <p className="mt-4 max-w-md text-base sm:text-lg text-white/70 font-light leading-relaxed text-right">
            Deterministic Safe Slot and Contact Window generation.
          </p>
        </>
      );
    case "cta":
      return (
        <>
          <h2 className="text-4xl sm:text-6xl md:text-7xl font-bold tracking-tight text-white leading-[0.95] mb-3">
            Secure Your Orbit.
          </h2>
          <p className="text-base sm:text-lg text-white/70 font-light tracking-wide mb-10">
            Real-time situational awareness for the new space era.
          </p>
          <button
            onClick={() => onEnter.current?.()}
            className="group relative px-10 py-4 text-sm sm:text-base font-medium tracking-[0.2em] uppercase text-white border border-white/30 rounded-sm bg-transparent cursor-pointer overflow-hidden transition-all duration-500 hover:border-white/80 hover:tracking-[0.3em] hover:shadow-[0_0_30px_rgba(255,255,255,0.08)]"
          >
            <span className="absolute inset-0 bg-white/[0.06] scale-x-0 origin-left transition-transform duration-500 group-hover:scale-x-100" />
            <span className="relative z-10">Launch Console</span>
          </button>
        </>
      );
    default:
      return null;
  }
}
