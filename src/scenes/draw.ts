// Small helpers for the illustrated SVG scenes (build-time only).

/** Deterministic PRNG so scenes render identically on every build. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

let counter = 0;
/** Unique prefix for gradient/filter ids — scenes appear several times per page. */
export const uid = (name: string) => `${name}-${(counter++).toString(36)}`;

export type Pose = "stand" | "bow" | "raise" | "reach";

const n = (v: number) => v.toFixed(1);

type Pt = [number, number];

/** Smooth closed path through points (Catmull-Rom → cubic Bézier). */
function smoothClosed(pts: Pt[], decimals: number) {
  const f = (v: number) => (decimals ? v.toFixed(decimals) : String(Math.round(v)));
  const len = pts.length;
  const at = (i: number) => pts[(i + len) % len];
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < len; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + "Z";
}

// Right half of a body outline in units of height (feet at y=0, top of head at y=-1),
// from the neck down to the crotch. The left half is mirrored.
const SHOULDER: Pt[] = [[0.026, -0.852], [0.075, -0.83], [0.128, -0.812]];
const ARM_DOWN: Pt[] = [[0.152, -0.784], [0.162, -0.7], [0.164, -0.58], [0.158, -0.47], [0.15, -0.405], [0.134, -0.39], [0.118, -0.43]];
const ARM_UP: Pt[] = [
  [0.158, -0.84], [0.205, -0.96], [0.25, -1.08], [0.275, -1.17], [0.3, -1.235], [0.282, -1.255],
  [0.255, -1.215], [0.225, -1.12], [0.18, -1.0], [0.138, -0.88], [0.118, -0.78], [0.114, -0.62],
];
const ARM_FORWARD: Pt[] = [
  [0.162, -0.792], [0.25, -0.758], [0.35, -0.73], [0.392, -0.712], [0.388, -0.684], [0.34, -0.684],
  [0.24, -0.692], [0.15, -0.7], [0.118, -0.66],
];
const LEGS: Pt[] = [[0.112, -0.44], [0.104, -0.28], [0.094, -0.14], [0.09, -0.035], [0.104, -0.006], [0.096, 0], [0.03, 0], [0.026, -0.12], [0.02, -0.3], [0, -0.425]];
const DRESS: Pt[] = [[0.112, -0.44], [0.13, -0.3], [0.148, -0.15], [0.16, -0.02], [0.08, 0.004], [0, 0]];

/**
 * Silhouette of a person standing with feet at (x, y), `h` units tall.
 * `raise`/`reach` lift the right arm (left when `flipped`); `bow` lowers the head.
 */
export function person(x: number, y: number, h: number, pose: Pose = "stand", flip = false, dress = false) {
  const lower = dress ? DRESS : LEGS;
  const right = (arm: Pt[]) => [...SHOULDER, ...arm, ...lower];
  const mirror = (pts: Pt[]) => pts.map(([px, py]) => [-px, py] as Pt).reverse();

  const lifted = pose === "raise" ? ARM_UP : pose === "reach" ? ARM_FORWARD : ARM_DOWN;
  const rightSide = right(lifted);
  const leftSide = mirror(right(ARM_DOWN)).slice(1); // skip the duplicated centre point
  const s = flip ? -1 : 1;
  const place = (pts: Pt[]) => pts.map(([px, py]) => [x + s * px * h, y + py * h] as Pt);

  const headX = x + s * (pose === "bow" ? 0.035 : 0) * h;
  const headY = y - (pose === "bow" ? 0.865 : 0.915) * h;
  const rx = 0.058 * h;
  const ry = 0.068 * h;

  return (
    // Whole-number coordinates are plenty for larger figures and keep the markup small.
    smoothClosed(place([...rightSide, ...leftSide]), h > 120 ? 0 : 1) +
    // Same winding as the body (mirroring reverses it), so overlaps don't cancel under the nonzero fill rule.
    `M${n(headX - rx)},${n(headY)}a${n(rx)},${n(ry)} 0 1,${flip ? 0 : 1} ${n(rx * 2)},0a${n(rx)},${n(ry)} 0 1,${flip ? 0 : 1} ${n(-rx * 2)},0Z`
  );
}

/** A soft, irregular ridge line from x0 to x1 around baseline y, closed down to `bottom`. */
export function ridge(rand: () => number, x0: number, x1: number, y: number, amp: number, steps: number, bottom = 1000) {
  let d = `M${x0},${bottom}L${x0},${n(y)}`;
  const step = (x1 - x0) / steps;
  for (let i = 1; i <= steps; i++) {
    const px = x0 + step * (i - 0.5);
    const py = y - rand() * amp;
    d += `Q${n(px)},${n(py)} ${n(x0 + step * i)},${n(y - rand() * amp * 0.5)}`;
  }
  return d + `L${x1},${bottom}Z`;
}

/** Palm tree silhouette: curved trunk from (x, y) up `h` units, with a crown of fronds. */
export function palm(x: number, y: number, h: number, lean = 0.15) {
  const tx = x + h * lean;
  const ty = y - h;
  let d = `M${n(x - h * 0.025)},${n(y)}Q${n(x + h * lean * 0.2)},${n(y - h * 0.5)} ${n(tx - h * 0.012)},${n(ty)}L${n(tx + h * 0.012)},${n(ty)}Q${n(x + h * lean * 0.3)},${n(y - h * 0.5)} ${n(x + h * 0.025)},${n(y)}Z`;
  const fronds = [-2.7, -2.2, -1.7, -1.2, -0.6, -0.1, 0.4];
  for (const a of fronds) {
    const len = h * (0.32 + Math.abs(Math.sin(a * 3)) * 0.08);
    const ex = tx + Math.cos(a) * len;
    const ey = ty + Math.sin(a) * len * 0.55 + len * 0.28;
    const mx = tx + Math.cos(a) * len * 0.5;
    const my = ty + Math.sin(a) * len * 0.5 - len * 0.06;
    d += `M${n(tx)},${n(ty)}Q${n(mx)},${n(my - h * 0.03)} ${n(ex)},${n(ey)}Q${n(mx)},${n(my + h * 0.02)} ${n(tx)},${n(ty)}Z`;
  }
  return d;
}

/**
 * Twinkling lights are static now: hundreds of individually animated SVG nodes made the page
 * repaint constantly. The two rand() calls stay so every seeded scene keeps its exact layout.
 */
export const twinkle = (rand: () => number): string | undefined => {
  rand();
  rand();
  return undefined;
};
