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
  /**
   * The Army Physical Fitness Test's push-up event (Figure A-1, p. A-6): depth, full extension and the
   * body line seen from the side. Read at https://armyrotc.siu.edu/_common/documents/fm-7-22.pdf.
   * Appendix A was superseded in 2020 by ATP 7-22.01, whose hand-release push-up keeps the full
   * extension and the straight body but goes down to the floor.
   */
  fm722:
    'US Army FM 7-22, Army Physical Readiness Training (26 October 2012, incl. Change 1, 3 May 2013), Appendix A: Army Physical Fitness Test, push-up event (Appendix A superseded in 2020 by ATP 7-22.01)',
  /**
   * The same push-up event in the earlier field manual (chapter 14, pp. 14-11 to 14-13). Read at
   * https://elon.edu/assets/docs/rotc/FM%2021_20%20Physical%20Fitness%20Training.pdf.
   */
  fm2120: 'US Army FM 21-20, Physical Fitness Training (30 September 1992, incl. Change 1, 1 October 1998), chapter 14: Army Physical Fitness Test, push-up event',
  /**
   * The Army's current test: hand-release push-up errors (paragraphs 2-78 to 2-80). Read at
   * https://arotc.illinoisstate.edu/downloads/resources/ATP_7-22.01_20201001.pdf.
   */
  atp72201: 'US Army ATP 7-22.01, Holistic Health and Fitness Testing (1 October 2020): hand-release push-up',
  /**
   * A school fitness test's 90° push-up: the test on printed page 22, its form corrections on page 23.
   * Read at https://portal.ct.gov/-/media/SDE/Phys-Ed/CPFA-Manual-Fall-of-2022.pdf.
   */
  cpfa: 'Connecticut State Department of Education, Connecticut Physical Fitness Assessment (Third Generation), Test Administrator’s Manual 2021–22: 90° push-up, pp. 22–23',
  /**
   * Forward lunges lowered until the back knee was 2–3 cm off the floor (p. 405). Read as the
   * article's PDF at https://bretcontreras.com/wp-content/uploads/farrokhi-2008.pdf
   * (doi:10.2519/jospt.2008.2634).
   */
  farrokhi2008:
    'Farrokhi S, Pollard CD, Souza RB, Chen YJ, Reischl S, Powers CM (2008). Trunk position influences the kinematics, kinetics, and muscle activity of the lead lower extremity during the forward lunge exercise. J Orthop Sports Phys Ther 38(7):403–409',
  /**
   * A book (ISBN 978-0-470-39818-0), not online: its segment lengths as fractions of height, as
   * src/engine/personalize.ts and src/demo/figure.ts already use them (thigh 0.245, shank 0.246,
   * torso 0.818 − 0.530 = 0.288).
   */
  winter2009: 'Winter DA (2009). Biomechanics and Motor Control of Human Movement, 4th ed. (segment lengths as fractions of height)',
};

/**
 * Lockout tolerance used across lifts: "locked" means 180°, minus 15° for
 * 2D markerless measurement error (Wade et al. 2023: camera-side hip and knee
 * 95% limits of agreement about −13° to +10° against marker-based capture).
 */
export const LOCKOUT_DEG = 165;

/**
 * Tempo thresholds are in measured seconds, and the engine doesn't count the
 * slow ends of a phase: it times the smoothed tracked joint from the last
 * frame still within 5% of its travel of the start to the first frame within
 * 5% of the end (phaseSeconds in src/engine/checks.ts). For a smooth movement
 * that is about two thirds of the time it takes. Measured through analyze()
 * at 15–60 fps: a 1.0 s lowering with a minimum-jerk profile reads 0.65–0.73 s,
 * a cosine-eased one 0.73–0.80 s, one at constant speed 0.90–1.0 s; the
 * library's demos read 50–75% (mean 67%) of their 2 s lowering.
 * src/demo/timeline.ts paces the demos with this share.
 */
export const TEMPO_MEASURED_SHARE = 0.65;

/**
 * ACSM 2009's lower bound for a moderate tempo ("1–2 s ECC") as the engine
 * measures it (see TEMPO_MEASURED_SHARE): a smooth 1.0 s lowering passes at
 * about the limit (0.65–0.73 s with a minimum-jerk profile), while a smooth
 * 0.8 s one reads 0.52–0.60 s (minimum-jerk) or 0.58–0.67 s (cosine) and
 * mostly fails.
 */
export const MIN_ECCENTRIC_SEC = 0.65;

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
