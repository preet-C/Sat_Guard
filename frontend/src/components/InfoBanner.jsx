import { useState, useEffect } from "react";
import { CloseIcon } from "./ui/Icons";

const STORAGE_KEY = "satguard_banner_dismissed";

/**
 * InfoBanner — Persistent disclaimer bar below TopBar.
 * Dismissable per session via localStorage.
 */
export default function InfoBanner() {
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "1";
    } catch {
      return true;
    }
  });

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  if (!visible) return null;

  return (
    <div
      id="info-banner"
      className="fixed left-0 right-0 z-[45] flex items-center justify-center px-4 py-1.5"
      style={{
        top: "48px",
        background: "rgba(10, 10, 26, 0.92)",
        borderBottom: "1px solid rgba(255, 165, 2, 0.2)",
      }}
    >
      <p
        className="text-xs text-center flex-1"
        style={{
          color: "rgba(255, 191, 71, 0.85)",
          fontFamily: "var(--font-sans)",
          letterSpacing: "0.01em",
        }}
      >
        <span style={{ marginRight: "6px", display: "inline-flex", verticalAlign: "middle" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "rgba(255, 191, 71, 0.85)" }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
        </span>
        Analysis uses SGP4/TLE public data. Results are indicative only
        — not for operational collision avoidance. TLE accuracy degrades
        with age.
      </p>
      <button
        onClick={dismiss}
        className="flex items-center justify-center cursor-pointer transition-colors duration-150"
        style={{
          background: "none",
          border: "none",
          color: "rgba(255, 191, 71, 0.5)",
          fontSize: "14px",
          padding: "0 2px",
          marginLeft: "12px",
          lineHeight: 1,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255, 191, 71, 0.9)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255, 191, 71, 0.5)"; }}
        title="Dismiss"
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
