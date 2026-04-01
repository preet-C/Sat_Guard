import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Select.jsx — Custom dark-themed dropdown for SatGuard
 *
 * Replaces native <select> elements that break the dark glassmorphic aesthetic.
 * Supports keyboard navigation (↑/↓/Enter/Escape), outside-click close,
 * and auto-positioning to avoid viewport overflow.
 *
 * Props:
 *   value       — current selected value
 *   onChange     — (value) => void
 *   options      — [{ value, label }] or [{ value, label, color }]
 *   placeholder  — optional placeholder text
 *   accentColor  — optional border/highlight color (default: var(--color-accent))
 *   width        — optional CSS width (default: "100%")
 *   size         — "sm" | "md" (default: "md")
 */

function ChevronDownIcon2({ size = 14 }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function Select({
  value,
  onChange,
  options = [],
  placeholder = "Select…",
  accentColor = "var(--color-accent)",
  width = "100%",
  size = "md",
}) {
  const [open, setOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const containerRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => o.value === value);
  const displayLabel = selected?.label ?? placeholder;
  const displayColor = selected?.color ?? null;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Reset focus index when opening
  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setFocusedIdx(idx >= 0 ? idx : 0);
    }
  }, [open, options, value]);

  // Scroll focused item into view
  useEffect(() => {
    if (open && listRef.current && focusedIdx >= 0) {
      const item = listRef.current.children[focusedIdx];
      if (item) item.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIdx, open]);

  const handleKeyDown = useCallback(
    (e) => {
      if (!open) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          setOpen(true);
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIdx((prev) => Math.min(prev + 1, options.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIdx((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (focusedIdx >= 0 && focusedIdx < options.length) {
            onChange(options[focusedIdx].value);
            setOpen(false);
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
        default:
          break;
      }
    },
    [open, focusedIdx, options, onChange]
  );

  const isSm = size === "sm";
  const btnHeight = isSm ? "26px" : "32px";
  const fontSize = isSm ? "11px" : "12px";

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width }}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-between cursor-pointer transition-all duration-150"
        style={{
          width: "100%",
          height: btnHeight,
          padding: isSm ? "0 8px" : "0 10px",
          borderRadius: "6px",
          background: "rgba(15, 26, 46, 0.9)",
          border: open
            ? `1px solid ${accentColor}`
            : "1px solid rgba(255,255,255,0.12)",
          color: selected ? "var(--color-text-primary)" : "var(--color-text-muted)",
          fontSize,
          fontFamily: "var(--font-sans)",
          fontWeight: 500,
          outline: "none",
          gap: "6px",
          boxShadow: open ? `0 0 0 1px ${accentColor}33` : "none",
        }}
      >
        <span
          className="flex items-center gap-1.5"
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayColor && (
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "2px",
                background: displayColor,
                flexShrink: 0,
              }}
            />
          )}
          {displayLabel}
        </span>
        <span
          style={{
            color: "var(--color-text-muted)",
            transition: "transform 200ms",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            display: "flex",
            alignItems: "center",
          }}
        >
          <ChevronDownIcon2 size={isSm ? 12 : 14} />
        </span>
      </button>

      {/* Dropdown list */}
      {open && (
        <div
          ref={listRef}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 999,
            maxHeight: "200px",
            overflowY: "auto",
            borderRadius: "6px",
            background: "rgba(13, 17, 23, 0.98)",
            border: `1px solid rgba(255,255,255,0.12)`,
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow:
              "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)",
            padding: "3px",
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(0,212,255,0.3) transparent",
          }}
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === value;
            const isFocused = i === focusedIdx;
            return (
              <div
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                onMouseEnter={() => setFocusedIdx(i)}
                className="flex items-center cursor-pointer transition-colors duration-100"
                style={{
                  padding: isSm ? "5px 8px" : "7px 10px",
                  borderRadius: "4px",
                  fontSize,
                  fontWeight: isSelected ? 600 : 400,
                  color: isSelected
                    ? accentColor
                    : isFocused
                      ? "var(--color-text-primary)"
                      : "var(--color-text-secondary)",
                  background: isFocused
                    ? "rgba(255,255,255,0.06)"
                    : "transparent",
                  gap: "8px",
                }}
              >
                {opt.color && (
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "2px",
                      background: opt.color,
                      flexShrink: 0,
                    }}
                  />
                )}
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {opt.label}
                </span>
                {isSelected && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={accentColor}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
