// Written sources behind check thresholds (Phase 3). Every threshold stays
// 'unvalidated' until it is calibrated against labelled recordings (Phase 4).
// Each entry was read in the original document; numbers quoted in comments in
// exercises.ts come from these.
import type { Check, Joint } from './types';

export const SRC = {
  /** NSCA "Lifting Proficiencies for Various Strength Movements" (technique checklists). */
  nsca: 'NSCA, Lifting Proficiencies for Various Strength Movements (copy hosted by Western Illinois University)',
  /** IPF Technical Rules Book 2026, rules of performance for squat, bench press and deadlift. */
  ipf: 'IPF Technical Rules Book 2026 (updated 1 January 2026)',
  larsen2021:
    'Larsen S, Kristiansen E, Helms E, van den Tillaar R (2021). Effects of stance width and barbell placement on kinematics, kinetics, and myoelectric activity in back squats. Front Sports Act Living 3:719013',
  duffey2005:
    'Duffey MJ, Challis JH (2005). Fatigue effects on bar kinematics during the bench press. ISB XXth Congress – ASB 29th Annual Meeting, Cleveland',
  acsm2009:
    'American College of Sports Medicine (2009). Progression models in resistance training for healthy adults. Med Sci Sports Exerc 41(3):687–708',
  wade2023:
    'Wade L, Needham L, Evans M, McGuigan P, Colyer S, Cosker D, Bilzon J (2023). Examination of 2D frontal and sagittal markerless motion capture: implications for markerless applications. PLoS One 18(11):e0293917',
  soucie2011:
    'Soucie JM, et al. (2011). Range of motion measurements: reference values and a database for comparison studies. Haemophilia 17(3):500–507',
  schellenberg2013:
    'Schellenberg F, Lindorfer J, List R, Taylor WR, Lorenzetti S (2013). Kinetic and kinematic differences between deadlifts and goodmornings. BMC Sports Sci Med Rehabil 5:27',
};

/**
 * Lockout tolerance used across lifts: "locked" means 180°, minus 15° for
 * 2D markerless measurement error (Wade et al. 2023: camera-side hip and knee
 * 95% limits of agreement about −13° to +10° against marker-based capture).
 */
export const LOCKOUT_DEG = 165;

/**
 * Tempo thresholds are in measured seconds. The engine times the movement
 * between the 5% and 95% points of each phase, which is about 80% of the
 * full phase, so ACSM's 1 s lower bound for a moderate tempo becomes 0.8 s.
 */
export const MIN_ECCENTRIC_SEC = 0.8;

/** Normal adult active range (Soucie et al. 2011, ages 20–44, lower of the male/female means). */
const NORMAL_RANGE: Partial<Record<Joint, string>> = {
  elbow: 'elbow flexion 145–150°',
  knee: 'knee flexion 138–142°',
  hip: 'hip flexion 130–134°',
  shoulder: 'shoulder flexion 169–172°',
};

/** Source text for a 'basic analysis' range-of-motion check that has no published standard yet. */
export function basicRangeSource(check: Check): string {
  const joint = 'angle' in check ? check.angle.vertex : undefined;
  const norm = joint ? NORMAL_RANGE[joint] : undefined;
  return (
    'Draft minimum movement for a full rep; no published standard used yet' +
    (norm ? `. For reference, normal adult ${norm} (${SRC.soucie2011})` : '') +
    '. To be set from labelled recordings.'
  );
}

/** Attaches a source to a check. */
export const cite = (check: Check, source: string): Check => ({ ...check, source });
