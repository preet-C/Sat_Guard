import { useState, useRef, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

/**
 * InfoTip — Reusable hover tooltip for technical term explanations.
 * Rendered via React portal to document.body so it escapes any parent
 * container with backdrop-filter (which creates a new containing block)
 * or overflow:hidden.
 *
 * Positioned above the ⓘ icon (or below if near top of screen).
 * Includes a small delay on hide so the user can read the text.
 *
 * Usage: <InfoTip text="Probability of collision between two objects" />
 */
export default function InfoTip({ text }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, below: false });
  const iconRef = useRef(null);
  const tipRef = useRef(null);
  const hideTimerRef = useRef(null);

  // Recompute fixed position every time tooltip becomes visible
  useLayoutEffect(() => {
    if (!show || !iconRef.current) return;

    // Allow one frame for the portal to mount so tipRef is available
    requestAnimationFrame(() => {
      if (!iconRef.current) return;
      const rect = iconRef.current.getBoundingClientRect();
      const tipEl = tipRef.current;
      const tipW = tipEl ? tipEl.offsetWidth : 200;
      const tipH = tipEl ? tipEl.offsetHeight : 40;
      const TIP_OFFSET = 6;
      const MARGIN = 8;

      // Center horizontally on the icon, clamp to viewport
      let left = rect.left + rect.width / 2 - tipW / 2;
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - tipW - MARGIN));

      // Default: place above the icon
      let top = rect.top - tipH - TIP_OFFSET;
      let below = false;

      // If it would go off-screen top, flip below
      if (top < MARGIN) {
        top = rect.bottom + TIP_OFFSET;
        below = true;
      }

      setPos({ top, left, below });
    });
  }, [show]);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const handleEnter = useCallback(() => {
    cancelHide();
    setShow(true);
  }, [cancelHide]);

  const handleLeave = useCallback(() => {
    // Small delay so the cursor can briefly leave the icon without
    // instantly losing the tooltip (e.g. moving to read the text)
    hideTimerRef.current = setTimeout(() => setShow(false), 180);
  }, []);

  if (!text) return null;

  // Arrow: points down when tooltip is above, up when below
  const arrowStyle = {
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    borderLeft: "5px solid transparent",
    borderRight: "5px solid transparent",
    ...(pos.below
      ? { bottom: "100%", borderBottom: "5px solid var(--color-border-accent)" }
      : { top: "100%", borderTop: "5px solid var(--color-border-accent)" }),
  };

  const tipStyle = {
    position: "fixed",
    top: pos.top,
    left: pos.left,
    width: 210,
    maxWidth: 210,
    background: "rgba(10, 10, 26, 0.97)",
    border: "1px solid var(--color-border-accent)",
    borderRadius: "6px",
    padding: "6px 10px",
    fontSize: "11px",
    lineHeight: "1.4",
    color: "var(--color-text-primary)",
    whiteSpace: "normal",
    wordWrap: "break-word",
    zIndex: 99999,
    pointerEvents: "auto",
    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
  };

  return (
    <span
      className="inline-flex items-center"
      style={{ position: "relative", cursor: "help" }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <span
        ref={iconRef}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "14px",
          height: "14px",
          borderRadius: "50%",
          fontSize: "9px",
          fontWeight: 700,
          lineHeight: 1,
          color: show ? "var(--color-accent)" : "var(--color-text-muted)",
          border: `1px solid ${show ? "var(--color-accent)" : "var(--color-text-muted)"}`,
          marginLeft: "4px",
          flexShrink: 0,
          transition: "color 0.15s, border-color 0.15s",
        }}
      >
        i
      </span>

      {show &&
        createPortal(
          <span
            ref={tipRef}
            style={tipStyle}
            onMouseEnter={cancelHide}
            onMouseLeave={handleLeave}
          >
            {text}
            <span style={arrowStyle} />
          </span>,
          document.body
        )}
    </span>
  );
}
