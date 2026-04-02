import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import useSatguardStore from "../store/satguardStore";
import ContactGantt from "./ui/ContactGantt";

/**
 * ContactTimeline.jsx — Mission Analysis Drawer
 * Collapsed: slim bar with pass preview.
 * Expanded: 58vh panel with Safe Slots / Contact Windows tabs.
 *
 * UI Overhaul v2: Two-column layout, comparison table, DeltaV dashboard,
 * readability fixes, and Preview-on-Globe → ConjunctionPanel wiring.
 */

const DRAWER_TABS = [
  { id: "safeSlots", label: "Safe Slots" },
  { id: "contactWindows", label: "Contact Windows" },
];

/* ── Stage metadata for progress display ─────────────────────── */
const SLOT_STAGE_NAMES = ["Initializing", "Generating candidates", "Screening orbits", "Deep analysis"];
const SLOT_STAGE_DESCS = [
  "Preparing search parameters...",
  "Generating candidate orbits using Latin Hypercube Sampling",
  "Running Hoots filter + 1-day coarse SGP4 pass on 200 candidates",
  "Full 7-day conjunction scan on finalists",
];
const SLOT_STAGE_WEIGHTS = [0, 0.05, 0.40, 1.0];

/* ── Safety color utilities ─────────────────────────────────── */
function safetyColor(rank) {
  if (rank === 1) return { border: "#4ade80", bg: "rgba(74, 222, 128, 0.08)", text: "#4ade80", label: "SAFEST" };
  if (rank === 2) return { border: "#00d4ff", bg: "rgba(0, 212, 255, 0.08)", text: "#00d4ff", label: "SAFER" };
  return { border: "#ffa502", bg: "rgba(255, 165, 2, 0.08)", text: "#ffa502", label: "SAFE" };
}

function formatPc(pc) {
  if (pc === 0) return "0";
  return pc.toExponential(2);
}

/* ── useMediaQuery hook ────────────────────────────────────── */
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

/* ── Scatter Plot (canvas-rendered) ──────────────────────────── */
function SafeSlotScatterPlot({ allCandidates, results, baselineMetrics, height = 220 }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !allCandidates || allCandidates.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const ml = 48, mr = 16, mt = 12, mb = 32;
    const pw = width - ml - mr;
    const ph = height - mt - mb;

    ctx.clearRect(0, 0, width, height);

    const minDists = allCandidates.map((c) => c.coarseMinDist).filter((d) => d < 9000);
    const approaches = allCandidates.map((c) => c.closeApproachCount);
    const maxApproach = Math.max(...approaches, 1);
    const maxDist = Math.max(...minDists, 1);

    // Axes
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ml, mt); ctx.lineTo(ml, mt + ph); ctx.lineTo(ml + pw, mt + ph);
    ctx.stroke();

    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const y = mt + (ph * i) / 4;
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke();
    }

    // Y-axis label
    ctx.save();
    ctx.fillStyle = "#8b9cb8";
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.translate(14, mt + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Close Approaches", 0, 0);
    ctx.restore();

    // X-axis label
    ctx.fillStyle = "#8b9cb8";
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Min Miss Distance (km)", ml + pw / 2, height - 4);

    // Plot candidates
    for (const c of allCandidates) {
      if (c.coarseMinDist >= 9000) continue;
      const x = ml + (c.coarseMinDist / maxDist) * pw;
      const y = mt + ph - (c.closeApproachCount / maxApproach) * ph;
      const isFinalist = c.isFinalist;

      ctx.beginPath();
      ctx.arc(x, y, isFinalist ? 5 : 3, 0, 2 * Math.PI);
      if (isFinalist) {
        ctx.fillStyle = "#4ade80";
        ctx.globalAlpha = 0.8;
      } else if (c.closeApproachCount > maxApproach * 0.6) {
        ctx.fillStyle = "#ff4757";
        ctx.globalAlpha = 0.5;
      } else if (c.closeApproachCount > maxApproach * 0.3) {
        ctx.fillStyle = "#ffa502";
        ctx.globalAlpha = 0.5;
      } else {
        ctx.fillStyle = "#4ade80";
        ctx.globalAlpha = 0.4;
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Plot baseline
    if (baselineMetrics && baselineMetrics.minMissDistance < 9000) {
      const bx = ml + (baselineMetrics.minMissDistance / maxDist) * pw;
      const by = mt + ph - (baselineMetrics.totalConjunctions / maxApproach) * ph;
      ctx.beginPath();
      ctx.moveTo(bx - 6, by); ctx.lineTo(bx, by - 6); ctx.lineTo(bx + 6, by); ctx.lineTo(bx, by + 6);
      ctx.closePath();
      ctx.fillStyle = "#00d4ff";
      ctx.fill();
      ctx.strokeStyle = "#00d4ff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [allCandidates, results, baselineMetrics, height]);

  useEffect(() => {
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  const handleMouseMove = useCallback((e) => {
    if (!allCandidates || allCandidates.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const ml2 = 48, mr2 = 16, mt2 = 12, mb2 = 32;
    const pw2 = rect.width - ml2 - mr2;
    const ph2 = rect.height - mt2 - mb2;
    const minDists = allCandidates.map((c) => c.coarseMinDist).filter((d) => d < 9000);
    const approaches = allCandidates.map((c) => c.closeApproachCount);
    const maxA = Math.max(...approaches, 1);
    const maxD = Math.max(...minDists, 1);

    let closest = null;
    let closestDist = 20;
    for (const c of allCandidates) {
      if (c.coarseMinDist >= 9000) continue;
      const x = ml2 + (c.coarseMinDist / maxD) * pw2;
      const y = mt2 + ph2 - (c.closeApproachCount / maxA) * ph2;
      const d = Math.sqrt((mx - x) ** 2 + (my - y) ** 2);
      if (d < closestDist) { closestDist = d; closest = { ...c, px: x, py: y }; }
    }
    if (closest) {
      setTooltip({
        x: closest.px, y: closest.py,
        text: `Alt: ${closest.orbitParams.altitude.toFixed(0)}km, Inc: ${closest.orbitParams.inclination.toFixed(1)}°\nApproaches: ${closest.closeApproachCount}, Min: ${closest.coarseMinDist.toFixed(1)}km`,
      });
    } else {
      setTooltip(null);
    }
  }, [allCandidates]);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        style={{ cursor: "crosshair", display: "block" }}
      />
      {/* Legend */}
      <div style={{
        display: "flex", gap: "12px", justifyContent: "center",
        marginTop: "6px", flexWrap: "wrap",
      }}>
        {[
          { color: "#4ade80", label: "Safer" },
          { color: "#ffa502", label: "Moderate" },
          { color: "#ff4757", label: "Riskier" },
          { color: "#00d4ff", label: "Current", shape: "diamond" },
        ].map((item) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{
              width: "8px", height: "8px", borderRadius: item.shape === "diamond" ? "1px" : "50%",
              background: item.color, transform: item.shape === "diamond" ? "rotate(45deg) scale(0.8)" : "none",
            }} />
            <span style={{ fontSize: "11px", color: "#8b9cb8" }}>{item.label}</span>
          </div>
        ))}
      </div>
      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: "absolute", left: tooltip.x + 10, top: tooltip.y - 40,
          background: "rgba(13, 17, 23, 0.95)", border: "1px solid rgba(0,212,255,0.3)",
          borderRadius: "4px", padding: "4px 8px", pointerEvents: "none",
          fontSize: "11px", color: "#cbd5e1", whiteSpace: "pre-line", zIndex: 10,
        }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

/* ── Progress Display ────────────────────────────────────────── */
function SafeSlotProgressDisplay({ progress }) {
  if (!progress) return null;
  const stageIdx = Math.min(progress.stage || 0, 3);
  const stageName = SLOT_STAGE_NAMES[stageIdx];
  const stageDesc = SLOT_STAGE_DESCS[stageIdx];
  const innerPct = progress.pct || 0;
  const totalPct = Math.round((SLOT_STAGE_WEIGHTS[Math.max(stageIdx - 1, 0)] + (innerPct / 100) * (SLOT_STAGE_WEIGHTS[stageIdx] - SLOT_STAGE_WEIGHTS[Math.max(stageIdx - 1, 0)])) * 100);
  const statusMsg = progress.msg || "Processing...";

  return (
    <div style={{
      width: "100%", maxWidth: "480px",
      padding: "16px 20px", borderRadius: "8px",
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(0,212,255,0.15)",
    }}>
      {/* Header + percentage */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: "13px", color: "#00d4ff" }}>&#10023;</span>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#f1f5f9" }}>Searching Safer Slots</span>
        </div>
        <span className="font-mono" style={{ fontSize: "13px", fontWeight: 600, color: "#00d4ff" }}>
          {totalPct}%
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        height: "4px", borderRadius: "2px", background: "rgba(255,255,255,0.06)", marginBottom: "10px", overflow: "hidden",
      }}>
        <div style={{
          height: "100%", borderRadius: "2px",
          background: "linear-gradient(90deg, #00d4ff, #4ade80)",
          width: `${totalPct}%`,
          transition: "width 0.3s ease",
        }} />
      </div>

      {/* Stage info */}
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono" style={{
          fontSize: "10px", fontWeight: 600, color: "#0d1117",
          background: "#00d4ff", padding: "2px 8px", borderRadius: "3px",
          letterSpacing: "0.03em", textTransform: "uppercase", flexShrink: 0,
        }}>
          Stage {progress?.stage || 0}/3
        </span>
        <span style={{ color: "#b0bec5", fontSize: "12px", fontWeight: 500 }}>
          {stageName}
        </span>
      </div>

      {/* Stage description */}
      <div style={{ color: "#8b9cb8", fontSize: "12px", lineHeight: 1.4, marginBottom: "6px" }}>
        {stageDesc}
      </div>

      {/* Live status message */}
      <div className="font-mono" style={{
        color: "#b0bec5", fontSize: "11px", lineHeight: 1.4,
        padding: "6px 8px", borderRadius: "4px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}>
        {statusMsg}
      </div>
    </div>
  );
}

/* ── Safe Slot Result Card ───────────────────────────────────── */
function SafeSlotCard({ result, targetOrbitParams, onPreview, onApply, isSelected }) {
  const sc = safetyColor(result.rank);
  const params = result.orbitParams;

  const PARAM_FIELDS = [
    { key: "altitude", label: "Alt", unit: "km", decimals: 1 },
    { key: "inclination", label: "Inc", unit: "°", decimals: 2 },
    { key: "eccentricity", label: "Ecc", unit: "", decimals: 4 },
    { key: "raan", label: "RAAN", unit: "°", decimals: 1 },
    { key: "argPerigee", label: "ArgP", unit: "°", decimals: 1 },
    { key: "meanAnomaly", label: "MA", unit: "°", decimals: 1 },
  ];

  return (
    <div
      className="rounded-lg transition-all duration-200"
      style={{
        padding: "14px 16px",
        background: isSelected ? sc.bg.replace(/[\d.]+\)$/, "0.18)") : sc.bg,
        borderTop: isSelected ? `1.5px solid ${sc.border}` : `1px solid rgba(255,255,255,0.1)`,
        borderRight: isSelected ? `1.5px solid ${sc.border}` : `1px solid rgba(255,255,255,0.1)`,
        borderBottom: isSelected ? `1.5px solid ${sc.border}` : `1px solid rgba(255,255,255,0.1)`,
        borderLeft: `3px solid ${sc.border}`,
        boxShadow: isSelected ? `0 0 12px ${sc.border}22` : "none",
      }}
    >
      {/* Header: rank + safety badge + deltaV */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono" style={{ fontSize: "15px", fontWeight: 700, color: sc.text }}>
            #{result.rank}
          </span>
          <span style={{
            fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "4px",
            background: sc.bg, color: sc.text,
            border: `1px solid ${sc.border}33`,
            letterSpacing: "0.04em",
          }}>
            {sc.label}
          </span>
        </div>
        <span className="font-mono" style={{
          fontSize: "12px", color: "#cbd5e1", fontWeight: 600,
          padding: "2px 8px", borderRadius: "3px",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}>
          ~{result.deltaV_ms.toFixed(1)} m/s ΔV
        </span>
      </div>

      {/* Orbit params grid with sparkline bars */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", marginBottom: "10px" }}>
        {PARAM_FIELDS.map((f) => {
          const val = params[f.key];
          const base = targetOrbitParams[f.key];
          const delta = val - base;
          const showDelta = Math.abs(delta) > (f.key === "eccentricity" ? 0.0001 : 0.05);
          // Sparkline: normalize delta against a reasonable range for each param
          const maxRange = f.key === "altitude" ? 150 : f.key === "inclination" ? 10 : f.key === "eccentricity" ? 0.1 : 30;
          const normalized = Math.min(Math.abs(delta) / maxRange, 1);
          const barColor = delta > 0 ? "#4ade80" : "#ffa502";
          return (
            <div key={f.key} style={{
              padding: "4px 6px", borderRadius: "4px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}>
              <div style={{ fontSize: "11px", color: "#8b9cb8", marginBottom: "1px" }}>{f.label}</div>
              <div className="font-mono" style={{ fontSize: "13px", color: "#f1f5f9" }}>
                {val.toFixed(f.decimals)}{f.unit}
              </div>
              {showDelta && (
                <>
                  <div className="font-mono" style={{
                    fontSize: "10px",
                    color: barColor,
                    marginBottom: "2px",
                  }}>
                    {delta > 0 ? "+" : ""}{delta.toFixed(f.decimals)}
                  </div>
                  {/* Sparkline bar */}
                  <div style={{
                    height: "3px", borderRadius: "1.5px",
                    background: "rgba(255,255,255,0.06)",
                    overflow: "hidden",
                    position: "relative",
                  }}>
                    <div style={{
                      position: "absolute",
                      left: delta >= 0 ? "50%" : `${50 - normalized * 50}%`,
                      width: `${normalized * 50}%`,
                      height: "100%",
                      borderRadius: "1.5px",
                      background: `linear-gradient(90deg, ${barColor}40, ${barColor})`,
                      transition: "width 0.4s ease-out, left 0.4s ease-out",
                    }} />
                    {/* Center marker */}
                    <div style={{
                      position: "absolute", left: "50%", top: 0, bottom: 0,
                      width: "1px", background: "rgba(255,255,255,0.15)",
                      transform: "translateX(-0.5px)",
                    }} />
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Metrics row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginBottom: "10px" }}>
        <MetricMini label="Conjunctions" value={String(result.totalConjunctions)} />
        <MetricMini label="Worst Pc" value={formatPc(result.worstPc)} />
        <MetricMini label="Min Miss" value={`${result.minMissDistance >= 9000 ? "None" : result.minMissDistance.toFixed(1) + " km"}`} />
      </div>

      {/* Reason */}
      <div style={{
        fontSize: "12px", color: "#b0bec5", fontStyle: "italic",
        lineHeight: 1.4, marginBottom: "10px",
      }}>
        {result.reason}
      </div>

      {/* Preview button */}
      <button
        onClick={onPreview}
        className="w-full cursor-pointer transition-all duration-200"
        style={{
          height: "32px", borderRadius: "5px", fontSize: "12px", fontWeight: 600,
          letterSpacing: "0.03em",
          background: isSelected ? "rgba(0, 212, 255, 0.15)" : "transparent",
          color: "#00d4ff",
          border: `1px solid ${isSelected ? "#00d4ff" : "rgba(0, 212, 255, 0.3)"}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(0, 212, 255, 0.12)";
          e.currentTarget.style.borderColor = "#00d4ff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = isSelected ? "rgba(0, 212, 255, 0.15)" : "transparent";
          e.currentTarget.style.borderColor = isSelected ? "#00d4ff" : "rgba(0, 212, 255, 0.3)";
        }}
      >
        {isSelected ? "Previewing on Globe" : "Preview on Globe"}
      </button>

      {/* Apply to Mission — primary action */}
      <button
        onClick={onApply}
        className="w-full cursor-pointer transition-all duration-200"
        style={{
          height: "34px", borderRadius: "5px", fontSize: "12px", fontWeight: 600,
          letterSpacing: "0.03em", marginTop: "6px",
          background: `linear-gradient(135deg, ${sc.border} 0%, ${sc.border}99 100%)`,
          color: "#0a0a1a",
          border: "none",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; e.currentTarget.style.transform = "translateY(-1px)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateY(0)"; }}
      >
        Apply to Mission
      </button>
    </div>
  );
}

function MetricMini({ label, value }) {
  return (
    <div style={{
      textAlign: "center", padding: "5px", borderRadius: "4px",
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
    }}>
      <div style={{ fontSize: "11px", color: "#8b9cb8" }}>{label}</div>
      <div className="font-mono" style={{ fontSize: "13px", color: "#f1f5f9" }}>{value}</div>
    </div>
  );
}

/* ── Slot Comparison Table (with Baseline Column) ────────────── */
function SlotComparisonTable({ results, baselineMetrics }) {
  if (!results || results.length === 0) return null;

  const hasBaseline = baselineMetrics && baselineMetrics.orbitParams;
  const colCount = results.length + (hasBaseline ? 1 : 0);

  const rows = [
    { label: "Altitude", key: "altitude", unit: "km", dec: 1 },
    { label: "Inclination", key: "inclination", unit: "°", dec: 2 },
    { label: "Conjunctions", key: "totalConjunctions", unit: "", dec: 0, lowerBetter: true },
    { label: "Min Miss", key: "minMissDistance", unit: "km", dec: 1, lowerBetter: false },
    { label: "Worst Pc", key: "worstPc", unit: "", dec: -1, lowerBetter: true },
    { label: "\u0394V", key: "deltaV_ms", unit: "m/s", dec: 1, lowerBetter: true },
  ];

  const getCellValue = (result, row) => {
    if (row.key === "altitude" || row.key === "inclination") {
      return result.orbitParams?.[row.key];
    }
    return result[row.key];
  };

  const getBaselineValue = (row) => {
    if (!baselineMetrics) return undefined;
    if (row.key === "altitude" || row.key === "inclination") {
      return baselineMetrics.orbitParams?.[row.key];
    }
    return baselineMetrics[row.key];
  };

  const formatValue = (val, row) => {
    if (val === undefined || val === null) return "-";
    if (row.key === "worstPc") return formatPc(val);
    if (row.key === "minMissDistance" && val >= 9000) return "None";
    return row.dec >= 0 ? val.toFixed(row.dec) : String(val);
  };

  const cellColor = (val, row) => {
    if (!baselineMetrics || val === undefined) return "#cbd5e1";
    let baseVal;
    if (row.key === "totalConjunctions") baseVal = baselineMetrics.totalConjunctions;
    else if (row.key === "minMissDistance") baseVal = baselineMetrics.minMissDistance;
    else if (row.key === "worstPc") baseVal = baselineMetrics.worstPc;
    else return "#cbd5e1";

    if (row.lowerBetter) {
      return val < baseVal ? "#4ade80" : val > baseVal ? "#ffa502" : "#cbd5e1";
    } else {
      return val > baseVal ? "#4ade80" : val < baseVal ? "#ffa502" : "#cbd5e1";
    }
  };

  return (
    <div style={{
      borderRadius: "6px", overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.08)",
    }}>
      {/* Header row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `100px repeat(${colCount}, 1fr)`,
        background: "rgba(255,255,255,0.04)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ padding: "6px 10px", fontSize: "11px", color: "#64748b", fontWeight: 600 }}>Metric</div>
        {hasBaseline && (
          <div style={{
            padding: "6px 8px", fontSize: "11px", fontWeight: 600,
            color: "#00d4ff", textAlign: "center",
            borderRight: "1px solid rgba(255,255,255,0.08)",
          }}>
            Current
          </div>
        )}
        {results.map((r) => {
          const sc = safetyColor(r.rank);
          return (
            <div key={r.rank} style={{
              padding: "6px 8px", fontSize: "11px", fontWeight: 600,
              color: sc.text, textAlign: "center",
            }}>
              #{r.rank}
            </div>
          );
        })}
      </div>
      {/* Data rows */}
      {rows.map((row, ri) => (
        <div key={row.key} style={{
          display: "grid",
          gridTemplateColumns: `100px repeat(${colCount}, 1fr)`,
          borderBottom: ri < rows.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
          background: ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
        }}>
          <div style={{ padding: "5px 10px", fontSize: "11px", color: "#8b9cb8" }}>
            {row.label}
          </div>
          {hasBaseline && (
            <div className="font-mono" style={{
              padding: "5px 8px", fontSize: "12px", textAlign: "center",
              color: "#00d4ff",
              borderRight: "1px solid rgba(255,255,255,0.08)",
            }}>
              {formatValue(getBaselineValue(row), row)}{row.unit && getBaselineValue(row) !== undefined && getBaselineValue(row) < 9000 ? ` ${row.unit}` : ""}
            </div>
          )}
          {results.map((r) => {
            const val = getCellValue(r, row);
            return (
              <div key={r.rank} className="font-mono" style={{
                padding: "5px 8px", fontSize: "12px", textAlign: "center",
                color: cellColor(val, row),
              }}>
                {formatValue(val, row)}{row.unit && val !== undefined && val < 9000 ? ` ${row.unit}` : ""}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ── Delta-V Dashboard ───────────────────────────────────────── */
function DeltaVDashboard({ results }) {
  if (!results || results.length === 0) return null;
  const maxDV = Math.max(...results.map((r) => r.deltaV_ms), 1);

  const dvCategory = (dv) => {
    if (dv < 50) return { label: "Low-cost", color: "#4ade80" };
    if (dv < 200) return { label: "Moderate", color: "#ffa502" };
    return { label: "Major", color: "#ff4757" };
  };

  return (
    <div style={{
      padding: "12px 14px", borderRadius: "6px",
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.08)",
    }}>
      <div style={{ fontSize: "11px", color: "#8b9cb8", marginBottom: "10px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
        Maneuver Cost (ΔV)
      </div>
      {results.map((r) => {
        const sc = safetyColor(r.rank);
        const pct = Math.max((r.deltaV_ms / maxDV) * 100, 4);
        const cat = dvCategory(r.deltaV_ms);
        return (
          <div key={r.rank} style={{ marginBottom: "8px" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: "3px" }}>
              <span style={{ fontSize: "12px", color: sc.text, fontWeight: 600 }}>#{r.rank}</span>
              <span className="font-mono" style={{ fontSize: "12px", color: "#cbd5e1" }}>
                {r.deltaV_ms.toFixed(1)} m/s
                <span style={{ fontSize: "10px", color: cat.color, marginLeft: "6px" }}>{cat.label}</span>
              </span>
            </div>
            <div style={{
              height: "6px", borderRadius: "3px",
              background: "rgba(255,255,255,0.06)",
              overflow: "hidden",
            }}>
              <div style={{
                height: "100%", borderRadius: "3px",
                width: `${pct}%`,
                background: `linear-gradient(90deg, ${sc.border}, ${sc.border}88)`,
                transition: "width 0.5s ease-out",
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
 * Main component
 * ════════════════════════════════════════════════════════════════════ */
export default function ContactTimeline() {
  const isCollapsed = useSatguardStore((s) => s.isTimelineCollapsed);
  const setCollapsed = useSatguardStore((s) => s.setTimelineCollapsed);
  const safeSlotAnalysis = useSatguardStore((s) => s.safeSlotAnalysis);
  const safeSlotProgress = useSatguardStore((s) => s.safeSlotProgress);
  const targetOrbitParams = useSatguardStore((s) => s.targetOrbitParams);
  const setTargetOrbitParams = useSatguardStore((s) => s.setTargetOrbitParams);
  const setPreviewOrbitParams = useSatguardStore((s) => s.setPreviewOrbitParams);
  const setConjunctionAnalysis = useSatguardStore((s) => s.setConjunctionAnalysis);
  const setSelectedConjunction = useSatguardStore((s) => s.setSelectedConjunction);
  const contacts = useSatguardStore((s) => s.contacts);
  const contactsLoading = useSatguardStore((s) => s.contactsLoading);
  const contactsError = useSatguardStore((s) => s.contactsError);
  const contactsProgress = useSatguardStore((s) => s.contactsProgress);

  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState("safeSlots");
  const [previewingRank, setPreviewingRank] = useState(null);
  const [appliedRank, setAppliedRank] = useState(null);
  const isWide = useMediaQuery("(min-width: 1200px)");

  // Auto-expand when safe slot search starts
  useEffect(() => {
    if (safeSlotAnalysis.loading) {
      setExpanded(true);
      setActiveTab("safeSlots");
    }
  }, [safeSlotAnalysis.loading]);

  // Auto-expand when contact window analysis starts
  useEffect(() => {
    if (contactsLoading) {
      setExpanded(true);
      setActiveTab("contactWindows");
    }
  }, [contactsLoading]);

  const handleToggle = () => {
    if (expanded) {
      setExpanded(false);
    } else if (isCollapsed) {
      setCollapsed(false);
    } else {
      setExpanded(true);
    }
  };

  const handleClose = () => {
    setExpanded(false);
  };

  const handlePreview = (result) => {
    // Clear any selected conjunction to clean up B-plane overlays
    setSelectedConjunction(null);

    if (previewingRank === result.rank) {
      // Deselect — restore engine source marker and clear preview
      setPreviewingRank(null);
      setPreviewOrbitParams(null);
      setConjunctionAnalysis({
        results: [],
        source: "engine",
        safeSlotRank: null,
      });
      return;
    }
    setPreviewingRank(result.rank);

    // Update orbit preview on globe (non-destructive — doesn't touch targetOrbitParams)
    setPreviewOrbitParams({
      ...result.orbitParams,
      orbitCount: targetOrbitParams.orbitCount || 1,
    });

    // Inject conjunction details into the Conjunctions panel
    if (result.conjunctionDetails && result.conjunctionDetails.length > 0) {
      setConjunctionAnalysis({
        results: result.conjunctionDetails,
        loading: false,
        error: null,
        lastRun: new Date().toISOString(),
        source: "safeSlot",
        safeSlotRank: result.rank,
        targetOrbit: {
          name: "MY-SAT",
          tle1: result.tle1 || null,
          tle2: result.tle2 || null,
        },
        targetOrbitParamsSnapshot: { ...result.orbitParams },
      });
    }
  };

  const handleApplyToMission = (result) => {
    // 0. Clear any selected conjunction B-plane overlay
    setSelectedConjunction(null);

    // 1. Overwrite targetOrbitParams — this IS destructive (updates input sliders)
    setTargetOrbitParams({
      ...result.orbitParams,
      orbitCount: targetOrbitParams.orbitCount || 1,
    });

    // 2. Clear preview orbit (no longer previewing)
    setPreviewOrbitParams(null);

    // 3. Inject conjunction details as the new baseline
    setConjunctionAnalysis({
      results: result.conjunctionDetails || [],
      loading: false,
      error: null,
      source: "engine",
      safeSlotRank: null,
      lastRun: new Date().toISOString(),
      targetOrbit: {
        name: "MY-SAT",
        tle1: result.tle1 || null,
        tle2: result.tle2 || null,
      },
      targetOrbitParamsSnapshot: { ...result.orbitParams },
    });

    // 4. Mark as applied, clear preview
    setAppliedRank(result.rank);
    setPreviewingRank(null);

    // 5. Collapse the drawer
    setExpanded(false);
  };

  /* Compute transform */
  let transform;
  if (expanded) {
    transform = "translateY(0)";
  } else if (isCollapsed) {
    transform = "translateY(calc(100% - 32px))";
  } else {
    transform = "translateY(calc(100% - 32px))";
  }

  const { results, allCandidates, baselineMetrics, loading, error, lastRun } = safeSlotAnalysis;
  const hasResults = !loading && !error && results && results.length > 0;

  return (
    <div
      id="contact-timeline"
      className="fixed left-0 right-0 bottom-0 z-40"
      style={{
        height: expanded ? "58vh" : "auto",
        transform,
        transition: "transform 380ms cubic-bezier(0.4, 0, 0.2, 1), height 380ms cubic-bezier(0.4, 0, 0.2, 1)",
        background: expanded ? "#0d1117" : "rgba(22, 33, 62, 0.96)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      {/* Toggle bar */}
      <button
        className="w-full h-8 flex items-center justify-center cursor-pointer transition-colors duration-200"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--color-text-secondary)",
          fontSize: "10px",
          letterSpacing: "1px",
          flexShrink: 0,
        }}
        onClick={handleToggle}
        title={expanded ? "Collapse drawer" : "Expand mission analysis"}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-accent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-secondary)"; }}
      >
        {expanded ? "\u25BC  MISSION ANALYSIS  \u25BC" : "\u25B2  MISSION ANALYSIS  \u25B2"}
      </button>

      {/* Expanded drawer content */}
      {expanded && (
        <div style={{
          display: "flex",
          flexDirection: "column",
          height: "calc(100% - 32px)",
          overflow: "hidden",
        }}>
          {/* Tab bar + close */}
          <div style={{
            display: "flex",
            alignItems: "center",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            padding: "0 20px",
            flexShrink: 0,
          }}>
            {DRAWER_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: "10px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    background: "transparent",
                    border: "none",
                    borderBottom: isActive ? "2px solid #00d4ff" : "2px solid transparent",
                    color: isActive ? "#ffffff" : "#64748b",
                    transition: "all 0.2s",
                    letterSpacing: "0.02em",
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = "#94a3b8"; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = "#64748b"; }}
                >
                  {tab.label}
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            <button
              onClick={handleClose}
              style={{
                width: "28px", height: "28px",
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: "4px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "var(--color-text-secondary)",
                fontSize: "13px", cursor: "pointer",
                transition: "all 0.2s",
              }}
              title="Close drawer"
              onMouseEnter={(e) => { e.currentTarget.style.color = "#00d4ff"; e.currentTarget.style.borderColor = "rgba(0,212,255,0.3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-secondary)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
            >
              &#10005;
            </button>
          </div>

          {/* Tab content */}
          <div style={{
            flex: 1, overflow: "auto", padding: "16px 20px",
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(0,212,255,0.3) transparent",
          }}>
            {activeTab === "safeSlots" && (
              <div>
                {/* Loading state */}
                {loading && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "200px" }}>
                    <SafeSlotProgressDisplay progress={safeSlotProgress} />
                  </div>
                )}

                {/* Error state */}
                {!loading && error && (
                  <div
                    className="text-xs px-4 py-3 rounded-md"
                    style={{
                      background: "rgba(255,71,87,0.1)",
                      border: "1px solid rgba(255,71,87,0.3)",
                      color: "#ff4757",
                      maxWidth: "480px", margin: "0 auto",
                    }}
                  >
                    {error}
                  </div>
                )}

                {/* ═══ RESULTS — Two-column layout ═══ */}
                {hasResults && (
                  <div className="animate-fade-in" style={{
                    display: isWide ? "grid" : "flex",
                    gridTemplateColumns: isWide ? "minmax(320px, 2fr) minmax(380px, 3fr)" : undefined,
                    flexDirection: isWide ? undefined : "column",
                    gap: "20px",
                  }}>
                    {/* ── LEFT COLUMN: Analytics ── */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                      {/* Baseline comparison bar */}
                      {baselineMetrics && (
                        <div style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          gap: "12px", padding: "10px 14px",
                          borderRadius: "6px",
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          flexWrap: "wrap",
                        }}>
                          <span style={{ fontSize: "12px", color: "#8b9cb8", fontWeight: 600 }}>Current orbit:</span>
                          <span className="font-mono" style={{ fontSize: "12px", color: "#cbd5e1" }}>
                            {baselineMetrics.totalConjunctions} conjunctions
                          </span>
                          <span style={{ color: "rgba(255,255,255,0.15)" }}>|</span>
                          <span className="font-mono" style={{ fontSize: "12px", color: "#cbd5e1" }}>
                            worst Pc {formatPc(baselineMetrics.worstPc)}
                          </span>
                          <span style={{ color: "rgba(255,255,255,0.15)" }}>|</span>
                          <span className="font-mono" style={{ fontSize: "12px", color: "#cbd5e1" }}>
                            min miss {baselineMetrics.minMissDistance >= 9000 ? "N/A" : baselineMetrics.minMissDistance.toFixed(1) + " km"}
                          </span>
                        </div>
                      )}

                      {/* Scatter plot */}
                      {allCandidates && allCandidates.length > 0 && (
                        <SafeSlotScatterPlot
                          allCandidates={allCandidates}
                          results={results}
                          baselineMetrics={baselineMetrics}
                          height={isWide ? 220 : 180}
                        />
                      )}

                      {/* Comparison table */}
                      <SlotComparisonTable results={results} baselineMetrics={baselineMetrics} />

                      {/* Delta-V dashboard */}
                      <DeltaVDashboard results={results} />

                      {/* Elapsed time */}
                      {lastRun && (
                        <p className="text-center" style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
                          Last run: {new Date(lastRun).toLocaleTimeString()}
                        </p>
                      )}
                    </div>

                    {/* ── RIGHT COLUMN: Result Cards ── */}
                    <div style={{
                      display: "flex", flexDirection: "column", gap: "12px",
                      overflow: isWide ? "auto" : "visible",
                      maxHeight: isWide ? "100%" : "none",
                      paddingRight: isWide ? "4px" : "0",
                    }}>
                      {results.map((r) => (
                        <SafeSlotCard
                          key={r.rank}
                          result={r}
                          targetOrbitParams={targetOrbitParams}
                          onPreview={() => handlePreview(r)}
                          onApply={() => handleApplyToMission(r)}
                          isSelected={previewingRank === r.rank}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty results state */}
                {!loading && !error && lastRun && (!results || results.length === 0) && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "200px" }}>
                    <p style={{ color: "#8b9cb8", fontSize: "13px", textAlign: "center", maxWidth: "380px", lineHeight: 1.6 }}>
                      No safer slots found in the search space.<br />
                      Try widening tolerances or unlocking more parameters.
                    </p>
                  </div>
                )}

                {/* Initial empty state */}
                {!loading && !error && !lastRun && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "200px" }}>
                    <p style={{ color: "#8b9cb8", fontSize: "14px", textAlign: "center", maxWidth: "360px", lineHeight: 1.6 }}>
                      Configure orbit parameters and tolerances, then click Find Safer Slots to search for safer orbital positions.
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === "contactWindows" && (
              <div>
                {/* Loading/progress state */}
                {contactsLoading && contactsProgress && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "200px" }}>
                    <div style={{
                      width: "100%", maxWidth: "480px",
                      padding: "16px 20px", borderRadius: "8px",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(46, 213, 115, 0.15)",
                    }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span style={{ fontSize: "13px", color: "#2ed573" }}>&#10023;</span>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: "#f1f5f9" }}>Calculating Contact Windows</span>
                        </div>
                        <span className="font-mono" style={{ fontSize: "13px", fontWeight: 600, color: "#2ed573" }}>
                          {contactsProgress.pct || 0}%
                        </span>
                      </div>
                      <div style={{ height: "4px", borderRadius: "2px", background: "rgba(255,255,255,0.06)", marginBottom: "10px", overflow: "hidden" }}>
                        <div style={{
                          height: "100%", borderRadius: "2px",
                          background: "linear-gradient(90deg, #2ed573, #1e9c54)",
                          width: `${contactsProgress.pct || 0}%`,
                          transition: "width 0.3s ease",
                        }} />
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono" style={{
                          fontSize: "10px", fontWeight: 600, color: "#0d1117",
                          background: "#2ed573", padding: "2px 8px", borderRadius: "3px",
                        }}>
                          Stage {contactsProgress.stage || 0}/5
                        </span>
                      </div>
                      <div className="font-mono" style={{
                        color: "#b0bec5", fontSize: "11px", lineHeight: 1.4,
                        padding: "6px 8px", borderRadius: "4px",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.06)",
                      }}>
                        {contactsProgress.msg || "Processing..."}
                      </div>
                    </div>
                  </div>
                )}

                {/* Error state */}
                {!contactsLoading && contactsError && (
                  <div
                    className="text-xs px-4 py-3 rounded-md"
                    style={{
                      background: "rgba(255,71,87,0.1)",
                      border: "1px solid rgba(255,71,87,0.3)",
                      color: "#ff4757",
                      maxWidth: "480px", margin: "0 auto",
                    }}
                  >
                    {contactsError}
                  </div>
                )}

                {/* Results */}
                {!contactsLoading && !contactsError && contacts && contacts.length > 0 && (
                  <div className="animate-fade-in">
                    {/* Summary bar */}
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      gap: "12px", padding: "10px 14px", marginBottom: "14px",
                      borderRadius: "6px",
                      background: "rgba(46, 213, 115, 0.06)",
                      border: "1px solid rgba(46, 213, 115, 0.15)",
                      flexWrap: "wrap",
                    }}>
                      <span className="font-mono" style={{ fontSize: "13px", fontWeight: 700, color: "#2ed573" }}>
                        {contacts.length} contact windows
                      </span>
                      <span style={{ color: "rgba(255,255,255,0.15)" }}>|</span>
                      <span className="font-mono" style={{ fontSize: "12px", color: "#cbd5e1" }}>
                        {[...new Set(contacts.map(c => c.stationName))].length} stations
                      </span>
                      <span style={{ color: "rgba(255,255,255,0.15)" }}>|</span>
                      <span className="font-mono" style={{ fontSize: "12px", color: "#cbd5e1" }}>
                        Max elev: {Math.max(...contacts.map(c => c.maxElevation)).toFixed(1)}°
                      </span>
                    </div>

                    {/* Gantt chart visualization */}
                    <ContactGantt contacts={contacts} />

                    {/* Contact table (condensed reference) */}
                    <div style={{
                      borderRadius: "6px", overflow: "hidden",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}>
                      {/* Header */}
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(100px, 1.2fr) minmax(115px, 1.5fr) minmax(115px, 1.5fr) 70px 65px 60px 60px",
                        background: "rgba(255,255,255,0.04)",
                        borderBottom: "1px solid rgba(255,255,255,0.08)",
                        fontSize: "11px", fontWeight: 600, color: "#64748b",
                      }}>
                        <div style={{ padding: "8px 10px" }}>Station</div>
                        <div style={{ padding: "8px 6px" }}>AOS (UTC)</div>
                        <div style={{ padding: "8px 6px" }}>LOS (UTC)</div>
                        <div style={{ padding: "8px 6px", textAlign: "center" }}>Duration</div>
                        <div style={{ padding: "8px 6px", textAlign: "center" }}>Max El.</div>
                        <div style={{ padding: "8px 6px", textAlign: "center" }}>AOS Az</div>
                        <div style={{ padding: "8px 6px", textAlign: "center" }}>LOS Az</div>
                      </div>

                      {/* Rows */}
                      {contacts.map((c, i) => {
                        const aosDate = new Date(c.aos);
                        const losDate = new Date(c.los);
                        const durationMin = Math.floor(c.duration / 60);
                        const durationSec = Math.round(c.duration % 60);
                        const elevColor = c.maxElevation >= 45 ? "#4ade80" : c.maxElevation >= 20 ? "#ffa502" : "#cbd5e1";

                        return (
                          <div key={`${c.stationId}-${c.aos}`} style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(100px, 1.2fr) minmax(115px, 1.5fr) minmax(115px, 1.5fr) 70px 65px 60px 60px",
                            borderBottom: i < contacts.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                            background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                            transition: "background 0.15s",
                            fontSize: "12px",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(46, 213, 115, 0.04)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)"; }}
                          >
                            <div style={{ padding: "7px 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: c.stationColor || "#00d4ff", flexShrink: 0 }} />
                              <span style={{ color: "#f1f5f9", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.stationName}</span>
                            </div>
                            <div className="font-mono" style={{ padding: "7px 6px", color: "#cbd5e1" }}>
                              {aosDate.getUTCMonth()+1}/{aosDate.getUTCDate()} {String(aosDate.getUTCHours()).padStart(2,"0")}:{String(aosDate.getUTCMinutes()).padStart(2,"0")}:{String(aosDate.getUTCSeconds()).padStart(2,"0")}
                            </div>
                            <div className="font-mono" style={{ padding: "7px 6px", color: "#cbd5e1" }}>
                              {losDate.getUTCMonth()+1}/{losDate.getUTCDate()} {String(losDate.getUTCHours()).padStart(2,"0")}:{String(losDate.getUTCMinutes()).padStart(2,"0")}:{String(losDate.getUTCSeconds()).padStart(2,"0")}
                            </div>
                            <div className="font-mono" style={{ padding: "7px 6px", textAlign: "center", color: "#cbd5e1" }}>
                              {durationMin}m {durationSec}s
                            </div>
                            <div className="font-mono" style={{ padding: "7px 6px", textAlign: "center", color: elevColor, fontWeight: 600 }}>
                              {c.maxElevation.toFixed(1)}°
                            </div>
                            <div className="font-mono" style={{ padding: "7px 6px", textAlign: "center", color: "#8b9cb8" }}>
                              {c.aosAzimuth.toFixed(0)}°
                            </div>
                            <div className="font-mono" style={{ padding: "7px 6px", textAlign: "center", color: "#8b9cb8" }}>
                              {c.losAzimuth.toFixed(0)}°
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Legend */}
                    <div style={{ display: "flex", gap: "16px", justifyContent: "center", marginTop: "12px", flexWrap: "wrap" }}>
                      {[
                        { color: "#4ade80", label: "High pass (≥45°)" },
                        { color: "#ffa502", label: "Medium (≥20°)" },
                        { color: "#cbd5e1", label: "Low pass" },
                      ].map((item) => (
                        <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: item.color }} />
                          <span style={{ fontSize: "11px", color: "#8b9cb8" }}>{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty state after run */}
                {!contactsLoading && !contactsError && contacts && contacts.length === 0 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "200px" }}>
                    <p style={{ color: "#8b9cb8", fontSize: "14px", textAlign: "center", maxWidth: "360px", lineHeight: 1.6 }}>
                      No contact windows found in the selected time window.<br />
                      Try a longer prediction window or check ground station elevation masks.
                    </p>
                  </div>
                )}

                {/* Initial empty state */}
                {!contactsLoading && !contactsError && (!contacts || contacts.length === 0) && !contactsProgress && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "200px" }}>
                    <p style={{ color: "#8b9cb8", fontSize: "14px", textAlign: "center", maxWidth: "360px", lineHeight: 1.6 }}>
                      Click <strong style={{ color: "#2ed573" }}>Contact Windows</strong> in the Mission Config panel to calculate satellite pass times over your ground stations.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
