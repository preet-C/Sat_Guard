import { useState, useMemo, useRef, useCallback } from "react";

/**
 * ContactGantt.jsx — Gantt Chart for satellite contact windows
 * X-axis: time span of the prediction window
 * Y-axis: ground stations
 * Horizontal pill-shaped bars for each pass, color-coded by max elevation.
 * Hover tooltips show exact AOS/LOS times, duration, and elevation.
 */

const ELEV_COLORS = {
  high:   { fill: "#4ade80", bg: "rgba(74,222,128,0.25)", border: "rgba(74,222,128,0.5)" },
  medium: { fill: "#ffa502", bg: "rgba(255,165,2,0.2)",   border: "rgba(255,165,2,0.4)" },
  low:    { fill: "#64748b", bg: "rgba(100,116,139,0.2)",  border: "rgba(100,116,139,0.4)" },
};

function getElevTier(maxElev) {
  if (maxElev >= 45) return "high";
  if (maxElev >= 20) return "medium";
  return "low";
}

function fmtUTC(date) {
  const d = new Date(date);
  const mo = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${mo}/${day} ${hh}:${mm}:${ss}`;
}

function fmtTime(date) {
  const d = new Date(date);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export default function ContactGantt({ contacts }) {
  const containerRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const { stations, timeMin, timeMax, timeSpanMs, tickCount } = useMemo(() => {
    if (!contacts || contacts.length === 0) return { stations: [], timeMin: 0, timeMax: 0, timeSpanMs: 0, tickCount: 0 };

    // Group by station, preserving order of first appearance
    const stationMap = new Map();
    let tMin = Infinity, tMax = -Infinity;

    for (const c of contacts) {
      const key = c.stationName;
      if (!stationMap.has(key)) {
        stationMap.set(key, { name: key, color: c.stationColor || "#00d4ff", passes: [] });
      }
      stationMap.get(key).passes.push(c);
      const aosMs = new Date(c.aos).getTime();
      const losMs = new Date(c.los).getTime();
      if (aosMs < tMin) tMin = aosMs;
      if (losMs > tMax) tMax = losMs;
    }

    // Pad time range by 2% on each side for visual breathing room
    const span = tMax - tMin;
    const padMs = Math.max(span * 0.02, 1800000); // at least 30 min
    tMin -= padMs;
    tMax += padMs;

    // Decide tick count based on time span
    const spanHours = (tMax - tMin) / 3600000;
    let ticks;
    if (spanHours <= 14) ticks = Math.ceil(spanHours / 2);       // every 2h
    else if (spanHours <= 30) ticks = Math.ceil(spanHours / 4);  // every 4h
    else if (spanHours <= 80) ticks = Math.ceil(spanHours / 8);  // every 8h
    else ticks = Math.ceil(spanHours / 24);                      // every day
    ticks = Math.max(4, Math.min(ticks, 12));

    return {
      stations: Array.from(stationMap.values()),
      timeMin: tMin,
      timeMax: tMax,
      timeSpanMs: tMax - tMin,
      tickCount: ticks,
    };
  }, [contacts]);

  const handleMouseEnter = useCallback((e, pass) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const durationMin = Math.floor(pass.duration / 60);
    const durationSec = Math.round(pass.duration % 60);
    const tier = getElevTier(pass.maxElevation);

    setTooltip({
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.top - containerRect.top - 4,
      text: [
        `${pass.stationName}`,
        `AOS: ${fmtUTC(pass.aos)} UTC`,
        `LOS: ${fmtUTC(pass.los)} UTC`,
        `Duration: ${durationMin}m ${durationSec}s`,
        `Max Elev: ${pass.maxElevation.toFixed(1)}° (${tier === "high" ? "High" : tier === "medium" ? "Medium" : "Low"})`,
      ],
    });
  }, []);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  if (stations.length === 0) return null;

  const ROW_H = 36;
  const LABEL_W = 110;
  const TOP_PAD = 4;
  const BOTTOM_PAD = 28;
  const chartH = stations.length * ROW_H + TOP_PAD + BOTTOM_PAD;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        borderRadius: "6px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        marginBottom: "14px",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <span style={{ fontSize: "11px", fontWeight: 600, color: "#8b9cb8", letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Pass Timeline
        </span>
        {/* Legend */}
        <div style={{ display: "flex", gap: "10px" }}>
          {[
            { color: "#4ade80", label: "≥45°" },
            { color: "#ffa502", label: "≥20°" },
            { color: "#64748b", label: "<20°" },
          ].map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "3px" }}>
              <div style={{ width: "10px", height: "5px", borderRadius: "3px", background: item.color, opacity: 0.8 }} />
              <span style={{ fontSize: "10px", color: "#64748b" }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Chart area */}
      <div style={{ display: "flex", height: chartH }}>
        {/* Station labels */}
        <div style={{ width: LABEL_W, flexShrink: 0, paddingTop: TOP_PAD }}>
          {stations.map((s, i) => (
            <div key={s.name} style={{
              height: ROW_H, display: "flex", alignItems: "center", gap: "6px",
              padding: "0 10px",
              borderBottom: i < stations.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
            }}>
              <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: s.color, flexShrink: 0 }} />
              <span style={{
                fontSize: "11px", color: "#cbd5e1", fontWeight: 500,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {s.name}
              </span>
            </div>
          ))}
        </div>

        {/* Timeline chart */}
        <div style={{ flex: 1, position: "relative", borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          {/* Time grid lines + labels */}
          {Array.from({ length: tickCount + 1 }, (_, i) => {
            const pct = (i / tickCount) * 100;
            const tickMs = timeMin + (timeSpanMs * i) / tickCount;
            return (
              <div key={i} style={{ position: "absolute", left: `${pct}%`, top: 0, bottom: 0 }}>
                {/* Grid line */}
                <div style={{
                  position: "absolute", left: 0, top: TOP_PAD, bottom: BOTTOM_PAD,
                  width: "1px", background: "rgba(255,255,255,0.04)",
                }} />
                {/* Time label */}
                <div style={{
                  position: "absolute", bottom: "4px", left: "-18px", width: "36px",
                  fontSize: "9px", color: "#64748b", textAlign: "center",
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {fmtTime(tickMs)}
                </div>
              </div>
            );
          })}

          {/* Station rows with pass bars */}
          {stations.map((s, stationIdx) => (
            <div key={s.name} style={{
              position: "absolute",
              top: TOP_PAD + stationIdx * ROW_H,
              left: 0, right: 0, height: ROW_H,
              borderBottom: stationIdx < stations.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
            }}>
              {/* Row hover highlight */}
              <div style={{
                position: "absolute", inset: 0,
                background: "transparent",
                transition: "background 0.15s",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.015)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              />

              {/* Pass pills */}
              {s.passes.map((pass, pIdx) => {
                const aosMs = new Date(pass.aos).getTime();
                const losMs = new Date(pass.los).getTime();
                const leftPct = ((aosMs - timeMin) / timeSpanMs) * 100;
                const widthPct = Math.max(((losMs - aosMs) / timeSpanMs) * 100, 0.5);
                const tier = getElevTier(pass.maxElevation);
                const colors = ELEV_COLORS[tier];

                return (
                  <div
                    key={`${pass.stationId}-${pIdx}`}
                    style={{
                      position: "absolute",
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      minWidth: "4px",
                      top: "8px",
                      height: ROW_H - 16,
                      borderRadius: "4px",
                      background: colors.bg,
                      border: `1px solid ${colors.border}`,
                      cursor: "pointer",
                      transition: "transform 0.15s, box-shadow 0.15s",
                      zIndex: 2,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "scaleY(1.3)";
                      e.currentTarget.style.boxShadow = `0 0 8px ${colors.fill}40`;
                      handleMouseEnter(e, pass);
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "scaleY(1)";
                      e.currentTarget.style.boxShadow = "none";
                      handleMouseLeave();
                    }}
                  >
                    {/* Inner fill bar */}
                    <div style={{
                      position: "absolute", inset: 0,
                      borderRadius: "3px",
                      background: `linear-gradient(90deg, ${colors.fill}60, ${colors.fill}30)`,
                    }} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Floating tooltip */}
      {tooltip && (
        <div style={{
          position: "absolute",
          left: Math.min(tooltip.x, (containerRef.current?.clientWidth || 0) - 200),
          top: tooltip.y,
          transform: "translate(-50%, -100%)",
          background: "rgba(13,17,23,0.96)",
          border: "1px solid rgba(0,212,255,0.3)",
          borderRadius: "6px",
          padding: "8px 12px",
          pointerEvents: "none",
          zIndex: 20,
          minWidth: "180px",
          backdropFilter: "blur(8px)",
        }}>
          {tooltip.text.map((line, i) => (
            <div key={i} style={{
              fontSize: i === 0 ? "12px" : "11px",
              fontWeight: i === 0 ? 600 : 400,
              color: i === 0 ? "#f1f5f9" : "#94a3b8",
              fontFamily: i > 0 ? "'JetBrains Mono', monospace" : "inherit",
              lineHeight: 1.5,
            }}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
