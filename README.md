<p align="center">
  <img src="https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=white" />
  <img src="https://img.shields.io/badge/CesiumJS-1.139-6CADDF?logo=cesium&logoColor=white" />
  <img src="https://img.shields.io/badge/satellite.js-6.0-00D4FF" />
  <img src="https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-green" />
</p>

# SatGuard

**Orbital intelligence platform for space situational awareness.**

Low Earth Orbit hosts 10,000+ active payloads and growing. Operators need more than a dot on a map — they need conjunction screening, safe orbit selection, and ground station scheduling in a single interface. SatGuard bridges that gap: a browser-native mission analysis tool that propagates orbits, screens collision threats, identifies safer orbital slots, and computes contact windows — all from a Web Worker pipeline that never blocks the UI.

---

## Key Capabilities

| Capability | What It Does | How It Works |
|---|---|---|
| **Conjunction Analysis** | Screens 10,000+ catalog objects against a user-defined orbit and identifies collision threats over a 7-day window | 5-stage pipeline: Hoots cascade filter → ephemeris cache build → coarse SGP4 sweep → TCA bisection refinement → Akella-Alfriend risk scoring |
| **Safe Slot Search** | Generates 200 candidate orbits via Latin Hypercube Sampling and ranks the top 3 safest alternatives with ΔV cost estimates | Super-Hoots envelope filter → Float64Array ephemeris memory cache → cache-accelerated heuristic screening → parallel worker pool deep analysis |
| **Contact Window Planning** | Computes AOS/LOS times, max elevation, and azimuth for every ground station pass | Latitude-band pre-filter → single-object ephemeris cache → coarse elevation scan → millisecond-precision bisection → golden-section max-elevation search |
| **3D Orbit Visualization** | Renders satellite positions, orbit ground tracks, and B-plane encounter geometry on a CesiumJS globe | Real-time SGP4 propagation at 1 Hz · 3-tier LOD (camera-distance-aware) · PointPrimitiveCollection for 100+ satellites |
| **Ground Station Manager** | CRUD interface for ground stations with per-station elevation masks, visibility toggles, and localStorage persistence | 6 default stations (Bangalore, Houston, Svalbard, Kourou, Nairobi, Beijing) · custom station support · live globe pin rendering |
| **B-Plane Visualization** | Renders the encounter plane, miss vector, and RTN separation for any selected conjunction directly on the globe | ECI → geodetic conversion at TCA · B-plane basis vectors from relative velocity · polygon + polyline entity rendering |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Main Thread)                   │
│  ┌──────────┐  ┌──────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │Globe.jsx │  │OrbitInput │  │ConjPanel.jsx│  │ContactTime- │ │
│  │(CesiumJS)│  │  .jsx    │  │(Risk Gauge) │  │ line.jsx    │ │
│  └────┬─────┘  └────┬─────┘  └──────┬──────┘  └──────┬──────┘ │
│       │              │               │                │        │
│       └──────────────┴───────────────┴────────────────┘        │
│                              │                                  │
│                    ┌─────────┴─────────┐                       │
│                    │  Zustand Store     │                       │
│                    │  (satguardStore)   │                       │
│                    └─────────┬─────────┘                       │
├──────────────────────────────┼──────────────────────────────────┤
│              Web Worker Layer │                                  │
│  ┌───────────────────────────┴──────────────────────────────┐  │
│  │              conjunctionWorker.js (1,661 lines)          │  │
│  │  • analyzeConjunctions    (5-stage pipeline)             │  │
│  │  • findSaferSlots         (LHS + ephemeris cache)        │  │
│  │  • runFullPipeline        (per-finalist deep analysis)   │  │
│  │  • calculateContacts      (6-stage AOS/LOS engine)       │  │
│  │  • propagatePaths/Positions (bulk SGP4)                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│         ┌────────────────────┴────────────────┐                │
│         │   Dynamic Worker Pool (2-4 cores)   │                │
│         │   SharedArrayBuffer ephemeris cache  │                │
│         └─────────────────────────────────────┘                │
├─────────────────────────────────────────────────────────────────┤
│                     Backend (FastAPI)                            │
│  ┌─────────────┐  ┌──────────────────────────────────────────┐ │
│  │  /api/health │  │  /api/tle/satellites  /api/tle/debris   │ │
│  └─────────────┘  └──────────────┬───────────────────────────┘ │
│                                  │                              │
│                    ┌─────────────┴─────────────┐               │
│                    │  tle_fetcher.py            │               │
│                    │  Space-Track.org (primary) │               │
│                    │  fallback_tle.txt (local)  │               │
│                    └───────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Performance Engineering

SatGuard treats performance as a first-class constraint. Every heavy computation is offloaded from the main thread, and several architectural decisions directly address browser-level bottlenecks.

### Ephemeris Memory Cache (Float64Array)

The conjunction and safe-slot engines pre-compute satellite positions into flat `Float64Array` buffers — 3 floats (x, y, z) per timestep, per object. For a 7-day window at 2-minute resolution across 1,000 threats, this produces ~5,040 steps × 1,000 objects × 24 bytes = **~115 MB** of contiguous, cache-friendly memory.

**Why Float64Array?** JavaScript objects carry per-property metadata overhead. A `{ x, y, z }` object consumes ~100+ bytes after V8 hidden class allocation. The same data in a typed array costs exactly 24 bytes. For 5 million coordinate lookups per analysis run, this eliminates GC pressure and enables branch-free `NaN` checks via `val !== val` (faster than `isNaN()`).

A memory cap of 200 MB enforces backpressure: if the threat neighborhood exceeds the budget, the engine automatically reduces temporal resolution from 2-minute to 4-minute intervals, or caps the threat set by proximity ranking.

### SharedArrayBuffer Zero-Copy Transfer

When the safe-slot pipeline dispatches work to a parallel worker pool (2–4 cores), the ephemeris cache is shared across workers via `SharedArrayBuffer`. Each pool worker reads threat positions directly from shared memory — zero serialization, zero copying. The system detects `crossOriginIsolated` status and falls back to structured-clone `ArrayBuffer` copies if COOP/COEP headers are unavailable.

### Video-Scrub Landing Page (H.264 Single-Asset)

The scrollytelling landing page originally used a 155-frame JPEG sequence rendered via a Web Worker. This caused two problems:
1. **GPU memory pressure**: Chrome's compositor held all decoded JPEG textures in VRAM, triggering frame drops at ~60 frames on integrated GPUs.
2. **Structural drift**: Worker message latency introduced a 2–3 frame desync between canvas frames and text overlays.

The solution replaces the entire sequence with a single H.264 `.mp4` container, scrubbed via `video.currentTime`. The browser's hardware video decoder handles seek in <1ms for all-I-frame video. Canvas draw and text overlay updates execute in the **same `requestAnimationFrame` tick** — eliminating drift entirely. A `requestVideoFrameCallback` layer provides bonus accuracy on browsers that support it.

### Off-Main-Thread Propagation Pipeline

All SGP4 propagation — conjunction screening, safe-slot search, and contact window computation — executes inside `conjunctionWorker.js`. The 1,661-line worker implements four distinct message types, each with its own multi-stage pipeline. The main thread never calls `satellite.propagate()` for bulk operations; it only propagates the ~100 display satellites at 1 Hz for globe rendering.

### Bisection-Based TCA Refinement

After the coarse sweep identifies conjunction windows (50 km ECI threshold), the engine refines each Time of Closest Approach using bisection on the `r_rel · v_rel` dot product (rate of range change). This converges to 1-second precision in ≤50 iterations. When the dot product doesn't change sign across the window (no clean zero-crossing), a 20-sample brute-force scan finds the minimum-distance point instead.

### Contact Window: Golden-Section Max-Elevation

After bisecting AOS/LOS boundaries to millisecond precision, a golden-section search (φ ≈ 0.618) locates the exact peak elevation within 100ms tolerance in ≤25 iterations per pass — no brute-force grid required.

### LOD-Aware Satellite Rendering

Globe satellite points use a 3-tier Level of Detail driven by `camera.changed` events (not per-frame polling). Camera height thresholds at 10,000 km and 2,000 km switch between 1px dots, 2px dots, and 3px dots with cyan halo outlines. The `percentageChanged` throttle at 5% prevents unnecessary LOD recalculations during minor camera jitter.

---

## What Makes SatGuard Different

Most open-source space tools solve one problem well. Visualization libraries like [KeepTrack](https://github.com/thkruz/keeptrack.space) render 50,000+ objects at high fidelity. Propagation libraries like [satellite.js](https://github.com/shashwatak/satellite-js) and [poliastro](https://github.com/poliastro/poliastro) implement orbital mechanics with clean APIs. Operations tools like [Gpredict](http://gpredict.oz9aec.net/) handle ground station pass predictions.

SatGuard operates in the gap between these categories. It connects the propagation layer to operational decision-making inside a single browser session:

- **Conjunction screening feeds safe-slot search.** The same Hoots filter and ephemeris cache that identifies threats also evaluates 200 candidate orbits. Operators don't export CDMs to a separate tool — they see alternative orbits ranked by safety and ΔV cost in the same interface.

- **Safe-slot selection feeds contact planning.** Once an operator selects a safer orbit via "Apply to Mission," the contact window engine immediately recomputes AOS/LOS times for the new orbital parameters. Ground station visibility is always current.

- **Everything shares one physics pipeline.** The conjunction engine, safe-slot engine, and contact engine all run inside the same Web Worker with a shared `satellite.js` import. There's one TLE parser, one ECI propagator, one risk scoring formula (`computeRiskMetrics`). No formula drift between subsystems.

- **Deterministic epoch anchoring.** All synthetic TLEs are generated against a user-controlled `missionEpoch`, not `new Date()`. This ensures that conjunction results, safe-slot rankings, and contact predictions are reproducible across runs — a property that most prototype tools sacrifice for convenience.

---

## Space Systems Glossary

New to orbital mechanics? Here's what the key terms mean in plain language.

| Term | What It Is |
|---|---|
| **TLE** (Two-Line Element) | A standardized 2-line text format that encodes a satellite's orbit. Contains the information needed to predict where the satellite will be at any given time. Published by the US Space Command via [Space-Track.org](https://www.space-track.org). |
| **SGP4** | Simplified General Perturbations model 4 — the standard algorithm for propagating TLE data forward in time. Accounts for atmospheric drag, Earth's oblateness (J2), and other perturbations. Every result in SatGuard comes from SGP4. |
| **TCA** (Time of Closest Approach) | The exact moment when two objects reach minimum distance. SatGuard refines TCA to 1-second precision using bisection on the range-rate function. |
| **Conjunction** | An event where two objects pass close to each other in space. SatGuard uses a 50 km ECI threshold for initial screening and computes collision probability bounds for each event. |
| **Pc** (Probability of Collision) | The likelihood that two objects will physically collide. SatGuard computes a conservative upper bound using the Akella-Alfriend formula with synthetic covariance scaled by TLE age. |
| **Altitude** | Height above Earth's surface in km. LEO ranges from ~160 km to ~2,000 km. SatGuard supports orbits up to GEO (35,786 km). |
| **Inclination** | The tilt of the orbital plane relative to Earth's equator (0°–180°). A 90° inclination is a polar orbit; 0° is equatorial. Determines which latitudes the satellite can reach. |
| **RAAN** (Right Ascension of Ascending Node) | The longitude where the orbit crosses the equator heading north, measured against a fixed star reference. Rotates slowly due to Earth's oblateness. |
| **Eccentricity** | How elliptical the orbit is. 0 = perfect circle, approaching 1 = highly elongated. Most LEO satellites operate at near-zero eccentricity. |
| **AOS / LOS** (Acquisition / Loss of Signal) | The moments a satellite rises above and drops below a ground station's elevation mask. SatGuard computes these to millisecond precision. |
| **B-Plane** | The plane perpendicular to the relative velocity vector at TCA. Visualizing the miss vector on this plane shows whether a conjunction is a near-miss in the approach direction or the cross-track direction. |
| **ΔV** (Delta-V) | The velocity change required to move from one orbit to another, measured in m/s. Lower ΔV = cheaper maneuver. SatGuard estimates ΔV for each safe-slot candidate using Hohmann transfer + plane change approximations. |
| **RTN** (Radial, In-Track, Cross-Track) | A coordinate frame centered on the primary satellite. Radial points away from Earth, In-Track points along the velocity direction, Cross-Track is perpendicular to the orbital plane. Used to decompose miss vectors. |
| **HBR** (Hard Body Radius) | The combined physical radius of two objects. Used in collision probability calculations. SatGuard supports configurable satellite sizes (CubeSat through Large) and classifies catalog debris automatically. |

---

## Tech Stack

| Layer | Technology | Role |
|---|---|---|
| **Runtime** | React 19 + Vite 8 | Component architecture, HMR, ES module dev server |
| **3D Engine** | CesiumJS 1.139 | Globe rendering, imagery, entity management, camera control |
| **Orbital Mechanics** | satellite.js 6.0 (SGP4) | TLE parsing, propagation, ECI ↔ geodetic conversion |
| **State** | Zustand 5 | Lightweight global store with selector-based subscriptions |
| **Styling** | Tailwind CSS 4 | Utility-first CSS with `@tailwindcss/vite` plugin |
| **Animation** | Framer Motion 12 | Scroll-driven video scrub, page transitions, loading states |
| **Backend** | FastAPI + uvicorn | TLE proxy with in-memory cache (1-hour TTL) |
| **Data Source** | Space-Track.org API | Authenticated 3LE catalog fetch (satellites + debris) |
| **Icons** | Lucide React | Consistent icon set across panels |
| **UI Primitives** | Radix UI (Slot), CVA, clsx, tailwind-merge | Composable, accessible component utilities |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **Python** ≥ 3.9
- A free [Space-Track.org](https://www.space-track.org/auth/createAccount) account (for live TLE data)
- A [Cesium Ion](https://cesium.com/ion/) access token (for globe imagery)

### 1. Clone

```bash
git clone https://github.com/preet-C/Sat_Guard.git
cd Sat_Guard
```

### 2. Backend Setup

```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
```

Create `backend/.env`:
```env
SPACETRACK_USER=your@email.com
SPACETRACK_PASS=yourpassword
```

Start the backend:
```bash
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend Setup

```bash
cd frontend
npm install
```

Create `frontend/.env`:
```env
VITE_CESIUM_TOKEN=your_cesium_ion_token
VITE_API_BASE=http://localhost:8000
```

Start the dev server:
```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

> **Note:** The dev server sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` headers to enable `SharedArrayBuffer` for zero-copy worker pool transfers.

### 4. First Run

1. The landing page loads a scrollytelling video intro — scroll through or click **Launch Console**.
2. The dashboard initializes the CesiumJS globe and fetches TLE data from your backend.
3. Configure orbital parameters in the left panel (altitude, inclination, eccentricity, etc.).
4. Click **Analyze Conjunctions** to screen against the full catalog.
5. Review threats in the right panel — click any conjunction card to visualize its B-plane geometry on the globe.
6. Click **Find Safer Slots** to search for collision-free orbital alternatives.
7. Click **Calculate Contact Windows** to generate AOS/LOS passes for all visible ground stations.

---

## Project Structure

```
satguard/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, CORS, TLE endpoints
│   │   ├── tle_fetcher.py       # Space-Track auth, caching, fallback
│   │   └── fallback_tle.txt     # Offline TLE data
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Globe.jsx            # CesiumJS viewer, satellite rendering, B-plane
│   │   │   ├── OrbitInput.jsx       # Mission config panel, worker dispatch
│   │   │   ├── ConjunctionPanel.jsx # Threat cards, risk gauge, detail view
│   │   │   ├── ContactTimeline.jsx  # Safe slots, contact Gantt, scatter plot
│   │   │   ├── HeroScroll.jsx       # Video-scrub scrollytelling landing
│   │   │   ├── LandingPage.jsx      # Landing page container
│   │   │   ├── TopBar.jsx           # Navigation bar
│   │   │   ├── InfoBanner.jsx       # Status banner
│   │   │   ├── Tooltip.jsx          # Reusable tooltip component
│   │   │   └── ui/
│   │   │       ├── ContactGantt.jsx # SVG Gantt chart for pass windows
│   │   │       ├── RiskGauge.jsx    # Radial risk visualization
│   │   │       ├── Select.jsx       # Custom dropdown component
│   │   │       └── Icons.jsx        # Lucide icon wrappers
│   │   ├── workers/
│   │   │   └── conjunctionWorker.js # All physics pipelines (1,661 lines)
│   │   ├── store/
│   │   │   └── satguardStore.js     # Zustand global state
│   │   ├── utils/
│   │   │   ├── propagator.js        # SGP4 propagation helpers
│   │   │   └── groundStations.js    # Station CRUD + localStorage
│   │   ├── App.jsx                  # Root shell, view routing
│   │   ├── main.jsx                 # React entry point
│   │   └── index.css                # Global styles, design tokens
│   ├── vite.config.js               # Vite + Cesium static copy config
│   └── package.json
└── README.md
```

---

## License

MIT
