import { useState, useMemo, useCallback } from "react";
import useSatguardStore from "../store/satguardStore";
import { CloseIcon, ChevronLeftIcon, ChevronRightIcon } from "./ui/Icons";
import Select from "./ui/Select";
import RiskGauge from "./ui/RiskGauge";


/**
 * ConjunctionPanel.jsx — Collapsible right panel overlay
 * Shows live conjunction analysis results from the Zustand store.
 */

/* ── Risk‐level colour map ──────────────────────────────────────── */
const RISK_COLORS = {
  CRITICAL: { bg: "rgba(255, 30, 50, 0.18)", border: "rgba(255, 30, 50, 0.5)", text: "#ff1e32", badge: "#ff1e32" },
  HIGH:     { bg: "rgba(255, 71, 87, 0.15)", border: "rgba(255, 71, 87, 0.4)", text: "#ff4757", badge: "#ff4757" },
  MEDIUM:   { bg: "rgba(255, 165, 2, 0.15)", border: "rgba(255, 165, 2, 0.4)", text: "#ffa502", badge: "#ffa502" },
  LOW:      { bg: "rgba(255, 255, 255, 0.04)", border: "var(--color-border)", text: "var(--color-text-secondary)", badge: "#4ade80" },
};

/* ── TLE confidence → colour ────────────────────────────────────── */
const CONFIDENCE_COLORS = {
  fresh:    { bg: "rgba(74, 222, 128, 0.15)", text: "#4ade80", label: "Fresh" },
  usable:   { bg: "rgba(250, 204, 21, 0.15)", text: "#facc15", label: "Usable" },
  degraded: { bg: "rgba(251, 146, 60, 0.15)", text: "#fb923c", label: "Degraded" },
  stale:    { bg: "rgba(248, 113, 113, 0.15)", text: "#f87171", label: "Stale" },
};

/* ── Relative time formatter ────────────────────────────────────── */
function formatRelativeTime(isoString) {
  const diff = new Date(isoString).getTime() - Date.now();
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return diff >= 0 ? `in ${parts.join(" ")}` : `${parts.join(" ")} ago`;
}

/* ── Format Pc in scientific notation ───────────────────────────── */
function formatPc(pc) {
  if (pc === 0) return "0";
  return pc.toExponential(2);
}

/* ── Skeleton card for loading state ────────────────────────────── */
function SkeletonCard({ delay }) {
  return (
    <div
      className="rounded-lg px-3.5 py-3 animate-pulse"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid var(--color-border)",
        animationDelay: `${delay}ms`,
      }}
    >
      <div className="h-3 rounded w-3/4 mb-2" style={{ background: "rgba(255,255,255,0.08)" }} />
      <div className="h-2.5 rounded w-1/2 mb-1.5" style={{ background: "rgba(255,255,255,0.06)" }} />
      <div className="h-2.5 rounded w-2/3" style={{ background: "rgba(255,255,255,0.05)" }} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
 * Main component
 * ════════════════════════════════════════════════════════════════════ */
export default function ConjunctionPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [riskFilter, setRiskFilter] = useState("ALL");

  /* ── Panel-level tooltip state ───────────────────────────────── */
  const [tooltip, setTooltip] = useState({ visible: false, text: "", x: 0, y: 0 });
  const showTip = useCallback((e, text) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const TIP_W = 220;
    // Center above the icon, clamp to viewport
    let left = rect.left + rect.width / 2 - TIP_W / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - TIP_W - 8));
    setTooltip({ visible: true, text, x: left, y: rect.top - 8 });
  }, []);
  const hideTip = useCallback(() => setTooltip((t) => ({ ...t, visible: false })), []);


  /* ── Store selectors ──────────────────────────────────────────── */
  const conjunctionAnalysis = useSatguardStore((s) => s.conjunctionAnalysis);
  const selectedConjunction = useSatguardStore((s) => s.selectedConjunction);
  const setSelectedConjunction = useSatguardStore((s) => s.setSelectedConjunction);
  const parsedSatellites = useSatguardStore((s) => s.parsedSatellites);
  const simTime = useSatguardStore((s) => s.simTime);
  const conjunctionProgress = useSatguardStore((s) => s.conjunctionProgress);

  const { results, loading, error, lastRun, targetOrbit, source: conjunctionSource, safeSlotRank } = conjunctionAnalysis;

  /* ── Filtered list ────────────────────────────────────────────── */
  const filtered = useMemo(() => {
    if (!results || !Array.isArray(results)) return [];
    if (riskFilter === "ALL") return results;
    return results.filter((c) => c?.risk_level === riskFilter);
  }, [results, riskFilter]);

  /* ── Card click handler ───────────────────────────────────────── */
  const handleCardClick = (conj) => {
    if (selectedConjunction?.id === conj.id) {
      setSelectedConjunction(null); // deselect
    } else {
      setSelectedConjunction(conj);
    }
  };

  /* ── Metadata line ────────────────────────────────────────────── */
  const metaLine = useMemo(() => {
    if (!lastRun) return null;
    const screened = parsedSatellites?.length ?? 0;
    const count = results?.length || 0;
    const runDate = new Date(lastRun);
    const hh = String(runDate.getUTCHours()).padStart(2, "0");
    const mm = String(runDate.getUTCMinutes()).padStart(2, "0");
    return `Screened ${screened} objects · ${count} conjunction${count !== 1 ? "s" : ""} found · 7-day window · Last run: ${hh}:${mm} UTC`;
  }, [lastRun, parsedSatellites, results]);

  /* ── RTN decomposition of miss vector ─────────────────────────── */
  const detailData = useMemo(() => {
    if (!selectedConjunction) return null;
    const c = selectedConjunction;
    const p1 = c?.position1_ECI;
    const p2 = c?.position2_ECI;
    const v1 = c?.velocity1_ECI;
    if (!p1 || !p2 || !v1) return { rtn: null };

    // Miss vector in ECI (km)
    const miss = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };

    // RTN frame from primary position + velocity
    const rMag = Math.sqrt(p1.x ** 2 + p1.y ** 2 + p1.z ** 2);
    const R = { x: p1.x / rMag, y: p1.y / rMag, z: p1.z / rMag };

    // N = R × V (cross-track)
    const Ncross = {
      x: R.y * v1.z - R.z * v1.y,
      y: R.z * v1.x - R.x * v1.z,
      z: R.x * v1.y - R.y * v1.x,
    };
    const nMag = Math.sqrt(Ncross.x ** 2 + Ncross.y ** 2 + Ncross.z ** 2);
    const N = { x: Ncross.x / nMag, y: Ncross.y / nMag, z: Ncross.z / nMag };

    // T = N × R (in-track)
    const T = {
      x: N.y * R.z - N.z * R.y,
      y: N.z * R.x - N.x * R.z,
      z: N.x * R.y - N.y * R.x,
    };

    // Project miss vector onto RTN
    const dotV = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const sep_R = dotV(miss, R);
    const sep_T = dotV(miss, T);
    const sep_N = dotV(miss, N);

    return { rtn: { R: sep_R, T: sep_T, N: sep_N } };
  }, [selectedConjunction]);

  return (
    <>
      {/* Panel */}
      <aside
        id="conjunction-panel"
        className="fixed z-40 panel-glass rounded-l-xl panel-slide-right"
        style={{
          top: "60px",
          right: 0,
          width: "310px",
          maxHeight: "calc(100vh - 120px)",
          overflowY: "auto",
          transform: collapsed ? "translateX(310px)" : "translateX(0)",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(0,212,255,0.3) transparent",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <h2 className="text-sm font-semibold tracking-wide" style={{ color: "var(--color-text-primary)" }}>
            Conjunctions
          </h2>
          {conjunctionSource === "safeSlot" && safeSlotRank && (
            <span style={{
              fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "4px",
              background: "rgba(74, 222, 128, 0.12)",
              color: "#4ade80",
              border: "1px solid rgba(74, 222, 128, 0.3)",
              letterSpacing: "0.03em",
              whiteSpace: "nowrap",
              marginLeft: "8px",
            }}>
              Safe Slot #{safeSlotRank} Preview
            </span>
          )}
          <button
            onClick={() => setCollapsed(true)}
            className="w-6 h-6 flex items-center justify-center rounded text-xs cursor-pointer transition-colors duration-200"
            style={{
              color: "var(--color-text-secondary)",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid var(--color-border)",
            }}
            title="Close panel"
          >
            <CloseIcon size={12} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col gap-3 animate-fade-in">

          {/* ── Filter dropdown ──────────────────────────────────── */}
          <Select
            value={riskFilter}
            onChange={(val) => setRiskFilter(val)}
            options={[
              { value: "ALL", label: "All risk levels" },
              { value: "CRITICAL", label: "Critical only", color: "#ff1e32" },
              { value: "HIGH", label: "High only", color: "#ff4757" },
              { value: "MEDIUM", label: "Medium only", color: "#ffa502" },
              { value: "LOW", label: "Low only", color: "#4ade80" },
            ]}
          />

          {/* ── Risk Gauge (only shown when results exist) ──────── */}
          {!loading && !error && results && results.length > 0 && (
            <RiskGauge results={results} />
          )}

          {/* ── Loading state with progress bar ───────────────── */}
          {loading && (
            <ProgressDisplay progress={conjunctionProgress} />
          )}

          {/* ── Error state ──────────────────────────────────────── */}
          {!loading && error && (
            <div
              className="text-xs px-3 py-2 rounded-md"
              style={{
                background: "rgba(255,71,87,0.1)",
                border: "1px solid rgba(255,71,87,0.3)",
                color: "#ff4757",
              }}
            >
              {error}
            </div>
          )}

          {/* ── Zero results ─────────────────────────────────────── */}
          {!loading && !error && lastRun && (!results || results.length === 0) && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 12px" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
              <span style={{ fontSize: "12px", color: "#4ade80", fontWeight: 400 }}>
                No conjunctions detected in 7-day window
              </span>
            </div>
          )}

          {/* ── Conjunction cards ────────────────────────────────── */}
          {!loading && !error && (filtered?.length || 0) > 0 && filtered.map((c) => {
            if (!c) return null;
            const colors = RISK_COLORS[c?.risk_level] || RISK_COLORS.LOW;
            const conf = CONFIDENCE_COLORS[c?.confidence_level] || CONFIDENCE_COLORS.stale;
            const isSelected = selectedConjunction?.id != null && selectedConjunction.id === c?.id;

            return (
              <div
                key={c.id}
                className="rounded-lg cursor-pointer transition-all duration-200"
                style={{
                  padding: "12px 14px 12px 16px",
                  background: isSelected ? colors.bg.replace(/[\d.]+\)$/, "0.3)") : colors.bg,
                  border: isSelected
                    ? `1.5px solid ${colors.badge}`
                    : `1px solid ${colors.border}`,
                  borderLeft: isSelected ? "3px solid #00d4ff" : undefined,
                  boxShadow: isSelected ? `0 0 12px ${colors.badge}33` : "none",
                }}
                onClick={() => handleCardClick(c)}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.transform = "translateX(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateX(0)";
                }}
              >
                {/* Row 1: name + risk badge */}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div style={{ minWidth: 0 }}>
                    <div className="text-[13px] truncate" style={{ color: "#f1f5f9", fontWeight: 600 }}>
                      {c?.catalogName || "Unknown"}
                    </div>
                    <div className="text-[11px] font-mono" style={{ color: "#94a3b8" }}>
                      NORAD {c?.noradId || "?"}
                    </div>
                  </div>
                  <span
                    className="text-[11px] font-bold flex-shrink-0 rounded"
                    style={{
                      padding: "3px 8px",
                      background: colors.bg,
                      color: colors.badge,
                      border: `1px solid ${colors.border}`,
                      letterSpacing: "0.04em",
                      borderRadius: "4px",
                    }}
                  >
                    {c?.risk_level || "UNKNOWN"}
                  </span>
                </div>

                {/* Row 2: TCA */}
                <div className="text-[11px] mb-1" style={{ color: "var(--color-text-secondary)" }}>
                  <span style={{ color: "#94a3b8", marginRight: "4px" }}>TCA:</span>
                  <span style={{ color: "var(--color-accent)" }}>
                    {c?.tca_iso_string ? formatRelativeTime(c.tca_iso_string) : "N/A"}
                  </span>
                  <span className="ml-1 text-[9px] font-mono" style={{ color: "var(--color-text-muted)" }}>
                    {c?.tca_iso_string ? new Date(c.tca_iso_string).toISOString().replace("T", " ").slice(0, 19) + "Z" : ""}
                  </span>
                </div>

                {/* Row 3: miss distance + velocity */}
                <div className="flex gap-3 mb-1">
                  <span>
                    <span className="text-[11px]" style={{ color: "#94a3b8" }}>Miss: </span>
                    <span className="text-[13px]" style={{ color: "#f1f5f9", fontWeight: 500 }}>{c?.miss_distance_km?.toFixed(2) ?? "0.00"} km</span>
                  </span>
                  <span>
                    <span className="text-[11px]" style={{ color: "#94a3b8" }}>V<sub>rel</sub>: </span>
                    <span className="text-[13px]" style={{ color: "#f1f5f9", fontWeight: 500 }}>{c?.relative_velocity_kms?.toFixed(1) ?? "0.0"} km/s</span>
                  </span>
                </div>

                {/* Row 4: Pc + confidence badge */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <span className="text-[11px]" style={{ color: "#94a3b8" }}>Pc upper bound: </span>
                    <span className="font-mono ml-1 text-[13px]" style={{ color: colors.text, fontWeight: 500 }}>
                      {formatPc(c?.pc_upper_bound ?? 0)}
                    </span>
                    <span
                      onMouseEnter={(e) => showTip(e, "Akella-Alfriend conservative upper bound on collision probability, computed from synthetic covariance scaled by TLE age. Not a full Monte-Carlo Pc — treat as worst-case screening metric.")}
                      onMouseLeave={hideTip}
                      style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: "14px", height: "14px", borderRadius: "50%",
                        fontSize: "9px", fontWeight: 700, lineHeight: 1,
                        color: "var(--color-text-muted)",
                        border: "1px solid var(--color-text-muted)",
                        marginLeft: "4px", flexShrink: 0, cursor: "help",
                        transition: "color 0.15s, border-color 0.15s",
                      }}
                    >
                      i
                    </span>
                  </div>
                  <span
                    className="text-[11px] font-semibold flex-shrink-0 rounded"
                    style={{
                      padding: "3px 8px",
                      background: conf.bg,
                      color: conf.text,
                      border: `1px solid ${conf.text}33`,
                      borderRadius: "4px",
                    }}
                  >
                    {conf.label}
                  </span>
                </div>
              </div>
            );
          })}

          {/* ── No analysis run yet (initial state) ──────────────── */}
          {!loading && !error && !lastRun && (
            <p className="text-xs text-center py-4" style={{ color: "var(--color-text-muted)" }}>
              Run conjunction analysis from the<br />Mission Config panel to see results.
            </p>
          )}

          {/* ── Divider + metadata footer ────────────────────────── */}
          {metaLine && !loading && (
            <>
              <hr style={{ borderColor: "var(--color-border)" }} />
              <p className="text-[10px] text-center leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                {metaLine}
              </p>
            </>
          )}
        </div>
      </aside>

      {/* Edge toggle button */}
      <button
        id="conjunction-toggle"
        className="fixed z-40 flex items-center justify-center cursor-pointer transition-all duration-300"
        style={{
          top: "50%",
          right: collapsed ? "0" : "310px",
          transform: "translateY(-50%)",
          width: "20px",
          height: "56px",
          background: "rgba(22, 33, 62, 0.96)",
          border: "1px solid var(--color-border)",
          borderRight: collapsed ? "1px solid var(--color-border)" : "none",
          borderRadius: "8px 0 0 8px",
          color: "var(--color-text-secondary)",
          fontSize: "12px",
        }}
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? "Open conjunctions" : "Close conjunctions"}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--color-accent)";
          e.currentTarget.style.borderColor = "var(--color-border-accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--color-text-secondary)";
          e.currentTarget.style.borderColor = "var(--color-border)";
        }}
      >
        {collapsed ? <ChevronLeftIcon size={14} /> : <ChevronRightIcon size={14} />}
      </button>

      {/* ═══ Floating Conjunction Detail Card ═══ */}
      {selectedConjunction && (
        <div
          id="conjunction-detail-card"
          className="fixed z-40 panel-glass rounded-xl animate-fade-in"
          style={{
            top: "60px",
            right: collapsed ? "16px" : "326px",
            minWidth: "300px",
            width: "300px",
            maxHeight: "60vh",
            overflowY: "auto",
            transition: "right 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(0,212,255,0.3) transparent",
          }}
        >
          {/* Header */}
          <div
            style={{ padding: "12px 12px 10px 12px", borderBottom: "1px solid var(--color-border)" }}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold" style={{ color: "var(--color-accent)", fontSize: "14px" }}>
                Encounter Details
              </span>
              <button
                onClick={() => setSelectedConjunction(null)}
                className="text-[11px] px-2.5 py-1 rounded cursor-pointer transition-colors duration-200"
                style={{
                  background: "rgba(255, 71, 87, 0.12)",
                  border: "1px solid rgba(255, 71, 87, 0.3)",
                  color: "#ff4757",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 71, 87, 0.25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 71, 87, 0.12)";
                }}
              >
                Clear B-plane
              </button>
            </div>
            <div className="mt-1.5 font-mono" style={{ color: "#f1f5f9", fontSize: "14px" }}>
              Visualization time: TCA (Time of Closest Approach)
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: "12px" }} className="flex flex-col gap-3">
            {/* Objects */}
            <DetailRow label="Primary" value={conjunctionAnalysis?.targetOrbit?.name || "User Satellite"} />
            <DetailRow label="Secondary" value={`${selectedConjunction?.catalogName || "Unknown"} (${selectedConjunction?.noradId || "?"})`} />

            <DetailDivider />

            {/* TCA */}
            <DetailRow
              label="TCA (UTC)"
              value={selectedConjunction?.tca_iso_string ? new Date(selectedConjunction.tca_iso_string).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "N/A"}
              mono
              tcaCyan
            />
            <DetailRow
              label="TCA relative"
              value={selectedConjunction?.tca_iso_string ? formatRelativeTime(selectedConjunction.tca_iso_string) : "N/A"}
              accent
            />

            <DetailDivider />

            {/* Time comparison */}
            <div
              className="rounded-md text-[13px]"
              style={{
                padding: "8px 12px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div style={{ color: "#94a3b8" }}>
                Current sim time:{" "}
                <span className="font-mono" style={{ color: "#f1f5f9" }}>
                  {simTime instanceof Date
                    ? simTime.toISOString().replace("T", " ").slice(0, 19) + " UTC"
                    : "—"}
                </span>
              </div>
              <div className="mt-1" style={{ color: "#94a3b8" }}>
                TCA:{" "}
                <span className="font-mono" style={{ color: "#00d4ff" }}>
                  {selectedConjunction?.tca_iso_string ? new Date(selectedConjunction.tca_iso_string).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "N/A"}
                </span>
              </div>
            </div>

            <DetailDivider />

            {/* Miss distance */}
            <DetailRow
              label="Miss distance"
              value={`${selectedConjunction?.miss_distance_km?.toFixed(3) ?? "0.000"} km`}
              critical={(selectedConjunction?.miss_distance_km ?? Infinity) < 1}
              mono
            />

            {/* Relative velocity */}
            <DetailRow
              label={<>V<sub>rel</sub></>}
              value={`${selectedConjunction?.relative_velocity_kms?.toFixed(3) ?? "0.000"} km/s`}
              mono
            />

            {/* Pc */}
            <DetailRow
              label="Pc upper bound"
              value={formatPc(selectedConjunction?.pc_upper_bound ?? 0)}
              mono
              critical={(selectedConjunction?.pc_upper_bound ?? 0) > 1e-4}
            />

            <DetailDivider />

            {/* RTN separation */}
            <div className="font-semibold" style={{ color: "#64748b", textTransform: "uppercase", fontSize: "11px", letterSpacing: "0.05em" }}>
              RTN Separation
            </div>
            {detailData?.rtn ? (
              <div className="grid gap-1.5" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                <MiniVal label="Radial" value={detailData.rtn.R.toFixed(3)} unit="km" />
                <MiniVal label="In-track" value={detailData.rtn.T.toFixed(3)} unit="km" />
                <MiniVal label="Cross-trk" value={detailData.rtn.N.toFixed(3)} unit="km" />
              </div>
            ) : (
              <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>—</span>
            )}

            <DetailDivider />

            {/* Sigma values */}
            <div className="font-semibold" style={{ color: "#64748b", textTransform: "uppercase", fontSize: "11px", letterSpacing: "0.05em" }}>
              Uncertainty (1σ)
            </div>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <MiniVal label="σ_R" value={selectedConjunction?.sigma_R_km?.toFixed(3) ?? "—"} unit="km" />
              <MiniVal label="σ_T" value={selectedConjunction?.sigma_T_km?.toFixed(3) ?? "—"} unit="km" />
              <MiniVal label="σ_N" value={selectedConjunction?.sigma_N_km?.toFixed(3) ?? "—"} unit="km" />
            </div>

            <DetailDivider />

            {/* HBR */}
            <DetailRow
              label="Combined HBR"
              value={`${(selectedConjunction?.hbr_combined_m || 0).toFixed(1)} m`}
              mono
            />
          </div>
        </div>
      )}

      {/* ── Panel-level tooltip (fixed, outside aside — immune to overflow clipping) */}
      {tooltip.visible && (
        <div
          style={{
            position: "fixed",
            left: tooltip.x,
            top: tooltip.y,
            transform: "translateY(-100%)",
            width: 220,
            zIndex: 99999,
            pointerEvents: "none",
            background: "rgba(10, 10, 26, 0.97)",
            border: "1px solid rgba(0,212,255,0.45)",
            borderRadius: "6px",
            padding: "7px 11px",
            fontSize: "11px",
            lineHeight: "1.45",
            color: "#e2e8f0",
            whiteSpace: "normal",
            wordWrap: "break-word",
            boxShadow: "0 4px 20px rgba(0,0,0,0.55)",
          }}
        >
          {tooltip.text}
          <span style={{
            position: "absolute",
            left: "50%", top: "100%",
            transform: "translateX(-50%)",
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderTop: "5px solid rgba(0,212,255,0.45)",
          }} />
        </div>
      )}
    </>
  );
}

/* ═══ Detail sub-components ═══════════════════════════════════════════ */

function DetailRow({ label, value, mono, critical, accent, tcaCyan }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="flex-shrink-0" style={{ color: "#94a3b8", fontSize: "13px" }}>
        {label}
      </span>
      <span
        className={`text-right truncate ${mono ? "font-mono" : ""}`}
        style={{
          fontSize: "13px",
          color: critical ? "#ff1e32" : tcaCyan ? "#00d4ff" : accent ? "var(--color-accent)" : "#f1f5f9",
          fontWeight: critical ? 700 : 400,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function MiniVal({ label, value, unit }) {
  return (
    <div
      className="rounded text-center"
      style={{
        padding: "6px 10px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div style={{ color: "#64748b", fontSize: "10px" }}>{label}</div>
      <div className="font-mono" style={{ color: "#f1f5f9", fontSize: "13px" }}>
        {value} <span style={{ color: "#94a3b8", fontSize: "9px" }}>{unit}</span>
      </div>
    </div>
  );
}

function DetailDivider() {
  return <hr style={{ borderColor: "rgba(255,255,255,0.06)", margin: "2px 0" }} />;
}

/* ═══ Progress Display ════════════════════════════════════════════════ */
const STAGE_NAMES = ["Initializing", "Orbital filter", "SGP4 screening", "Refining TCA", "Risk scoring", "Finalizing"];
// Cumulative weight per stage (stage 2 is the heaviest — coarse SGP4 sweep)
const STAGE_WEIGHTS = [0, 0.05, 0.60, 0.85, 0.95, 1.0];

function ProgressDisplay({ progress }) {
  // Compute overall 0-100 from stage + per-stage pct
  let overallPct = 0;
  if (progress) {
    const s = Math.min(progress.stage, 5);
    const lo = STAGE_WEIGHTS[Math.max(s - 1, 0)] || 0;
    const hi = STAGE_WEIGHTS[s] || 1;
    overallPct = Math.round((lo + (hi - lo) * (progress.pct / 100)) * 100);
  }

  const stageName = progress ? STAGE_NAMES[Math.min(progress.stage, 5)] : STAGE_NAMES[0];
  const statusMsg = progress?.msg || "Preparing analysis\u2026";

  return (
    <div
      className="rounded-lg animate-fade-in"
      style={{
        padding: "16px 14px",
        background: "rgba(0, 212, 255, 0.04)",
        border: "1px solid rgba(0, 212, 255, 0.15)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            style={{ fontSize: "16px", display: "inline-block", animation: "pulse 1.5s ease-in-out infinite" }}
          >
            📡
          </span>
          <span style={{ color: "#f1f5f9", fontSize: "13px", fontWeight: 600 }}>
            Analyzing Conjunctions
          </span>
        </div>
        <span className="font-mono" style={{ color: "#00d4ff", fontSize: "14px", fontWeight: 700 }}>
          {overallPct}%
        </span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          width: "100%",
          height: "6px",
          borderRadius: "3px",
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
          marginBottom: "10px",
        }}
      >
        <div
          style={{
            width: `${overallPct}%`,
            height: "100%",
            borderRadius: "3px",
            background: "linear-gradient(90deg, #00d4ff, #00f7c3)",
            transition: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1)",
            boxShadow: "0 0 8px rgba(0, 212, 255, 0.5)",
          }}
        />
      </div>

      {/* Stage pill + message */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          style={{
            fontSize: "10px",
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: "4px",
            background: "rgba(0, 212, 255, 0.12)",
            color: "#00d4ff",
            border: "1px solid rgba(0, 212, 255, 0.2)",
            letterSpacing: "0.03em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          Stage {progress?.stage || 0}/5
        </span>
        <span style={{ color: "#94a3b8", fontSize: "11px" }}>
          {stageName}
        </span>
      </div>

      {/* Status message */}
      <div style={{ color: "#64748b", fontSize: "11px", lineHeight: 1.4 }}>
        {statusMsg}
      </div>
    </div>
  );
}
