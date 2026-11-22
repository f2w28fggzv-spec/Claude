// Equipment for exercise demos, as SVG markup in four depth layers so the
// body can be painted between them: a barbell's plate sits behind the
// lifter, the bar itself between the trunk and the near hand.
//
// Equipment stays neutral (steel, pads); heat colours belong to the muscles.
import { attachPoints } from './attach';
import { add, along, angleOf, sub, type Figure, type Side, type Vec } from './figure';
import type { Prop } from './types';

/**
 * back: behind everything. behind: between the far limbs and the trunk.
 * mid: between the near leg and the near arm (a held bar under the fist).
 * hand: just over the near arm (the end-on head of a dumbbell in that hand).
 * front: over everything. See ./render for the order with the hands between the legs.
 */
export type Depth = 'back' | 'behind' | 'mid' | 'hand' | 'front';
export type EquipmentLayers = Record<Depth, string>;

const n = (v: number) => (Math.round(v * 10000) / 10000).toString();
const STEEL = 'var(--equip)';
const LINE = 'var(--equip-line)';
const FILL = 'var(--equip-fill)';
const PAD = 'var(--pad)';
/** Steel with a thin outline, so a dumbbell still reads in front of a dark pad or the body. */
const OUTLINED = `fill="${STEEL}" stroke="${LINE}" stroke-width="0.006"`;

/** Direction a segment of the near side points (from the joint above; the trunk from hip to shoulder), for pads that turn with it. */
function segmentDeg(s: Side, frame: 'shin' | 'thigh' | 'forearm' | 'trunk'): number {
  if (frame === 'trunk') return angleOf(sub(s.shoulder, s.hip));
  if (frame === 'shin') return angleOf(sub(s.ankle, s.knee));
  if (frame === 'thigh') return angleOf(sub(s.knee, s.hip));
  return angleOf(sub(s.wrist, s.elbow));
}

const circle = (c: Vec, r: number, attrs: string) => `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(r)}" ${attrs}/>`;
const seg = (a: Vec, b: Vec, w: number, colour: string, extra = '') =>
  `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="${colour}" stroke-width="${n(w)}" stroke-linecap="round" ${extra}/>`;
const poly = (pts: Vec[], w: number, colour: string) =>
  `<polyline points="${pts.map((q) => `${n(q.x)},${n(q.y)}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Default plate radius: a 45 cm plate on a 1.75 m lifter. */
export const PLATE_R = 0.125;

/** Points a prop reaches, for fitting the picture. */
export function propExtent(p: Prop, f: Figure): Vec[] {
  const out: Vec[] = [];
  const around = (c: Vec, r: number) => out.push({ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r });
  if ('at' in p && typeof p.at === 'string') {
    const off = p.kind === 'pad' && p.offset ? Math.hypot(p.offset.x, p.offset.y) : 0;
    const r =
      p.kind === 'barbell'
        ? (p.plate ?? PLATE_R) + 0.01
        : p.kind === 'kettlebell'
          ? 0.15
          : p.kind === 'dumbbell' && (p.lengthwise || p.cupped)
            ? 0.13
            : 0.06 + off;
    for (const q of attachPoints(f, p.at)) {
      if (p.kind === 'attached') out.push({ x: q.x + p.from.x, y: q.y + p.from.y }, { x: q.x + p.to.x, y: q.y + p.to.y });
      else around(q, r);
    }
  }
  if (p.kind === 'bench') for (const q of p.points) around(q, 0.03);
  if (p.kind === 'box') out.push({ x: p.x, y: p.y }, { x: p.x + p.w, y: p.y + p.h });
  if (p.kind === 'bar') around(p.at, 0.03);
  if (p.kind === 'cable' || p.kind === 'band') around(p.from, 0.03);
  if (p.kind === 'line') out.push(p.from, p.to);
  if (p.kind === 'wall') out.push({ x: p.x - 0.03, y: p.top });
  return out;
}

/** All of a demo's equipment for one frame, by depth layer. */
export function drawEquipment(props: readonly Prop[], f: Figure, floor: number | null): EquipmentLayers {
  const out: EquipmentLayers = { back: '', behind: '', mid: '', hand: '', front: '' };
  for (const p of props) {
    switch (p.kind) {
      case 'barbell': {
        const r = p.plate ?? PLATE_R;
        for (const c of attachPoints(f, p.at)) {
          // The plates: drawn behind the lifter so they never cover the body.
          out.back += circle(c, r, `fill="${FILL}" stroke="${LINE}" stroke-width="0.008"`) + circle(c, r * 0.8, `fill="none" stroke="${LINE}" stroke-width="0.004" opacity="0.6"`) + circle(c, r * 0.3, `fill="${LINE}" opacity="0.5"`);
          // The bar, seen end-on, under the near hand.
          out.mid += circle(c, 0.02, `fill="${STEEL}"`) + circle(c, 0.009, `fill="${FILL}"`);
        }
        break;
      }
      case 'dumbbell': {
        const pts = attachPoints(f, p.at);
        pts.forEach((c, i) => {
          const far = i === 1 || p.at === 'wrist2';
          let s: string;
          if (p.upright) {
            // Held on end (goblet squat): two heads, one above the other; cupped = palms under the top head, the rest hanging below.
            const y = c.y + (p.cupped ? 0.02 : 0);
            s = `<rect x="${n(c.x - 0.009)}" y="${n(y - 0.03)}" width="0.018" height="0.06" fill="${LINE}"/><rect x="${n(c.x - 0.034)}" y="${n(y - 0.062)}" width="0.068" height="0.044" rx="0.012" ${OUTLINED}/><rect x="${n(c.x - 0.034)}" y="${n(y + 0.018)}" width="0.068" height="0.044" rx="0.012" ${OUTLINED}/>`;
          } else if (p.lengthwise) {
            // Neutral grip: the handle runs across the fist, a head at each end (about 34 cm long, 27 cm when light).
            const side = far ? f.b : f.a;
            const across = angleOf(sub(side.hand, side.wrist)) + 90;
            const [reach, len, thick] = p.light ? [0.05, 0.052, 0.038] : [0.062, 0.07, 0.046];
            const a = along(c, across, reach);
            const b = along(c, across + 180, reach);
            const head = (q: Vec) =>
              `<g transform="translate(${n(q.x)} ${n(q.y)}) rotate(${n(across)})"><rect x="${n(-len / 2)}" y="${n(-thick / 2)}" width="${n(len)}" height="${n(thick)}" rx="0.011" ${OUTLINED}/></g>`;
            s = seg(a, b, 0.016, STEEL) + head(a) + head(b);
          } else {
            // Seen end-on: the hexagonal head nearest the camera.
            const r = p.light ? 0.033 : 0.04;
            const hex = Array.from({ length: 6 }, (_, k) => {
              const a = (Math.PI / 3) * k + Math.PI / 6;
              return `${n(c.x + r * Math.cos(a))},${n(c.y + r * Math.sin(a))}`;
            }).join(' ');
            s = `<polygon points="${hex}" ${OUTLINED} stroke-linejoin="round"/>` + circle(c, 0.012, `fill="${FILL}" opacity="0.7"`);
          }
          // The far one behind the lifter. Near: an end-on head is closer to the camera than the fist; a
          // dumbbell held on end or lengthwise sits under the fingers.
          if (far) out.back += s;
          else if (p.upright || p.lengthwise) out.mid += s;
          else out.hand += s;
        });
        break;
      }
      case 'kettlebell':
        for (const c of attachPoints(f, p.at)) {
          // Drawn hanging (handle up, bell below the fist); a swing turns it to fly in line with the arm.
          const side = p.at === 'wrist2' ? f.b : f.a;
          const turn = p.swing ? 180 + angleOf(sub(side.hand, side.wrist)) : 0;
          const bell = `<path d="M-0.03 0.05 C-0.045 -0.02 0.045 -0.02 0.03 0.05" fill="none" stroke="${STEEL}" stroke-width="0.014" stroke-linecap="round"/>` + circle({ x: 0, y: 0.09 }, 0.052, `fill="${STEEL}"`);
          out.mid += `<g transform="translate(${n(c.x)} ${n(c.y)})${turn ? ` rotate(${n(turn)})` : ''}">${bell}</g>`;
        }
        break;
      case 'bench': {
        const first = p.points[0];
        const last = p.points[p.points.length - 1];
        let s = '';
        if (p.legs !== false && floor !== null) {
          for (const q of [first, last]) s += seg({ x: q.x, y: q.y + 0.02 }, { x: q.x, y: floor - 0.008 }, 0.018, STEEL) + seg({ x: q.x - 0.035, y: floor - 0.008 }, { x: q.x + 0.035, y: floor - 0.008 }, 0.016, STEEL);
        }
        s += poly(p.points, 0.046, PAD);
        out.behind += s;
        break;
      }
      case 'box':
        out.behind += `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="0.012" fill="${FILL}" stroke="${LINE}" stroke-width="0.008"/>` + seg({ x: p.x + 0.012, y: p.y + 0.02 }, { x: p.x + p.w - 0.012, y: p.y + 0.02 }, 0.004, LINE, 'opacity="0.6"');
        break;
      case 'bar':
        out.mid += circle(p.at, 0.02, `fill="${STEEL}"`) + circle(p.at, 0.009, `fill="${FILL}"`);
        break;
      case 'wall':
        // The slab behind the face the lifter touches; the face is drawn as a line.
        out.back += `<rect x="${n(p.facing === 'left' ? p.x : p.x - 0.05)}" y="${n(p.top)}" width="0.05" height="${n((floor ?? 0) - p.top)}" fill="${FILL}"/>` + seg({ x: p.x, y: p.top }, { x: p.x, y: floor ?? 0 }, 0.008, LINE);
        break;
      case 'cable':
      case 'band':
        for (const c of attachPoints(f, p.at)) {
          if (p.kind === 'cable' && p.rope) {
            // A rope handle: the cable ends a little short of the fist, the rope runs into it with a knob.
            const ropeStart = along(c, angleOf(sub(p.from, c)), 0.06);
            out.mid += seg(p.from, ropeStart, 0.007, LINE) + seg(ropeStart, c, 0.014, PAD) + circle(c, 0.014, `fill="${PAD}"`);
          } else {
            out.mid += seg(p.from, c, p.kind === 'band' ? 0.012 : 0.007, LINE, p.kind === 'band' ? 'stroke-dasharray="0.02 0.016"' : '');
          }
        }
        if (p.kind === 'cable') {
          // The machine's column, from the floor to just past the pulley, so the cable comes from somewhere;
          // with `column` the tower stands there and the pulley hangs on an arm out in front of it.
          const x = p.column ?? p.from.x;
          if (floor !== null) {
            const top = Math.min(p.from.y - 0.06, floor - 0.2);
            out.back += `<rect x="${n(x - 0.022)}" y="${n(top)}" width="0.044" height="${n(floor - top)}" rx="0.01" fill="${FILL}" stroke="${LINE}" stroke-width="0.006"/>`;
          }
          if (p.column !== undefined) out.back += seg({ x, y: p.from.y - 0.03 }, { x: p.from.x, y: p.from.y - 0.03 }, 0.02, STEEL);
          out.back += circle(p.from, 0.028, `fill="${FILL}" stroke="${STEEL}" stroke-width="0.01"`) + circle(p.from, 0.007, `fill="${STEEL}"`);
        }
        break;
      case 'pad':
        for (const c of attachPoints(f, p.at)) {
          const o = p.offset ?? { x: 0, y: 0 };
          // In a segment's frame the offset turns with it: x along the segment, y toward its +90° side.
          const deg = p.frame ? segmentDeg(f.a, p.frame) : 0;
          const at = p.frame ? add(along(c, deg, o.x), along({ x: 0, y: 0 }, deg + 90, o.y)) : { x: c.x + o.x, y: c.y + o.y };
          if (p.block) {
            const { along: h, across: w } = p.block;
            out.front += `<g transform="translate(${n(at.x)} ${n(at.y)}) rotate(${n(deg)})"><rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(w, h) * 0.4)}" fill="${PAD}"/></g>`;
          } else out.front += circle(at, 0.035, `fill="${PAD}"`);
        }
        break;
      case 'attached':
        for (const c of attachPoints(f, p.at)) {
          const line = seg({ x: c.x + p.from.x, y: c.y + p.from.y }, { x: c.x + p.to.x, y: c.y + p.to.y }, p.width ?? 0.02, p.pad ? PAD : STEEL);
          if (p.pad) out.behind += line;
          else out.mid += line;
        }
        break;
      case 'line':
        out.back += seg(p.from, p.to, p.width ?? 0.02, STEEL);
        break;
    }
  }
  return out;
}
