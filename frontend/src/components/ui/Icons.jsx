/**
 * Icons.jsx — Centralized SVG icon set for SatGuard
 * Aerospace-grade thin-stroke icons. All icons accept `size` and `className` props.
 * Default size: 14px. Stroke: currentColor (inherits from parent).
 */

const defaults = { size: 14, strokeWidth: 1.8 };

function Icon({ size = defaults.size, strokeWidth = defaults.strokeWidth, className = "", children, viewBox = "0 0 24 24", ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ── Lock / Unlock ────────────────────────────────────────────── */

export function LockIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Icon>
  );
}

export function UnlockIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </Icon>
  );
}

/* ── Eye / EyeOff (visibility toggle) ─────────────────────────── */

export function EyeIcon(props) {
  return (
    <Icon {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function EyeOffIcon(props) {
  return (
    <Icon {...props}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </Icon>
  );
}

/* ── Edit (pencil) ────────────────────────────────────────────── */

export function EditIcon(props) {
  return (
    <Icon {...props}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </Icon>
  );
}

/* ── Trash (delete) ───────────────────────────────────────────── */

export function TrashIcon(props) {
  return (
    <Icon {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </Icon>
  );
}

/* ── Playback controls (TopBar) ───────────────────────────────── */

export function PlayIcon(props) {
  return (
    <Icon {...props}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </Icon>
  );
}

export function RewindIcon(props) {
  return (
    <Icon {...props}>
      <polygon points="11 19 2 12 11 5 11 19" />
      <polygon points="22 19 13 12 22 5 22 19" />
    </Icon>
  );
}

export function FastForwardIcon(props) {
  return (
    <Icon {...props}>
      <polygon points="13 19 22 12 13 5 13 19" />
      <polygon points="2 19 11 12 2 5 2 19" />
    </Icon>
  );
}

/* ── Globe (Reset View — already SVG, but adding for completeness) */

export function GlobeIcon(props) {
  return (
    <Icon size={18} {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </Icon>
  );
}

/* ── Close (X) ────────────────────────────────────────────────── */

export function CloseIcon(props) {
  return (
    <Icon {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Icon>
  );
}

/* ── Chevrons ─────────────────────────────────────────────────── */

export function ChevronLeftIcon(props) {
  return (
    <Icon {...props}>
      <polyline points="15 18 9 12 15 6" />
    </Icon>
  );
}

export function ChevronRightIcon(props) {
  return (
    <Icon {...props}>
      <polyline points="9 18 15 12 9 6" />
    </Icon>
  );
}

/* ── Plus ──────────────────────────────────────────────────────── */

export function PlusIcon(props) {
  return (
    <Icon {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Icon>
  );
}

/* ── Satellite ────────────────────────────────────────────────── */

export function SatelliteIcon(props) {
  return (
    <Icon {...props}>
      <path d="M13 7L9 3 5 7l4 4" />
      <path d="m17 11 4 4-4 4-4-4" />
      <path d="m8 12 4 4 6-6-4-4Z" />
      <path d="m16 8 3-3" />
      <path d="M9 21a6 6 0 0 0-6-6" />
    </Icon>
  );
}
