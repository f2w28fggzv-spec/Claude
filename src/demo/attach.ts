import { add, along, dir, mul, type Figure, type Vec } from './figure';
import type { Attach } from './types';

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Where an attached prop sits on the figure (one or two points). */
export function attachPoints(f: Figure, at: Attach): Vec[] {
  const shoulder = mid(f.a.shoulder, f.b.shoulder);
  const hip = mid(f.a.hip, f.b.hip);
  switch (at) {
    case 'wrist':
      return [f.a.wrist];
    case 'wrists':
      return [f.a.wrist, f.b.wrist];
    case 'backRack':
      return [add(along(shoulder, f.torso - 90, 0.05), mul(dir(f.torso), 0.01))];
    case 'frontRack':
      return [along(shoulder, f.torso + 90, 0.06)];
    case 'lap':
      return [along(hip, f.torso + 90, 0.08)];
    case 'knee':
      return [add(f.a.knee, { x: 0, y: -0.06 })];
    case 'ankle':
      return [f.a.ankle];
    case 'ankles':
      return [f.a.ankle, f.b.ankle];
    case 'shoulder':
      return [shoulder];
    case 'hip':
      return [hip];
  }
}
