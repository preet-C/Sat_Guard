import { useMemo } from "react";

/**
 * RiskGauge.jsx — Radial SVG gauge for mission conjunction risk
 * Renders a 240° arc showing overall risk based on the worst Pc value.
 * Color-coded: green (safe) → orange (elevated) → red (critical).
 * Includes risk-level breakdown badges and subtle glow for critical states.
 */

const RISK_THRESHOLDS = [
  { level: "CRITICAL", min: 1e-4, color: "#ff1e32", glow: "rgba(255,30,50,0.35)" },
  { level: "HIGH",     min: 1e-5, color: "#ff4757", glow: "rgba(255,71,87,0.25)" },
  { level: "MEDIUM",   min: 1e-7, color: "#ffa502", glow: "rgba(255,165,2,0.15)" },
  { level: "LOW",      min: 0,    color: "#4ade80", glow: "rgba(74,222,128,0.08)" },
];

function getRisk(pc) {
  for (const t of RISK_THRESHOLDS) {
    if (pc >= t.min) return t;
  }
  return RISK_THRESHOLDS[3];
}

function formatPcShort(pc) {
  if (pc === 0) return "0";
  const exp = Math.floor(Math.log10(pc));
  const mantissa = (pc / Math.pow(10, exp)).toFixed(1);
  return `${mantissa}e${exp}`;
}

/* SVG arc path for a circular arc */
function arcPath(cx, cy, r, startDeg, endDeg) {
  const toRad = (d) => (d * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startDeg));
  const y1 = cy + r * Math.sin(toRad(startDeg));
  const x2 = cx + r * Math.cos(toRad(endDeg));
  const y2 = cy + r * Math.sin(toRad(endDeg));
  const sweep = endDeg - startDeg;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

export default function RiskGauge({ results }) {
  const { worstPc, risk, danger, counts, total } = useMemo(() => {
    if (!results || results.length === 0) {
      return { worstPc: 0, risk: RISK_THRESHOLDS[3], danger: 0, counts: {}, total: 0 };
    }

    let worst = 0;
    const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const r of results) {
      if (r.pc_upper_bound > worst) worst = r.pc_upper_bound;
      c[r.risk_level] = (c[r.risk_level] || 0) + 1;
    }

    // Log-scale danger: 1e-10 (0%) → 1e-3 (100%)
    const logMin = -10, logMax = -3;
    const logPc = worst > 0 ? Math.log10(worst) : logMin;
    const d = Math.max(0, Math.min(1, (logPc - logMin) / (logMax - logMin)));

    return { worstPc: worst, risk: getRisk(worst), danger: d, counts: c, total: results.length };
  }, [results]);

  if (total === 0) return null;

  // Arc geometry
  const SIZE = 140;
  const CX = SIZE / 2, CY = SIZE / 2 + 6;
  const R = 52;
  const STROKE = 7;
  const ARC_START = 150; // degrees (bottom-left)
  const ARC_SWEEP = 240; // total arc span
  const ARC_END = ARC_START + ARC_SWEEP;
  const fillEnd = ARC_START + ARC_SWEEP * danger;

  // Gradient stop positions based on danger level
  const isCritical = risk.level === "CRITICAL";

  // Risk badge data (only show non-zero)
  const badges = [
    { level: "CRITICAL", color: "#ff1e32", count: counts.CRITICAL },
    { level: "HIGH", color: "#ff4757", count: counts.HIGH },
    { level: "MEDIUM", color: "#ffa502", count: counts.MEDIUM },
    { level: "LOW", color: "#4ade80", count: counts.LOW },
  ].filter((b) => b.count > 0);

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "8px 8px 4px", marginBottom: "6px",
      borderRadius: "8px",
      background: "rgba(255,255,255,0.02)",
      border: `1px solid ${isCritical ? "rgba(255,30,50,0.25)" : "rgba(255,255,255,0.06)"}`,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Subtle glow backdrop for critical */}
      {isCritical && (
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: "100px", height: "100px",
          borderRadius: "50%",
          background: risk.glow,
          filter: "blur(30px)",
          pointerEvents: "none",
          animation: "riskPulse 3s ease-in-out infinite",
        }} />
      )}

      <svg
        width={SIZE} height={SIZE - 20}
        viewBox={`0 0 ${SIZE} ${SIZE - 20}`}
        style={{ position: "relative", zIndex: 1 }}
      >
        <defs>
          {/* Gradient for the filled arc */}
          <linearGradient id="riskArcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#4ade80" />
            <stop offset="40%" stopColor="#ffa502" />
            <stop offset="70%" stopColor="#ff4757" />
            <stop offset="100%" stopColor="#ff1e32" />
          </linearGradient>
          {/* Glow filter */}
          <filter id="riskGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background track */}
        <path
          d={arcPath(CX, CY, R, ARC_START, ARC_END)}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />

        {/* Filled arc (danger level) */}
        {danger > 0.01 && (
          <path
            d={arcPath(CX, CY, R, ARC_START, fillEnd)}
            fill="none"
            stroke="url(#riskArcGrad)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            filter={isCritical ? "url(#riskGlow)" : undefined}
            style={{
              transition: "d 0.6s ease-out",
            }}
          />
        )}

        {/* Tick marks at 0%, 25%, 50%, 75%, 100% */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const angle = ARC_START + ARC_SWEEP * pct;
          const rad = (angle * Math.PI) / 180;
          const inner = R - STROKE / 2 - 3;
          const outer = R - STROKE / 2 - 7;
          return (
            <line
              key={pct}
              x1={CX + inner * Math.cos(rad)} y1={CY + inner * Math.sin(rad)}
              x2={CX + outer * Math.cos(rad)} y2={CY + outer * Math.sin(rad)}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="1"
            />
          );
        })}

        {/* Center text */}
        <text x={CX} y={CY - 12} textAnchor="middle" fill="#8b9cb8" fontSize="9" fontWeight="500" style={{ letterSpacing: "0.08em" }}>
          WORST Pc
        </text>
        <text x={CX} y={CY + 4} textAnchor="middle" fill={risk.color} fontSize="16" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
          {formatPcShort(worstPc)}
        </text>
        <text x={CX} y={CY + 18} textAnchor="middle" fill={risk.color} fontSize="9" fontWeight="600" style={{ letterSpacing: "0.1em" }}>
          {risk.level}
        </text>
      </svg>

      {/* Risk breakdown badges */}
      <div style={{
        display: "flex", gap: "6px", justifyContent: "center",
        paddingBottom: "4px", position: "relative", zIndex: 1,
      }}>
        {badges.map((b) => (
          <div key={b.level} style={{
            display: "flex", alignItems: "center", gap: "4px",
            padding: "2px 7px", borderRadius: "10px",
            background: `${b.color}15`,
            border: `1px solid ${b.color}30`,
          }}>
            <span style={{
              width: "6px", height: "6px", borderRadius: "50%",
              background: b.color, flexShrink: 0,
            }} />
            <span style={{ fontSize: "10px", fontWeight: 600, color: b.color, fontFamily: "'JetBrains Mono', monospace" }}>
              {b.count}
            </span>
          </div>
        ))}
        <span style={{ fontSize: "10px", color: "#64748b", alignSelf: "center", marginLeft: "2px" }}>
          / {total} total
        </span>
      </div>

      {/* CSS animation for critical glow pulse */}
      <style>{`
        @keyframes riskPulse {
          0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 0.8; transform: translate(-50%, -50%) scale(1.15); }
        }
      `}</style>
    </div>
  );
}
