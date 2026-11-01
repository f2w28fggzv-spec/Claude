// Synthetic landmark sequences for tests: a 2D stick figure driven by joint
// angles, written out in MediaPipe's 33-landmark format. Each generator can
// inject a specific fault (shallow depth, lean, drift, sag, low confidence...)
// so every check type can be tested without video.
//
// Imports nothing from src/ so scripts/make-fixtures.ts can run it with plain
// Node. Phase 4 adds real recorded fixtures in the same format.

export type RawLandmark = [number, number, number, number];
export interface PoseFrame {
  t: number;
  lm: RawLandmark[] | null;
}
export interface PoseSequence {
  version: 1;
  width: number;
  height: number;
  source: 'camera' | 'file' | 'synthetic';
  frames: PoseFrame[];
}

type J = 'nose' | 'ear' | 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle' | 'heel' | 'toe';
interface P {
  x: number;
  y: number;
}
type Body = Partial<Record<J, P>>;
const IDX: Record<J, [number, number]> = {
  nose: [0, 0],
  ear: [7, 8],
  shoulder: [11, 12],
  elbow: [13, 14],
  wrist: [15, 16],
  hip: [23, 24],
  knee: [25, 26],
  ankle: [27, 28],
  heel: [29, 30],
  toe: [31, 32],
};

/** Segment lengths in pixels (torso = 300). Ratios follow Winter (2009). */
export const SEG = { torso: 300, thigh: 255, shin: 256, upperArm: 194, forearm: 152, head: 110 };

const rad = (d: number) => (d * Math.PI) / 180;
const add = (a: P, len: number, angleFromUpDeg: number): P => ({
  x: a.x + len * Math.sin(rad(angleFromUpDeg)),
  y: a.y - len * Math.cos(rad(angleFromUpDeg)),
});
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
const lerpP = (a: P, b: P, s: number): P => ({ x: lerp(a.x, b.x, s), y: lerp(a.y, b.y, s) });

/** Two-link arm: elbow position for shoulder→wrist, bending toward `bendSign`. */
export function elbowFor(sh: P, w: P, bendSign: 1 | -1, upper = SEG.upperArm, fore = SEG.forearm): { elbow: P; wrist: P } {
  let dx = w.x - sh.x;
  let dy = w.y - sh.y;
  let d = Math.hypot(dx, dy);
  const max = upper + fore - 0.5;
  if (d > max) {
    dx *= max / d;
    dy *= max / d;
    d = max;
  }
  const a = (upper * upper - fore * fore + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  const mx = sh.x + (dx * a) / d;
  const my = sh.y + (dy * a) / d;
  const elbow = { x: mx + (bendSign * -dy * h) / d, y: my + (bendSign * dx * h) / d };
  return { elbow, wrist: { x: sh.x + dx, y: sh.y + dy } };
}

/**
 * Standing chain from the ankle up, facing +x. Angles in degrees:
 * shin: forward tilt of the shin; thigh: backward tilt of the thigh from
 * vertical (90 = horizontal, >90 = hip below knee); torso: forward lean
 * (negative leans back).
 */
export function legsAndTorso(ankle: P, shin: number, thigh: number, torso: number): Body {
  const knee = add(ankle, SEG.shin, shin);
  const hip = add(knee, SEG.thigh, -thigh);
  const shoulder = add(hip, SEG.torso, torso);
  const ear = add(shoulder, SEG.head * 0.85, torso);
  const nose = { x: ear.x + 28, y: ear.y + 6 };
  return {
    ankle,
    knee,
    hip,
    shoulder,
    ear,
    nose,
    heel: { x: ankle.x - 25, y: ankle.y + 15 },
    toe: { x: ankle.x + 70, y: ankle.y + 20 },
  };
}

// ── Time profiles ─────────────────────────────────────────────────────────

export interface RepSpec {
  /** Seconds moving away from the start position. */
  out: number;
  /** Seconds paused at the turnaround. */
  hold?: number;
  /** Seconds moving back. */
  back: number;
  /** Seconds paused at the start position afterwards. */
  rest?: number;
  /** Multiplier on the movement (1 = full rep). */
  depth?: number;
  /** Fault switch for this rep, interpreted by the generator. */
  fault?: boolean;
}

export interface Sample {
  t: number;
  /** 0 at the start position, `depth` at the turnaround. */
  s: number;
  rep: number;
  fault: boolean;
}

const ease = (u: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2;

export function profile(reps: RepSpec[], fps: number, leadSec = 1.2, tailSec = 1.2, endAtTurn = false): Sample[] {
  const segs: { dur: number; from: number; to: number; rep: number; fault: boolean }[] = [];
  // The lead-in is the first rep's start position, so it shares its fault.
  segs.push({ dur: leadSec, from: 0, to: 0, rep: -1, fault: !!reps[0]?.fault });
  reps.forEach((r, i) => {
    const d = r.depth ?? 1;
    const f = !!r.fault;
    segs.push({ dur: r.out, from: 0, to: d, rep: i, fault: f });
    if (r.hold) segs.push({ dur: r.hold, from: d, to: d, rep: i, fault: f });
    if (endAtTurn && i === reps.length - 1) return;
    segs.push({ dur: r.back, from: d, to: 0, rep: i, fault: f });
    if (r.rest) segs.push({ dur: r.rest, from: 0, to: 0, rep: i, fault: f });
  });
  if (!endAtTurn) segs.push({ dur: tailSec, from: 0, to: 0, rep: -1, fault: false });
  const total = segs.reduce((a, s) => a + s.dur, 0);
  const out: Sample[] = [];
  for (let k = 0; k * (1000 / fps) <= total * 1000; k++) {
    const t = k / fps;
    let acc = 0;
    let seg = segs[segs.length - 1];
    let u = 1;
    for (const sg of segs) {
      if (t <= acc + sg.dur) {
        seg = sg;
        u = sg.dur ? (t - acc) / sg.dur : 1;
        break;
      }
      acc += sg.dur;
    }
    out.push({ t: Math.round(t * 1000), s: lerp(seg.from, seg.to, ease(u)), rep: seg.rep, fault: seg.fault });
  }
  return out;
}

// ── Rendering to MediaPipe format ─────────────────────────────────────────

export interface RenderOptions {
  width: number;
  height: number;
  /** 'side': one body side faces the camera; 'front': both sides spread. */
  view: 'side' | 'front';
  nearSide?: 'left' | 'right';
  noisePx?: number;
  seed?: number;
  /** Lower the visibility of joints during [fromMs, toMs]. */
  dropouts?: { joints: J[]; fromMs: number; toMs: number; visibility?: number }[];
  /** Frames (by time) with no person detected. */
  absent?: { fromMs: number; toMs: number }[];
  /** Front view: half the shoulder and hip width in pixels. */
  halfWidths?: { shoulder: number; hip: number; knee: number; ankle: number };
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Converts per-frame bodies to a sequence. For side views `body` is the near
 * side and the far side is drawn just behind it; for front views `body` is the
 * centre line and `bodyRight`/`bodyLeft` give each side explicitly.
 */
export function render(
  samples: Sample[],
  pose: (s: Sample) => { body?: Body; left?: Body; right?: Body },
  o: RenderOptions,
): PoseSequence {
  const rand = rng(o.seed ?? 1);
  const gauss = () => {
    const u = Math.max(1e-9, rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const noise = o.noisePx ?? 1.5;
  const near = o.nearSide ?? 'right';
  const frames: PoseFrame[] = samples.map((smp) => {
    if (o.absent?.some((a) => smp.t >= a.fromMs && smp.t <= a.toMs)) return { t: smp.t, lm: null };
    const lm: RawLandmark[] = Array.from({ length: 33 }, () => [0, 0, 0, 0] as RawLandmark);
    const p = pose(smp);
    const put = (j: J, side: 'left' | 'right', pt: P | undefined, v: number) => {
      if (!pt) return;
      const i = IDX[j][side === 'left' ? 0 : 1];
      const drop = o.dropouts?.find((d) => d.joints.includes(j) && smp.t >= d.fromMs && smp.t <= d.toMs);
      lm[i] = [
        r3((pt.x + gauss() * noise) / o.width),
        r3((pt.y + gauss() * noise) / o.height),
        0,
        drop ? (drop.visibility ?? 0.2) : v,
      ];
    };
    for (const j of Object.keys(IDX) as J[]) {
      if (o.view === 'side') {
        const pt = p.body?.[j];
        const far: 'left' | 'right' = near === 'left' ? 'right' : 'left';
        put(j, far, pt && { x: pt.x - 6, y: pt.y - 3 }, 0.8);
        put(j, near, pt, 0.98);
      } else {
        put(j, 'left', p.left?.[j] ?? p.body?.[j], 0.97);
        put(j, 'right', p.right?.[j] ?? p.body?.[j], 0.97);
      }
    }
    return { t: smp.t, lm };
  });
  return { version: 1, width: o.width, height: o.height, source: 'synthetic', frames };
}

// ── Exercise generators ───────────────────────────────────────────────────

const PORTRAIT = { width: 720, height: 1280 };
const LANDSCAPE = { width: 1280, height: 720 };

export interface GenOptions {
  reps?: RepSpec[];
  fps?: number;
  noisePx?: number;
  seed?: number;
  view?: 'side' | 'front';
  dropouts?: RenderOptions['dropouts'];
  absent?: RenderOptions['absent'];
  endAtTurn?: boolean;
}

const defaultReps = (n: number, r: RepSpec): RepSpec[] => Array.from({ length: n }, () => ({ ...r }));

/**
 * Back squat, side view. Faulted reps are shallow (thigh stops above
 * parallel) or, with faultKind 'lean', lean forward by leanFault degrees.
 */
export function squat(
  o: GenOptions & {
    faultKind?: 'shallow' | 'lean';
    lean?: number;
    leanFault?: number;
    deepThigh?: number;
    shallowThigh?: number;
    shinMax?: number;
  } = {},
) {
  const fps = o.fps ?? 20;
  const reps = o.reps ?? defaultReps(4, { out: 1.8, hold: 0.2, back: 1.1, rest: 0.8 });
  const ankle = { x: 380, y: 1150 };
  const samples = profile(reps, fps, 1.2, 1.2, o.endAtTurn);
  if (o.view === 'front') {
    // Same squat filmed from the front: knees bend toward the camera, so the
    // body shortens on screen and both sides are spread.
    return render(
      samples,
      (s) => {
        const drop = s.s * 260;
        const mk = (dx: number): Body => ({
          nose: { x: 360, y: 230 + drop },
          ear: { x: 360 + dx * 0.4, y: 215 + drop },
          shoulder: { x: 360 + dx * 1.6, y: 340 + drop },
          elbow: { x: 360 + dx * 2.2, y: 380 + drop },
          wrist: { x: 360 + dx * 1.9, y: 330 + drop },
          hip: { x: 360 + dx * 0.9, y: 640 + drop * 0.9 },
          knee: { x: 360 + dx * 1.1, y: 900 + drop * 0.2 },
          ankle: { x: 360 + dx * 1.0, y: 1150 },
          heel: { x: 360 + dx * 1.0, y: 1165 },
          toe: { x: 360 + dx * 1.2, y: 1175 },
        });
        return { left: mk(70), right: mk(-70) };
      },
      { ...PORTRAIT, view: 'front', noisePx: o.noisePx, seed: o.seed, dropouts: o.dropouts, absent: o.absent },
    );
  }
  return render(
    samples,
    (s) => {
      const shallow = s.fault && (o.faultKind ?? 'shallow') === 'shallow';
      const thighMax = shallow ? (o.shallowThigh ?? 72) : (o.deepThigh ?? 102);
      const lean = s.fault && o.faultKind === 'lean' ? (o.leanFault ?? 68) : (o.lean ?? 40);
      const k = s.s;
      const body = legsAndTorso(ankle, (o.shinMax ?? 32) * k, thighMax * k, lean * k);
      // Hands holding the bar on the upper back.
      const { elbow, wrist } = elbowFor(body.shoulder!, { x: body.shoulder!.x - 40, y: body.shoulder!.y + 20 }, 1);
      return { body: { ...body, elbow, wrist } };
    },
    { ...PORTRAIT, view: 'side', noisePx: o.noisePx, seed: o.seed, dropouts: o.dropouts, absent: o.absent },
  );
}

/** Bench press, lying side view. fault: partial (bar stops high). drift: wrist x travel in px. */
export function bench(o: GenOptions & { drift?: number; partialHeight?: number; lockoutReach?: number } = {}) {
  const fps = o.fps ?? 20;
  const reps = o.reps ?? defaultReps(4, { out: 1.6, hold: 0.1, back: 1.0, rest: 0.6 });
  const sh = { x: 800, y: 430 };
  const hip = { x: 500, y: 432 };
  const knee = { x: 270, y: 470 };
  const ankle = { x: 250, y: 700 };
  return render(
    profile(reps, fps, 1.2, 1.2, o.endAtTurn),
    (s) => {
      // Seen from the side the upper arm flares toward the camera, so it
      // looks shorter than it is.
      const upper = SEG.upperArm * 0.77;
      const top = { x: sh.x, y: sh.y - (o.lockoutReach ?? 300) };
      const bottom = { x: sh.x - (o.drift ?? 60), y: sh.y - (s.fault ? (o.partialHeight ?? 230) : 60) };
      const { elbow, wrist } = elbowFor(sh, lerpP(top, bottom, s.s), -1, upper);
      return {
        body: {
          shoulder: sh,
          hip,
          knee,
          ankle,
          heel: { x: ankle.x - 20, y: ankle.y + 5 },
          toe: { x: ankle.x + 60, y: ankle.y + 10 },
          ear: { x: sh.x + 95, y: sh.y - 15 },
          nose: { x: sh.x + 120, y: sh.y - 40 },
          elbow,
          wrist,
        },
      };
    },
    { ...LANDSCAPE, view: 'side', noisePx: o.noisePx, seed: o.seed, dropouts: o.dropouts, absent: o.absent },
  );
}

/** Deadlift, side view, starts at the bottom. fault: hips high (torso near horizontal). */
export function deadlift(o: GenOptions & { drift?: number; startTorso?: number; hipsHighTorso?: number; lockout?: number } = {}) {
  const fps = o.fps ?? 20;
  const reps = o.reps ?? defaultReps(4, { out: 1.2, hold: 0.4, back: 1.2, rest: 1.0 });
  const ankle = { x: 380, y: 1150 };
  return render(
    profile(reps, fps, 1.2, 1.2, o.endAtTurn),
    (s) => {
      // s: 0 = set-up at the floor, 1 = lockout (inverted below).
      const k = 1 - s.s * (o.lockout ?? 1);
      const torso = (s.fault ? (o.hipsHighTorso ?? 82) : (o.startTorso ?? 55)) * k;
      const body = legsAndTorso(ankle, 20 * k, (s.fault ? 45 : 70) * k, torso);
      const barX = ankle.x + 20 + (o.drift ?? 0) * Math.sin(Math.PI * s.s);
      const wy = lerp(body.knee!.y + 60, body.hip!.y + 150, s.s);
      const { elbow, wrist } = elbowFor(body.shoulder!, { x: barX, y: wy }, 1);
      return { body: { ...body, elbow, wrist } };
    },
    { ...PORTRAIT, view: 'side', noisePx: o.noisePx, seed: o.seed, dropouts: o.dropouts, absent: o.absent },
  );
}

/** Romanian deadlift, side view. fault: squatting (big knee bend). */
export function rdl(o: GenOptions = {}) {
  const fps = o.fps ?? 20;
  const reps = o.reps ?? defaultReps(4, { out: 2.4, hold: 0.2, back: 1.2, rest: 0.6 });
  const ankle = { x: 380, y: 1150 };
  return render(
    profile(reps, fps, 1.2, 1.2, o.endAtTurn),
    (s) => {
      const k = s.s;
      const body = s.fault ? legsAndTorso(ankle, 30 * k, 75 * k, 45 * k) : legsAndTorso(ankle, 8 * k, 14 * k, 78 * k);
      const target = { x: ankle.x + 35, y: lerp(body.hip!.y + 150, body.knee!.y + 90, k) };
      const { elbow, wrist } = elbowFor(body.shoulder!, target, 1);
      return { body: { ...body, elbow, wrist } };
    },
    { ...PORTRAIT, view: 'side', noisePx: o.noisePx, seed: o.seed, dropouts: o.dropouts, absent: o.absent },
  );
}

/** Overhead press, side view. fault: leaning back at the top. */
export function overheadPress(o: GenOptions & { leanBack?: number; lockoutReach?: number } = {}) {
  const fps = o.fps ?? 20;
  const reps = o.reps ?? defaultReps(4, { out: 1.1, hold: 0.3, back: 1.4, rest: 0.6 });
  const ankle = { x: 380, y: 1150 };
  return render(
    profile(reps, fps, 1.2, 1.2, o.endAtTurn),
    (s) => {
      const lean = s.fault ? -(o.leanBack ?? 25) * s.s : 0;
      const body = legsAndTorso(ankle, 0, 0, lean);
      const sh = body.shoulder!;
      const rack = { x: sh.x + 70, y: sh.y - 20 };
      const top = { x: sh.x + 5, y: sh.y - (o.lockoutReach ?? 344) };
      const { elbow, wrist } = elbowFor(sh, lerpP(rack, top, s.s), 1);
      return { body: { ...body, elbow, wrist } };
    },
    { ...PORTRAIT, view: 'side', noisePx: o.noisePx, seed: o.seed, dropouts: o.dropouts, absent: o.absent },
  );
}

/** Barbell row, side view, hinged. fault: torso swings up while rowing. */
export function barbellRow(o: GenOptions = {}) {
  const fps = o.fps ?? 20;
  const reps = o.reps ?? defaultReps(4, { out: 0.9, hold: 0.2, back: 1.6, rest: 0.4 });
  const ankle = { x: 380, y: 1150 };
  return render(
    profile(reps, fps, 1.2, 1.2, o.endAtTurn),
    (s) => {
      const torso = s.fault ? lerp(55, 20, s.s) : 55;
      const body = legsAndTorso(ankle, 12, 25, torso);
      const sh = body.shoulder!;
      const hang = { x: sh.x, y: sh.y + 335 };
      const ribs = { x: body.hip!.x + 90, y: body.hip!.y - 40 };
      const { elbow, wrist } = elbowFor(sh, lerpP(hang, ribs, s.s), -1);
      return { body: { ...body, elbow, wrist } };
    },
    { ...PORTRAIT, view: 'side', noisePx: o.noisePx, seed: o.seed, dropouts: o.dropouts, absent: o.absent },
  );
}

/** Lateral raise, front view. fault: one arm lags (asymmetry). */
export function lateralRaise(o: GenOptions & { lagDeg?: number } = {}) {
  const fps = o.fps ?? 20;
  const reps = o.reps ?? defaultReps(4, { out: 1.0, hold: 0.3, back: 1.4, rest: 0.4 });
  return render(
    profile(reps, fps, 1.2, 1.2, o.endAtTurn),
    (s) => {
      const side = (dir: 1 | -1, lag: number): Body => {
        const sh = { x: 360 + dir * 110, y: 340 };
        const raise = Math.max(0, 85 * s.s - lag); // degrees out from hanging
        const elbow = { x: sh.x + dir * SEG.upperArm * Math.sin(rad(raise)), y: sh.y + SEG.upperArm * Math.cos(rad(raise)) };
        const wrist = { x: elbow.x + dir * SEG.forearm * Math.sin(rad(raise)), y: elbow.y + SEG.forearm * Math.cos(rad(raise)) };
        return {
          shoulder: sh,
          elbow,
          wrist,
          hip: { x: 360 + dir * 60, y: 640 },
          knee: { x: 360 + dir * 62, y: 895 },
          ankle: { x: 360 + dir * 64, y: 1150 },
          heel: { x: 360 + dir * 64, y: 1165 },
          toe: { x: 360 + dir * 75, y: 1175 },
          ear: { x: 360 + dir * 45, y: 225 },
          nose: { x: 360, y: 235 },
        };
      };
      // MediaPipe's left side appears on the image's right when facing the camera.
      return { left: side(1, 0), right: side(-1, s.fault ? (o.lagDeg ?? 30) * s.s : 0) };
    },
    { ...PORTRAIT, view: 'front', noisePx: o.noisePx, seed: o.seed, dropouts: o.dropouts, absent: o.absent },
  );
}

/** Plank, side view in landscape. sagPx pushes the hips down (or up when negative). */
export function plank(o: GenOptions & { seconds?: number; sagPx?: number; leadAbsentSec?: number } = {}) {
  const fps = o.fps ?? 20;
  const seconds = o.seconds ?? 12;
  const lead = o.leadAbsentSec ?? 1;
  const samples: Sample[] = [];
  for (let k = 0; k * (1000 / fps) <= (seconds + lead) * 1000; k++) {
    samples.push({ t: Math.round((k * 1000) / fps), s: 0, rep: 0, fault: false });
  }
  const sh = { x: 900, y: 420 };
  const ankle = { x: 340, y: 560 };
  return render(
    samples,
    () => {
      const line = lerpP(sh, ankle, 0.44);
      const hip = { x: line.x, y: line.y + (o.sagPx ?? 0) };
      const knee = lerpP(hip, ankle, 0.5);
      return {
        body: {
          shoulder: sh,
          hip,
          knee,
          ankle,
          heel: { x: ankle.x - 10, y: ankle.y - 20 },
          toe: { x: ankle.x + 10, y: ankle.y + 25 },
          elbow: { x: sh.x + 10, y: sh.y + 150 },
          wrist: { x: sh.x + 150, y: sh.y + 150 },
          ear: { x: sh.x + 90, y: sh.y - 20 },
          nose: { x: sh.x + 120, y: sh.y - 5 },
        },
      };
    },
    {
      ...LANDSCAPE,
      view: 'side',
      noisePx: o.noisePx,
      seed: o.seed,
      dropouts: o.dropouts,
      absent: [...(o.absent ?? []), { fromMs: 0, toMs: lead * 1000 - 1 }],
    },
  );
}

/** Calf raise, side view: small heel movement (tests small minAmplitude). */
export function calfRaise(o: GenOptions & { risePx?: number } = {}) {
  const fps = o.fps ?? 20;
  const reps = o.reps ?? defaultReps(6, { out: 0.8, hold: 0.4, back: 1.0, rest: 0.3 });
  return render(
    profile(reps, fps, 1.2, 1.2, o.endAtTurn),
    (s) => {
      const rise = (o.risePx ?? 30) * s.s;
      const ankle = { x: 380, y: 1150 - rise };
      const body = legsAndTorso(ankle, 0, 0, 0);
      const toe = { x: 450, y: 1170 };
      const heel = { x: ankle.x - 25, y: 1165 - rise * 1.3 };
      // Arms hanging straight, so arm lengths can be measured.
      const { elbow, wrist } = elbowFor(body.shoulder!, { x: body.shoulder!.x + 2, y: body.shoulder!.y + 400 }, 1);
      return { body: { ...body, toe, heel, elbow, wrist } };
    },
    { ...PORTRAIT, view: 'side', noisePx: o.noisePx, seed: o.seed, dropouts: o.dropouts, absent: o.absent },
  );
}
