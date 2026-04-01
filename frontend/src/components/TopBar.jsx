import useSatguardStore from "../store/satguardStore";
import { RewindIcon, PlayIcon, FastForwardIcon } from "./ui/Icons";

/**
 * TopBar.jsx — Fixed top bar overlay
 * Contains: SatGuard logo, UTC time (from Zustand simTime), playback controls, speed badge
 */
export default function TopBar() {
  const simTime = useSatguardStore((s) => s.simTime);
  const utc = formatUTC(simTime);

  return (
    <header
      id="top-bar"
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 h-12 panel-glass"
      style={{ borderBottom: "1px solid var(--color-border)" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 min-w-[140px]">
        <div
          className="w-2 h-2 rounded-full"
          style={{
            background: "var(--color-accent)",
            boxShadow: "0 0 8px var(--color-accent)",
          }}
        />
        <span className="text-base font-semibold tracking-wide" style={{ color: "var(--color-text-primary)" }}>
          satguard
        </span>
      </div>

      {/* UTC Clock */}
      <div
        className="flex items-center gap-2 px-4 py-1.5 rounded-md font-mono text-sm"
        style={{
          background: "rgba(0, 212, 255, 0.06)",
          border: "1px solid var(--color-border-accent)",
          color: "var(--color-accent)",
        }}
      >
        <span className="text-xs flex items-center" style={{ color: "var(--color-text-secondary)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
        </span>
        {utc}
      </div>

      {/* Playback Controls + Speed Badge */}
      <div className="flex items-center gap-3 min-w-[140px] justify-end">
        <div className="flex items-center gap-1">
          <PlayBtn icon={<RewindIcon size={13} />} title="Rewind" />
          <PlayBtn icon={<PlayIcon size={13} />} title="Play" accent />
          <PlayBtn icon={<FastForwardIcon size={13} />} title="Fast Forward" />
        </div>

        <div
          className="px-2.5 py-1 rounded text-xs font-semibold font-mono"
          style={{
            background: "rgba(0, 212, 255, 0.1)",
            border: "1px solid var(--color-border-accent)",
            color: "var(--color-accent)",
          }}
        >
          1×
        </div>
      </div>
    </header>
  );
}

/* ── Helpers ──────────────────── */

function formatUTC(date) {
  const d = date instanceof Date ? date : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function PlayBtn({ icon, title, accent }) {
  return (
    <button
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded-md text-sm transition-all duration-200 cursor-pointer"
      style={{
        background: accent ? "rgba(0, 212, 255, 0.15)" : "rgba(255, 255, 255, 0.05)",
        border: accent
          ? "1px solid var(--color-border-accent)"
          : "1px solid var(--color-border)",
        color: accent ? "var(--color-accent)" : "var(--color-text-secondary)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = accent
          ? "rgba(0, 212, 255, 0.25)"
          : "rgba(255, 255, 255, 0.1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = accent
          ? "rgba(0, 212, 255, 0.15)"
          : "rgba(255, 255, 255, 0.05)";
      }}
    >
      {icon}
    </button>
  );
}
