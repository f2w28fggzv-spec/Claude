// Written sources behind check thresholds (Phase 3). Every threshold stays
// 'unvalidated' until it is calibrated against labelled recordings (Phase 4).
// Each entry was read in the original document, except winter2009 (a book,
// identified by its ISBN; see its note); numbers quoted in comments in
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
   * Appendix A was superseded in 2020 by ATP 7-22.01 (itself superseded on 12 March 2026; see
   * atp72201), whose hand-release push-up keeps the full extension and the straight body but goes
   * down to the floor. The rest of the manual was superseded in 2020 too: chapters 1–6 and appendix D
   * by FM 7-22, Holistic Health and Fitness (1 October 2020), chapters 7–10 and appendixes B, C and E
   * (the drills) by ATP 7-22.02 (see atp72202), as their title pages say.
   */
  fm722:
    'US Army FM 7-22, Army Physical Readiness Training (26 October 2012, incl. Change 1, 3 May 2013), Appendix A: Army Physical Fitness Test, push-up event (Appendix A superseded in 2020 by ATP 7-22.01)',
  /**
   * The same push-up event in the earlier field manual (chapter 14, pp. 14-11 to 14-13). Read at
   * https://elon.edu/assets/docs/rotc/FM%2021_20%20Physical%20Fitness%20Training.pdf. Superseded in
   * 2010: "Field Manual (FM) 21-20, Physical Fitness Training, has been revised and is now Training
   * Circular (TC) 3-22.20, Army Physical Readiness Training" (army.mil, 3 June 2010,
   * https://www.army.mil/article/40323/), which FM 7-22 in turn superseded in 2012.
   */
  fm2120:
    'US Army FM 21-20, Physical Fitness Training (30 September 1992, incl. Change 1, 1 October 1998), chapter 14: Army Physical Fitness Test, push-up event (superseded in 2010 by TC 3-22.20)',
  /**
   * The Army Fitness Test's hand-release push-up errors (chapter 2, para 2-59, p. 31). Read at
   * https://armypubs.army.mil/epubs/DR_pubs/DR_a/ARN46104-ATP_7-22.01-000-WEB-1.pdf. It supersedes
   * the 1 October 2020 edition (read at
   * https://arotc.illinoisstate.edu/downloads/resources/ATP_7-22.01_20201001.pdf), whose para 2-78 has
   * the errors quoted in exercises.ts in the same words.
   */
  atp72201: 'US Army ATP 7-22.01, Holistic Health and Fitness Testing (12 March 2026), para 2-59: hand-release push-up errors',
  /**
   * The Army's preparation drill: "Cadence is either slow or moderate (50 or 80 counts per minute,
   * respectively)" (para 1-17, p. 1-7); the Rear Lunge is done "at a slow cadence" (para 3-4, p. 3-2)
   * and the Push-Up "at a moderate cadence", lowering on count 1 (para 3-13, pp. 3-8 to 3-9). Read at
   * https://armypubs.army.mil/epubs/DR_pubs/DR_a/ARN45013-ATP_7-22.02-001-WEB-4.pdf (incl. Change 1).
   * It superseded chapters 7–10 of FM 7-22 (2012), which had the same drill: the Rear Lunge "is
   * always performed at a slow cadence. On counts 1 and 3, move into position in a slow, controlled
   * manner" (p. 8-5), the Push-Up at "Cadence: MODERATE" (p. 8-14), SLOW and MODERATE 50 and 80
   * counts per minute (para 7-25, p. 7-11).
   */
  atp72202:
    'US Army ATP 7-22.02, Holistic Health and Fitness Drills and Exercises (1 October 2020, incl. Change 1, 2025): Preparation Drill, rear lunge at a slow cadence (50 counts a minute)',
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
   * A book (ISBN 978-0-470-39818-0), not online, and not opened for the reverse lunge's depth: its
   * segment lengths as fractions of height are the values src/engine/personalize.ts and
   * src/demo/figure.ts already quote (thigh 0.245, shank 0.246, torso 0.818 − 0.530 = 0.288).
   */
  winter2009: 'Winter DA (2009). Biomechanics and Motor Control of Human Movement, 4th ed.',
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
 * at 15–60 fps on a body moved rigidly, so the tracked joint follows the
 * profile itself: a 1.0 s lowering with a minimum-jerk profile reads
 * 0.64–0.73 s, a cosine-eased one 0.73–0.80 s, one at constant speed
 * 0.92–1.0 s; the library's demos read 50–75% (mean 67%) of their lowering.
 * On a lift, how the tracked joint moves along its own path counts too (see
 * MIN_ECCENTRIC_SEC). src/demo/timeline.ts paces the demos with this share.
 */
export const TEMPO_MEASURED_SHARE = 0.65;

/**
 * ACSM 2009's lower bound for a moderate tempo ("1–2 s ECC") as the engine
 * measures it (see TEMPO_MEASURED_SHARE). For a tracked joint moving with a
 * minimum-jerk profile it passes a smooth 1.0 s lowering at about the limit
 * (0.64–0.73 s: 17 of 18 reps at 15–60 fps), while a 0.8 s one reads
 * 0.52–0.60 s and fails. On a lift's own path the tracked joint can start
 * slower or faster than the lift as a whole: on the demos' paths, eased as the
 * demos are, the limit falls at about 0.75–0.9 s of real lowering for the
 * bench press and the barbell row, 0.85–0.95 s for the Romanian deadlift,
 * 0.95–1.0 s for the reverse lunge and 1.0–1.15 s for the back squat, whose
 * hip barely moves while the knees first bend (the shortest lowering that
 * passes every rep at 15–60 fps); with minimum-jerk progress on the same
 * paths each is 0.1–0.2 s more (the squat 1.15–1.3 s). Those spreads come
 * from how the demos are built as much as from the lifts, so one limit for
 * every lift, roughly 1 s in all, until calibration with real labelled reps
 * gives each lift its own (src/calibration/calibrate.ts sweeps minSec per
 * exercise).
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
