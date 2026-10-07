/**
 * Line artwork for the sign-in designs: lattice transmission towers, the wires between them, a
 * star field, and a dimensioned tower elevation. Pure SVG built from numbers, so it is crisp at
 * any size and identical on the server and in the browser. Motion comes from the `login-*`
 * classes in globals.css, each with a reduced-motion branch.
 */

// A lattice tower in a 100 × 200 box: legs, a waist, two cross-arms with hanging insulators,
// and X-bracing down the body.
const TOWER_PATH = [
  "M20 200 L42 60 L46 22 L50 4 L54 22 L58 60 L80 200",
  "M12 22 H88 M6 46 H94",
  "M12 22 L46 32 M88 22 L54 32 M6 46 L43.5 56 M94 46 L56.5 56",
  "M42 60 L54 22 M58 60 L46 22",
  "M25.5 165 H74.5 M31 130 H69 M36.5 95 H63.5 M42 60 H58",
  "M20 200 L74.5 165 M80 200 L25.5 165",
  "M25.5 165 L69 130 M74.5 165 L31 130",
  "M31 130 L63.5 95 M69 130 L36.5 95",
  "M36.5 95 L58 60 M63.5 95 L42 60",
  "M12 22 V30 M88 22 V30 M6 46 V54 M94 46 V54",
].join(" ");

/** Where the wires hang from, in the tower's own 100 × 200 box: upper pair, then lower pair. */
const TIPS = [
  [12, 30],
  [88, 30],
  [6, 54],
  [94, 54],
] as const;

interface TowerSpec {
  /** Centre line, ground level and overall height, in scene units. */
  cx: number;
  base: number;
  h: number;
  opacity: number;
}

const towerScale = (t: TowerSpec) => t.h / 200;
const tipOf = (t: TowerSpec, i: number) => {
  const s = towerScale(t);
  return { x: t.cx + (TIPS[i][0] - 50) * s, y: t.base - t.h + TIPS[i][1] * s };
};

function Tower({ spec, stroke, strokeWidth = 1.1 }: { spec: TowerSpec; stroke: string; strokeWidth?: number }) {
  const s = towerScale(spec);
  return (
    <g transform={`translate(${spec.cx - 50 * s} ${spec.base - spec.h}) scale(${s})`} opacity={spec.opacity}>
      <path
        d={TOWER_PATH}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

/**
 * One conductor through every point: a catenary-ish sag in each span, proportional to its length.
 * A point's own `sag` overrides the ratio for the span that ends at it.
 */
function wirePath(points: { x: number; y: number; sag?: number }[], sagRatio = 0.07) {
  let d = `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const sag = Math.abs(b.x - a.x) * (b.sag ?? sagRatio);
    // A quadratic's midpoint sits halfway to its control point, so double the sag.
    const cy = (a.y + b.y) / 2 + 2 * sag;
    d += ` Q${((a.x + b.x) / 2).toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d;
}

// ─── Horizon: a line of towers receding toward a dusk horizon ───────────────────────────────────

/*
  Drawn across the whole page at its natural 1600 × 420 shape (taller and side-cropped only on
  narrow screens), under the headline and the sign-in card. The towers stand on the left and in the
  middle — below the headline and beside the card, never under it — and the conductors run on past
  the last one to a vanishing point on the horizon behind the card, where the sunset glow is. The
  glow itself is in the page background (HORIZON_SKY), so it has no edge to show.
*/
const HORIZON_TOWERS: TowerSpec[] = [
  { cx: 200, base: 440, h: 230, opacity: 0.75 },
  { cx: 540, base: 405, h: 165, opacity: 0.6 },
  { cx: 760, base: 386, h: 104, opacity: 0.48 },
  { cx: 880, base: 374, h: 62, opacity: 0.38 },
];

/** Where the line meets the horizon. Spans shorten with distance, so the last one barely sags. */
const VANISHING_POINT = { x: 1640, y: 364 };

const HORIZON_WIRES = TIPS.map((_, phase) => {
  const tips = HORIZON_TOWERS.map((t) => tipOf(t, phase));
  return wirePath([
    { x: -90, y: tips[0].y + 30 },
    ...tips,
    { x: VANISHING_POINT.x, y: VANISHING_POINT.y + phase * 1.2, sag: 0.012 },
  ]);
});

/** Pulses run along three of the four conductors, at different speeds, so they never march in step. */
const HORIZON_PULSES = [
  { phase: 0, color: "#fbbf24", duration: "11s", delay: "-2s" },
  { phase: 3, color: "#67e8f9", duration: "15s", delay: "-7s" },
  { phase: 1, color: "#fda4af", duration: "19s", delay: "-12s" },
];

export function HorizonScene({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1600 420" preserveAspectRatio="xMidYMax slice" className={className} aria-hidden>
      <path d="M0 372 C200 360 380 368 560 371 C760 375 980 360 1160 364 C1340 368 1480 360 1600 363 L1600 420 L0 420 Z" fill="#0b0a1f" />
      {HORIZON_WIRES.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      {HORIZON_PULSES.map((p) => (
        <path
          key={p.phase}
          d={HORIZON_WIRES[p.phase]}
          fill="none"
          stroke={p.color}
          strokeWidth="2.2"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="0.7 99.3"
          vectorEffect="non-scaling-stroke"
          className="login-wire-pulse"
          style={{ animationDuration: p.duration, animationDelay: p.delay, filter: `drop-shadow(0 0 4px ${p.color})` }}
        />
      ))}
      {HORIZON_TOWERS.map((t) => (
        <Tower key={t.cx} spec={t} stroke="#e0e7ff" />
      ))}
      <path d="M0 404 C280 396 560 402 840 400 C1120 398 1360 392 1600 395 L1600 420 L0 420 Z" fill="#05050d" />
    </svg>
  );
}

// ─── Stars ───────────────────────────────────────────────────────────────────────────────────────

/** A fixed pseudo-random field (seeded), so server and browser draw the same sky. */
const STARS = (() => {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 56 }, (_, i) => ({
    x: +(rand() * 800).toFixed(1),
    y: +(rand() * 300).toFixed(1),
    r: +(0.4 + rand() * 0.9).toFixed(2),
    o: +(0.18 + rand() * 0.45).toFixed(2),
    twinkle: i % 7 === 0,
  }));
})();

export function StarField({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 800 300" preserveAspectRatio="xMidYMin slice" className={className} aria-hidden>
      {STARS.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill="#fff"
          opacity={s.o}
          className={s.twinkle ? "login-twinkle" : undefined}
          style={s.twinkle ? { animationDelay: `${(i % 5) * 0.9}s` } : undefined}
        />
      ))}
    </svg>
  );
}

// ─── Blueprint: a dimensioned tower elevation ───────────────────────────────────────────────────

const ELEVATION: TowerSpec = { cx: 210, base: 600, h: 520, opacity: 1 };

function Leader({ from, to, label, anchor = "end" }: { from: [number, number]; to: [number, number]; label: string; anchor?: "start" | "end" }) {
  const [fx, fy] = from;
  const [tx, ty] = to;
  return (
    <g>
      <path d={`M${fx} ${fy} H${fx + (anchor === "end" ? 8 : -8)} L${tx} ${ty}`} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
      <circle cx={tx} cy={ty} r="2" fill="#fff" />
      <text x={anchor === "end" ? fx - 4 : fx + 4} y={fy + 3} textAnchor={anchor} className="fill-white/75 font-mono" fontSize="9" letterSpacing="1.4">
        {label}
      </text>
    </g>
  );
}

function Arrow({ x, y, dir }: { x: number; y: number; dir: "up" | "down" | "left" | "right" }) {
  const d = {
    up: `M${x} ${y} l-3 7 h6 z`,
    down: `M${x} ${y} l-3 -7 h6 z`,
    left: `M${x} ${y} l7 -3 v6 z`,
    right: `M${x} ${y} l-7 -3 v6 z`,
  }[dir];
  return <path d={d} fill="#fff" />;
}

export function TowerElevation({ className, label }: { className?: string; label: string }) {
  const top = ELEVATION.base - ELEVATION.h;
  const s = towerScale(ELEVATION);
  const legL = ELEVATION.cx - 30 * s;
  const legR = ELEVATION.cx + 30 * s;
  const armTip = tipOf(ELEVATION, 2);
  const upperJoint = { x: ELEVATION.cx, y: top + 22 * s };
  return (
    <svg viewBox="0 0 420 680" className={className} aria-hidden>
      {/* ground and hatching */}
      <path d="M40 600 H380" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      {Array.from({ length: 17 }, (_, i) => (
        <path key={i} d={`M${50 + i * 20} 600 l-10 10`} stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
      ))}

      <Tower spec={ELEVATION} stroke="#ffffff" strokeWidth={1.25} />

      {/* height */}
      <g stroke="rgba(255,255,255,0.45)" strokeWidth="0.8" fill="none">
        <path d={`M${ELEVATION.cx + 8} ${top} H392 M${legR + 6} 600 H392`} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <path d={`M384 ${top} V600`} vectorEffect="non-scaling-stroke" />
      </g>
      <Arrow x={384} y={top} dir="up" />
      <Arrow x={384} y={600} dir="down" />
      <text x={398} y={(top + 600) / 2} transform={`rotate(-90 398 ${(top + 600) / 2})`} textAnchor="middle" className="fill-white/80 font-mono" fontSize="10" letterSpacing="2">
        H = 42.0 m
      </text>

      {/* base width */}
      <g stroke="rgba(255,255,255,0.45)" strokeWidth="0.8" fill="none">
        <path d={`M${legL} 606 V636 M${legR} 606 V636`} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <path d={`M${legL} 630 H${legR}`} vectorEffect="non-scaling-stroke" />
      </g>
      <Arrow x={legL} y={630} dir="left" />
      <Arrow x={legR} y={630} dir="right" />
      <text x={ELEVATION.cx} y={650} textAnchor="middle" className="fill-white/80 font-mono" fontSize="10" letterSpacing="2">
        B = 8.4 m
      </text>

      {/* detail callout */}
      <circle cx={upperJoint.x} cy={upperJoint.y} r="26" fill="none" stroke="#fdba74" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      <text x={upperJoint.x + 30} y={upperJoint.y - 22} className="fill-orange-300 font-mono" fontSize="10" letterSpacing="1.5">
        A
      </text>

      <Leader from={[96, 40]} to={[ELEVATION.cx, top + 6]} label="EARTH PEAK" />
      <Leader from={[76, 250]} to={[armTip.x, armTip.y]} label="INSULATOR" />
      <Leader from={[96, 420]} to={[ELEVATION.cx - 12 * s, 420]} label="BRACING" />

      <text x={40} y={674} className="fill-white/60 font-mono" fontSize="9" letterSpacing="2">
        {label}
      </text>
    </svg>
  );
}
