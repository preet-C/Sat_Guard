import { useRef, useEffect, useState, useCallback } from "react";
import { useScroll, useTransform, motion, useMotionValueEvent } from "framer-motion";

const TOTAL_FRAMES = 133;
const IMAGE_PATH = "/hero-sequence/ezgif-frame-";

/**
 * Pads a number to 3 digits: 1 → "001", 15 → "015", 133 → "133"
 */
function padFrame(n) {
  return String(n).padStart(3, "0");
}

/**
 * Builds the full URL for a given frame index (1-based).
 */
function frameUrl(index) {
  return `${IMAGE_PATH}${padFrame(index)}.jpg`;
}

/* ─── Text overlay data ───────────────────────────────────────────── */
const TEXT_SECTIONS = [
  {
    id: "hero-title",
    enter: 0.16,
    exit: 0.32,
    align: "center",
    content: (
      <>
        <h1 className="text-5xl sm:text-7xl md:text-8xl font-bold tracking-tight text-white leading-[0.95]">
          SatGuard
        </h1>
        <p className="mt-4 text-lg sm:text-xl md:text-2xl font-light tracking-widest text-white/70 uppercase">
          Orbital Intelligence.
        </p>
      </>
    ),
  },
  {
    id: "collision",
    enter: 0.40,
    exit: 0.58,
    align: "left",
    content: (
      <>
        <h2 className="text-3xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-white leading-tight">
          Proactive Collision
          <br />
          Avoidance.
        </h2>
        <p className="mt-4 max-w-md text-base sm:text-lg text-white/70 font-light leading-relaxed">
          Advanced SGP4 propagation and risk triage — protecting critical assets in increasingly congested orbital regimes.
        </p>
      </>
    ),
  },
  {
    id: "mission",
    enter: 0.64,
    exit: 0.82,
    align: "right",
    content: (
      <>
        <h2 className="text-3xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-white leading-tight text-right">
          Seamless Mission
          <br />
          Planning.
        </h2>
        <p className="mt-4 max-w-md text-base sm:text-lg text-white/70 font-light leading-relaxed text-right">
          Deterministic Safe Slot and Contact Window generation — end-to-end mission confidence.
        </p>
      </>
    ),
  },
  {
    id: "cta",
    enter: 0.86,
    exit: 1.01,
    align: "center",
    content: null, // rendered separately for the CTA button
  },
];

/* ─── Loading spinner ─────────────────────────────────────────────── */
function LoadingOverlay({ progress }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#050505]">
      {/* Orbital ring spinner */}
      <div className="relative w-20 h-20 mb-8">
        <div
          className="absolute inset-0 rounded-full border-2 border-white/10"
        />
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 80 80">
          <circle
            cx="40" cy="40" r="38"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 38}`}
            strokeDashoffset={`${2 * Math.PI * 38 * (1 - progress / 100)}`}
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
      <div className="mt-3 flex gap-1">
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
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */
/* ─── HeroScroll Component ────────────────────────────────────────── */
/* ═══════════════════════════════════════════════════════════════════ */

export default function HeroScroll({ onEnter }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const imagesRef = useRef([]);
  const currentFrameRef = useRef(0);
  const animFrameRef = useRef(null);

  const [loaded, setLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);

  /* ── Framer Motion scroll tracking ─────────────────────────────── */
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  const frameIndex = useTransform(scrollYProgress, [0, 1], [1, TOTAL_FRAMES]);

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    setScrollProgress(v);
  });

  /* ── Preload all 133 frames ────────────────────────────────────── */
  useEffect(() => {
    let loadedCount = 0;
    const images = [];

    for (let i = 1; i <= TOTAL_FRAMES; i++) {
      const img = new Image();
      img.src = frameUrl(i);
      img.onload = () => {
        loadedCount++;
        setLoadProgress((loadedCount / TOTAL_FRAMES) * 100);
        if (loadedCount === TOTAL_FRAMES) {
          setLoaded(true);
        }
      };
      img.onerror = () => {
        loadedCount++;
        setLoadProgress((loadedCount / TOTAL_FRAMES) * 100);
        if (loadedCount === TOTAL_FRAMES) setLoaded(true);
      };
      images[i] = img;
    }

    imagesRef.current = images;

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  /* ── Canvas draw function ──────────────────────────────────────── */
  const drawFrame = useCallback((index) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const img = imagesRef.current[index];
    if (!img || !img.complete || !img.naturalWidth) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;

    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Object-cover math
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const canvasRatio = canvas.width / canvas.height;

    let sx, sy, sw, sh;
    if (imgRatio > canvasRatio) {
      // Image is wider → crop sides
      sh = img.naturalHeight;
      sw = sh * canvasRatio;
      sx = (img.naturalWidth - sw) / 2;
      sy = 0;
    } else {
      // Image is taller → crop top/bottom
      sw = img.naturalWidth;
      sh = sw / canvasRatio;
      sx = 0;
      sy = (img.naturalHeight - sh) / 2;
    }

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  }, []);

  /* ── Render loop: draw frames on scroll ────────────────────────── */
  useEffect(() => {
    if (!loaded) return;

    // Draw first frame immediately
    drawFrame(1);

    const unsubscribe = frameIndex.on("change", (value) => {
      const idx = Math.min(Math.max(Math.round(value), 1), TOTAL_FRAMES);
      if (idx !== currentFrameRef.current) {
        currentFrameRef.current = idx;
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(() => drawFrame(idx));
      }
    });

    return () => {
      unsubscribe();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [loaded, frameIndex, drawFrame]);

  /* ── Resize handler ────────────────────────────────────────────── */
  useEffect(() => {
    if (!loaded) return;
    const handleResize = () => {
      drawFrame(currentFrameRef.current || 1);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [loaded, drawFrame]);

  /* ── Compute text overlay opacity ──────────────────────────────── */
  function getOpacity(enter, exit) {
    const fadeIn = 0.04;
    const fadeOut = 0.04;
    if (scrollProgress < enter || scrollProgress > exit) return 0;
    if (scrollProgress < enter + fadeIn) return (scrollProgress - enter) / fadeIn;
    if (scrollProgress > exit - fadeOut) return (exit - scrollProgress) / fadeOut;
    return 1;
  }

  /* ── Compute Y translation for parallax feel ───────────────────── */
  function getTranslateY(enter, exit) {
    const mid = (enter + exit) / 2;
    if (scrollProgress < enter) return 30;
    if (scrollProgress < mid) {
      const t = (scrollProgress - enter) / (mid - enter);
      return 30 * (1 - t);
    }
    if (scrollProgress < exit) {
      const t = (scrollProgress - mid) / (exit - mid);
      return -20 * t;
    }
    return -20;
  }

  /* ── Alignment classes ─────────────────────────────────────────── */
  function alignClasses(align) {
    switch (align) {
      case "left":
        return "items-start text-left pl-8 sm:pl-16 md:pl-24 lg:pl-32";
      case "right":
        return "items-end text-right pr-8 sm:pr-16 md:pr-24 lg:pr-32";
      default:
        return "items-center text-center px-6";
    }
  }

  if (!loaded) {
    return <LoadingOverlay progress={loadProgress} />;
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ height: "400vh", background: "#050505" }}
    >
      {/* ── Sticky canvas ────────────────────────────────────────── */}
      <canvas
        ref={canvasRef}
        className="sticky top-0 w-full h-screen"
        style={{ display: "block", background: "#050505" }}
      />

      {/* ── Text overlays ────────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none z-10">
        {/* Vignette overlay for text readability */}
        <div
          className="absolute inset-0"
          style={{
            background:
              scrollProgress > 0.15
                ? `radial-gradient(ellipse 80% 70% at 50% 50%, transparent 30%, rgba(0,0,0,0.5) 100%)`
                : "none",
            transition: "background 0.5s ease",
          }}
        />

        {/* Sections 1-3: standard text overlays */}
        {TEXT_SECTIONS.slice(0, 3).map((section) => {
          const opacity = getOpacity(section.enter, section.exit);
          const translateY = getTranslateY(section.enter, section.exit);

          return (
            <div
              key={section.id}
              className={`absolute inset-0 flex flex-col justify-center ${alignClasses(section.align)}`}
              style={{
                opacity,
                transform: `translateY(${translateY}px)`,
                transition: "opacity 0.1s ease-out",
                willChange: "transform, opacity",
              }}
            >
              {section.content}
            </div>
          );
        })}

        {/* Section 4: CTA block */}
        {(() => {
          const cta = TEXT_SECTIONS[3];
          const opacity = getOpacity(cta.enter, cta.exit);
          const translateY = getTranslateY(cta.enter, cta.exit);

          return (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center px-6 pointer-events-auto"
              style={{
                opacity,
                transform: `translateY(${translateY}px)`,
                transition: "opacity 0.1s ease-out",
                willChange: "transform, opacity",
              }}
            >
              <h2 className="text-4xl sm:text-6xl md:text-7xl font-bold tracking-tight text-white leading-[0.95] mb-3">
                Secure Your Orbit.
              </h2>
              <p className="text-base sm:text-lg text-white/50 font-light tracking-wide mb-10">
                Real-time situational awareness for the new space era.
              </p>
              <button
                onClick={onEnter}
                className="group relative px-10 py-4 text-sm sm:text-base font-medium tracking-[0.2em] uppercase text-white border border-white/30 rounded-sm bg-transparent cursor-pointer overflow-hidden transition-all duration-500 hover:border-white/80 hover:tracking-[0.3em]"
              >
                {/* Hover fill animation */}
                <span className="absolute inset-0 bg-white/[0.06] scale-x-0 origin-left transition-transform duration-500 group-hover:scale-x-100" />
                <span className="relative z-10">Launch Console</span>
              </button>
            </div>
          );
        })()}

        {/* Scroll indicator — visible only at the very top */}
        <motion.div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: scrollProgress < 0.05 ? 1 : 0 }}
          transition={{ duration: 0.4 }}
        >
          <span className="text-[10px] font-mono tracking-[0.3em] uppercase text-white/40">
            Scroll
          </span>
          <motion.div
            className="w-[1px] h-8 bg-white/30"
            animate={{ scaleY: [0.3, 1, 0.3] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            style={{ transformOrigin: "top" }}
          />
        </motion.div>
      </div>
    </div>
  );
}
