// Which muscles each exercise works, what each one does, and where in the rep
// the load is hardest: the data behind the demo's muscle colours.
//
// Every entry uses exactly the exercise's primary and secondary groups from
// ./exercises.ts (primary = main movers); tests/engagement-data.test.ts
// enforces that. Model and field meanings: ../demo/engagement.ts.
import { defaultEngagement, type Engagement } from '../demo/engagement';
import type { Exercise } from './types';

export const ENGAGEMENT: Record<string, Engagement> = {
  // Standing tall with a slight forward lean (about 9 degrees), knees and hips straight, barbell across the upper back over mid-foot. -> Bottom of a deep squat: hips just below knee height, torso leaning about 43 degrees, knees forward just past the toes, bar still over mid-foot.
  'back-squat': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'straighten the knees' },
      { group: 'glutes', role: 'main', peak: 0.9, note: 'extend the hips, most out of the bottom' },
      { group: 'hamstrings', role: 'assist', peak: 0.45, note: 'help extend the hips' },
      { group: 'core', role: 'stabilize', peak: 0.4, note: 'braces to keep the torso rigid under the bar' },
    ],
    why: 'Standing tall the bar sits over stacked joints, so the legs mostly hold posture; as the hips move back and the knees forward, the hip and knee extensor moments grow and are largest at the bottom. In the animated path the hip moment is already about 70% of its maximum halfway down while the knee moment builds later, so the shared mid value of 0.6 is a blend of the two. Relative effort of the knee and hip extensors rises with squat depth (Bryanton et al. 2012), and the gluteus maximus takes a larger share of hip and thigh muscle activity in deeper squats (Caterisano et al. 2002).',
  },
  // Standing tall with the barbell racked on the front of the shoulders, elbows high, torso upright. -> Deep squat with an upright torso (about 13 degrees of lean), hips below knee height, knees well forward past the toes, bar over mid-foot.
  'front-squat': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'straighten the knees' },
      { group: 'glutes', role: 'main', peak: 0.85, note: 'extend the hips' },
      { group: 'core', role: 'stabilize', peak: 0.4, note: 'braces the trunk against the bar\'s pull forward' },
    ],
    why: 'Same curve as the back squat: least demand standing over stacked joints, most at the bottom. The front-racked bar keeps the torso nearly upright, so the hips stay closer under the bar and the knee carries the larger moment: the quads lead and the glutes work less than in a back squat. The abdominals brace so the trunk stays rigid while the bar in front tries to fold it forward.',
  },
  // Standing tall holding a dumbbell upright against the chest, elbows down. -> Deep squat with hips below the knees, torso leaning about 35 degrees, knees well forward, dumbbell still held at the chest.
  'goblet-squat': {
    profile: [0.2, 0.6, 1],
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'straighten the knees' },
      { group: 'glutes', role: 'main', peak: 0.85, note: 'extend the hips' },
      { group: 'core', role: 'stabilize', peak: 0.35, note: 'braces while the arms hold the weight at the chest' },
    ],
    why: 'The dumbbell held at the chest acts as a counterweight, so the lifter can sit deep between the knees with the knees well forward: demand is low standing tall and rises with depth to the bottom, where the knee and hip moments are largest. The light front load keeps the start lower than a barbell squat, and the core braces so the front-held weight does not fold the torso forward.',
  },
  // Standing tall with the bar on the upper back, a box just behind the heels. -> Hips back and down until the glutes touch the box: thighs parallel, shins tilted about 18 degrees, torso leaning about 55 degrees; held for a brief pause.
  'box-squat': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'drive the hips up off the box' },
      { group: 'quads', role: 'main', peak: 0.85, note: 'straighten the knees' },
      { group: 'hamstrings', role: 'assist', peak: 0.55, note: 'help the glutes extend the hips' },
    ],
    why: 'Sitting back to the box keeps the shins fairly upright (about 18 degrees) while the torso leans about 55 degrees, so the hips sit far behind the bar: in a static model of the animated path, at the same bar load the hip moment is about 35% larger and the knee moment about 35% smaller than in the free back squat, shifting work to the glutes and hamstrings. Demand still builds with depth (the hip moment is about 70% of its maximum halfway down, as in the back squat) and peaks at the box, where the lifter stays braced through the pause and drives up from a dead stop.',
  },
  // Standing tall with a slight forward lean, barbell across the upper back. -> Bottom of a deep back squat, hips just below the knees, torso leaning about 43 degrees, held still for about two seconds.
  'pause-squat': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'straighten the knees' },
      { group: 'glutes', role: 'main', peak: 0.9, note: 'extend the hips, most out of the bottom' },
      { group: 'core', role: 'stabilize', peak: 0.4, note: 'holds the brace through the pause' },
    ],
    why: 'Mechanically a back squat: least demand standing tall, most at the bottom where the knee and hip moments are longest. The pause holds that hardest position isometrically and removes the elastic rebound, so the bottom stays at full demand and the drive up starts from a dead stop.',
  },
  // Standing tall, arms held straight out in front at shoulder height. -> Deep squat with hips below the knees, torso leaning about 39 degrees, knees forward just past the toes, arms still forward for balance.
  'bodyweight-squat': {
    profile: [0.15, 0.6, 1],
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'straighten the knees' },
      { group: 'glutes', role: 'main', peak: 0.85, note: 'extend the hips' },
    ],
    why: 'Without added load, standing tall needs almost no knee or hip extensor effort because body weight passes close to the joints; the moments grow with depth as the hips move behind the feet and peak at the bottom. The outstretched arms act as a counterweight that keeps the centre of mass over the mid-foot.',
  },
  // Top of a split stance: rear foot laces-down on a bench behind, front knee nearly straight (about 23 degrees bent), dumbbells hanging at the sides. -> Bottom: front thigh level with the floor, front shin nearly vertical, back knee lowered toward the floor, torso leaning about 14 degrees.
  'bulgarian-split-squat': {
    profile: [0.25, 0.65, 1],
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'straighten the front knee' },
      { group: 'glutes', role: 'main', peak: 0.95, note: 'extend the front hip' },
      { group: 'hamstrings', role: 'assist', peak: 0.5, note: 'help extend the front hip' },
    ],
    why: 'The rear foot on the bench mostly steadies, so the front leg does most of the work: little demand at the top where that leg is nearly straight, most at the bottom where its knee and hip are most bent. The front shin stays nearly vertical while the hips sit well behind the front foot, so the front hip extensors (glutes, hamstrings) take a larger share than in a bilateral squat.',
  },
  // Top of a split stance: front foot flat, back foot on its toes, both knees nearly straight, hands on the hips. -> Bottom: front thigh parallel to the floor, front shin nearly vertical, back knee just above the floor, torso nearly upright.
  'split-squat': {
    profile: [0.2, 0.65, 1],
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'straighten the front knee' },
      { group: 'glutes', role: 'main', peak: 0.9, note: 'extend the front hip' },
    ],
    why: 'Both feet stay down but the front leg takes most of the work: its knee and hip extensor moments grow as the back knee drops and peak at the bottom, with little demand at the top where the front leg is almost straight. Body weight only, so the top position is close to relaxed standing.',
  },
  // Standing tall with the feet together, dumbbells hanging at the sides. -> Bottom of the lunge after stepping forward: front thigh level with the floor, front shin nearly vertical, back knee just above the floor with the back foot on its toes, torso nearly upright, dumbbells hanging.
  'walking-lunge': {
    profile: [0.2, 0.4, 1],
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'straighten the front knee' },
      { group: 'glutes', role: 'main', peak: 0.9, note: 'extend the front hip' },
      { group: 'hamstrings', role: 'assist', peak: 0.45, note: 'help extend the front hip' },
    ],
    why: 'Animated from standing with the feet together: the front foot steps forward and lands 40% of the way out, then the hips drop until the front thigh is level. While it steps the front leg carries nothing and the back leg holds the body on a nearly straight knee, so demand stays low through the step (halfway out the front knee is bent only about 40 degrees) and climbs to its maximum at the bottom, where the front knee and hip are most bent and the dumbbells add to both. A real walking lunge carries the back leg through into the next step instead of stepping back.',
  },
  // Standing tall on both feet, hands on the hips. -> Bottom of the lunge after stepping back: front thigh level with the floor, front shin nearly vertical, back knee just above the floor with the back foot on its toes, torso leaning slightly forward (about 10 degrees).
  'reverse-lunge': {
    profile: [0.2, 0.35, 1],
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'straighten the front knee' },
      { group: 'glutes', role: 'main', peak: 0.95, note: 'extend the front hip' },
    ],
    why: 'Animated from standing: the back foot reaches back and lands on its toes 40% of the way out while the front knee bends a little, then the hips drop until the front thigh is level. The front leg holds the body alone during the step but on a nearly straight knee, and halfway out that knee is bent only about 30 degrees, so demand stays low to moderate and climbs to its maximum at the bottom. The front shin stays nearly vertical and the torso leans a little, so the front hip does a large share of the work.',
  },
  // Lead foot flat on a knee-high box with the lead knee bent about 90 degrees, trailing foot flat on the floor behind, torso leaning slightly forward, dumbbells at the sides. -> Standing tall on the box on both feet, the trailing foot brought up beside the lead foot, dumbbells at the sides.
  'step-up': {
    profile: [0.4, 1, 0.25],
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'straighten the lead knee' },
      { group: 'glutes', role: 'main', peak: 0.95, note: 'extend the lead hip and keep the pelvis level' },
    ],
    why: 'At the start the trailing foot is still flat on the floor and carries much of the weight, so the deeply bent lead leg is only partly loaded. Once the weight shifts forward and the trailing foot leaves the floor (about a quarter of the way up), the lead leg lifts the body and dumbbells alone from a bent knee and hip: the hardest stretch, which the profile places at s = 0.5 (lead knee still bent about 85 degrees, shin well forward). Demand falls as the lead knee and hip straighten and is low standing tall on both feet on the box; while on one leg the gluteus medius also keeps the pelvis level.',
  },
  // Standing tall on the near leg, the other leg held straight and slightly forward just off the floor, arms reaching forward. -> Bottom of a full single-leg squat: standing knee bent about 140 degrees with the hip below knee height, torso leaning about 25 degrees, free leg held straight out in front at about hip height, arms forward.
  'pistol-squat': {
    profile: [0.2, 0.5, 1],
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'straighten the standing knee' },
      { group: 'glutes', role: 'main', peak: 0.9, profile: [0.35, 0.8, 1], note: 'extend the hip and keep the pelvis level on one leg' },
      { group: 'core', role: 'stabilize', peak: 0.45, note: 'steadies the pelvis while the free leg is held out' },
    ],
    why: 'One leg carries the whole body, kept over the mid-foot by the forward arms and free leg. The hip moment builds early (over 80% of its maximum halfway down, as the hips move behind the foot) while the knee moment keeps growing to the bottom, where the knee extensors are also weakest, so the quads are drawn hardest at the bottom and the glutes, which also hold the pelvis level on one leg, are high from mid-range. The abdominals steady the pelvis while the hip flexors hold the free leg out, most at the bottom where that leg is level.',
  },
  // Back flat against the wall, thighs level with the floor, shins vertical, knees bent 90 degrees, arms folded across the chest. -> The same position held still (isometric hold).
  'wall-sit': {
    profile: [1, 1, 1],
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'hold the knees bent at 90 degrees' },
      { group: 'glutes', role: 'stabilize', peak: 0.3, note: 'keep the hips steady' },
    ],
    why: 'An isometric hold with the thighs level: body weight sits well behind the knees, so the quads hold a large knee moment for the whole hold. The wall supports the back, leaving the glutes only light work keeping the hips in place.',
  },
  // Reclined about 58 degrees against the back pad, hands on the handles by the seat, feet flat on the footplate, sled pushed up its 45-degree rails until the knees are almost straight (about 15 degrees bent). -> Sled lowered until the knees are bent about 90 degrees, thighs nearly vertical and drawn toward the chest.
  'leg-press': {
    profile: [0.3, 0.7, 1],
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'straighten the knees to push the sled' },
      { group: 'glutes', role: 'main', peak: 0.85, note: 'extend the hips' },
    ],
    why: 'The sled pushes back along the line of the legs: with the knees nearly straight that line passes close to the knee (low demand), and as the sled lowers the knee moves away from it, so the knee moment is largest at the deepest point; quadriceps activity in closed-chain exercises, the leg press included, is greatest near full knee flexion (Escamilla et al. 1998). With the feet at this height on the plate the push passes close to the hips, so the hip moment is smaller and fairly steady; drawing the glutes on the same curve is a simplification (a higher foot placement loads them more).',
  },
  // Back flat on the sled pad (reclined about 28 degrees), shoulders under the pads, hands on the handles, knees almost straight, feet on the toes-up platform ahead of the hips. -> Sled slid down its rails until the thighs are parallel to the platform (hips just below the knees), knees bent about 120 degrees, shins tilted slightly forward, back still flat on the pad.
  'hack-squat': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'straighten the knees' },
      { group: 'glutes', role: 'main', peak: 0.85, note: 'extend the hips' },
    ],
    why: 'The back rests on the sled and the feet sit ahead of the hips, so the platform\'s push passes close to the hips and the knees carry most of the moment: a quad-dominant squat. The knee moment grows steadily with knee bend and is largest at the bottom, while standing with nearly straight knees the load passes through stacked joints; the hip moment stays fairly steady, so drawing the glutes on the same rising curve is a simplification.',
  },
  // Seated against the back pad (reclined about 12 degrees), knees bent about 100 degrees, shin pad on the front of the ankles, hands on the handles, weight stack resting. -> Knees straightened almost fully (about 5 degrees short), shins level with the thighs, pad and stack raised.
  'leg-extension': {
    profile: [0.5, 0.6, 1],
    restAtStart: true,
    muscles: [
      { group: 'quads', role: 'main', peak: 1, note: 'straighten the knees against the pad' },
    ],
    why: 'Open-chain knee extension: the knee extensors are strongest around 60 to 70 degrees of knee bend and weakest near full extension, so against a roughly constant machine torque (plus the lower leg\'s own weight, which acts most when the shin is level) the effort climbs toward the top; quadriceps activity in the knee extension is greatest near full extension (Escamilla et al. 1998). At the start the selected plates rest on the stack, so the quads are off until the pad moves, then hold it with good leverage; the exact curve depends on the machine\'s cam.',
  },
  // Standing tall, barbell hanging at arm's length against the front of the thighs, knees soft -> Hips pushed back and torso about 78 degrees forward, knees slightly bent, bar at about knee height
  'romanian-deadlift': {
    profile: [0.2, 0.6, 1],
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'lengthen under load, then extend the hip' },
      { group: 'glutes', role: 'main', peak: 0.9, note: 'extend the hip' },
      { group: 'back', role: 'stabilize', peak: 0.5, note: 'keeps the spine neutral as the torso tips forward' },
    ],
    why: 'The moment arm of the bar and torso about the hips grows with the forward lean, so demand rises from almost nothing standing to its maximum at the bottom (static estimate about 0.1, 0.6, 1.0 of the bottom), where the hamstrings are also at their longest. The erectors hold the spine still against the same growing moment.',
  },
  // Standing tall, a dumbbell in each hand against the front of the thighs, knees soft -> Hips pushed back and torso about 76 degrees forward, knees slightly bent, dumbbells at about knee height
  'dumbbell-romanian-deadlift': {
    profile: [0.2, 0.6, 1],
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'lengthen under load, then extend the hip' },
      { group: 'glutes', role: 'main', peak: 0.9, note: 'extend the hip' },
      { group: 'back', role: 'stabilize', peak: 0.5, note: 'keeps the spine neutral as the torso tips forward' },
    ],
    why: 'Same hinge as the barbell Romanian deadlift: the moment arm of the dumbbells and torso about the hips grows with the lean, so the hip extensors work hardest at the bottom, where the hamstrings are longest. The erectors hold the spine isometrically against that moment.',
  },
  // Standing tall on the working leg, the other foot just touching the floor beside it, dumbbell hanging in front of the thighs -> Hinged on the standing leg to about 75 degrees, free leg reaching straight back in line with the torso, dumbbell at about knee height
  'single-leg-rdl': {
    profile: [0.2, 0.7, 1],
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'standing leg: lengthen under load, then extend the hip' },
      { group: 'glutes', role: 'main', peak: 0.95, note: 'extend the hip and keep the pelvis level on one leg' },
      { group: 'core', role: 'stabilize', peak: 0.4, note: 'keeps the hips square and the trunk from twisting' },
    ],
    why: 'One hip carries the torso and dumbbell, whose moment grows with the hinge; the free leg reaching back counterbalances part of it, so demand climbs early and flattens near the bottom (static estimate about 0.1, 0.7, 1.0). Balancing on one leg also makes the glute medius and the trunk resist tipping and twisting once the free foot leaves the floor.',
  },
  // Bar resting on the floor against the shins, hips just above knee height behind it, torso about 62 degrees forward, arms straight -> Locked out standing tall, hips and knees straight, bar hanging at the top of the thighs
  'deadlift': {
    profile: [1, 0.75, 0.25],
    restAtStart: true,
    muscles: [
      { group: 'back', role: 'main', peak: 1, profile: [1, 0.8, 0.4], note: 'holds the spine rigid and the shoulders over the bar' },
      { group: 'glutes', role: 'main', peak: 0.95, note: 'extend the hip' },
      { group: 'hamstrings', role: 'main', peak: 0.9, note: 'extend the hip' },
      { group: 'quads', role: 'assist', peak: 0.6, profile: [1, 0.5, 0.05], note: 'straighten the knees to break the bar off the floor' },
      { group: 'core', role: 'stabilize', peak: 0.45, note: 'braces the trunk' },
    ],
    why: 'Just off the floor the bar and the inclined torso have their longest moment arm about the hips and lower back, so the pull is hardest at the start and eases as the torso rises (static hip moment about 1.0, 0.7, 0.1); the knee extension moment is largest at lift-off and gone by the time the bar passes the knees. The back works isometrically the whole way and, with the traps holding the shoulders, still carries the bar at lockout.',
  },
  // Bar resting on the floor, hips low behind it, torso more upright than the conventional pull (about 54 degrees forward), arms straight -> Locked out standing tall, hips and knees straight, bar hanging at the top of the thighs
  'sumo-deadlift': {
    profile: [1, 0.75, 0.25],
    restAtStart: true,
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'extend the hip and keep the knees pushed out' },
      { group: 'quads', role: 'main', peak: 0.9, profile: [1, 0.6, 0.05], note: 'straighten the knees off the floor' },
      { group: 'hamstrings', role: 'main', peak: 0.85, note: 'extend the hip' },
      { group: 'back', role: 'stabilize', peak: 0.5, note: 'keeps the spine neutral' },
    ],
    why: 'As in the conventional pull, the moment about the hips and lower back peaks just off the floor and falls toward lockout; the wide stance and more upright torso put more of the start on knee extension, so the quads stay involved further up. An EMG comparison (Escamilla et al. 2002) found more quadriceps activity in the sumo than in the conventional deadlift.',
  },
  // Standing tall, barbell across the upper back -> Hips pushed back and torso hinged about 72 degrees forward, knees slightly bent, bar still on the back
  'good-morning': {
    profile: [0.2, 0.55, 1],
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'lengthen under load, then extend the hip' },
      { group: 'glutes', role: 'assist', peak: 0.65, note: 'help extend the hip' },
      { group: 'back', role: 'stabilize', peak: 0.5, note: 'holds the spine neutral under the bar' },
    ],
    why: 'With the bar on the upper back, its moment arm about the hips and lower back grows with the forward lean, from almost none standing (bar right over the hips) to the maximum at the bottom (static estimate about 0, 0.55, 1.0). Because the bar sits far from the hips, the lower back resists a large moment through the whole descent.',
  },
  // Kneeling upright on a pad with the ankles anchored, body straight from knees to head -> Body tipped forward about 52 degrees from the knees, hips kept straight, hands ready to catch
  'nordic-curl': {
    profile: [0.1, 0.65, 1],
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'brake the knee as the body tips forward' },
    ],
    why: 'Upright, the body is balanced over the knees; as it tips forward the moment of everything above the knees grows with the sine of the lean (static estimate about 0.05, 0.6, 1.0), so the hamstrings work hardest at the deepest point shown. The lowering is the working phase of this exercise.',
  },
  // Lying face up, legs straight, heels on sliders, hips held just off the floor -> Hips bridged high and heels pulled in, knees bent to about 75 degrees of flexion
  'slider-leg-curl': {
    profile: [1, 0.85, 0.45],
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'pull the heels in and hold the hips up' },
      { group: 'glutes', role: 'stabilize', peak: 0.5, note: 'hold the hips up' },
    ],
    why: 'On sliders the floor can only push straight up at the heels, so the hamstrings hold the knee against a lever that is longest with the legs straight and the heels far out (static knee moment about 1.0, 0.8, 0.25, plus a hip moment that eases less); pulling the heels in under the knees shortens it, so the curled position is the easiest. The glutes keep the hips off the floor throughout.',
  },
  // Face down on the bench, legs straight, pad on the back of the lower legs, stack resting -> Knees bent past 90 degrees (about 105 degrees of flexion), heels curled up toward the glutes
  'lying-leg-curl': {
    profile: [0.5, 0.7, 1],
    restAtStart: true,
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'bend the knee' },
    ],
    why: 'The machine\'s resistance about the knee is roughly even through the range, but with the hips flat the hamstrings shorten at both ends as the heels approach the glutes and lose much of their strength, so the fully curled position is the hardest to hold.',
  },
  // Seated, legs straight out in front, pad on the back of the lower legs, stack resting -> Knees bent past 90 degrees (about 110 degrees of flexion), heels pulled down and back under the seat
  'seated-leg-curl': {
    profile: [0.65, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'bend the knee' },
    ],
    why: 'Sitting flexes the hips, so the hamstrings work from a lengthened position and lose less strength as the knee bends than in the lying curl; demand still rises toward the fully curled position, but the curve is flatter.',
  },
  // Hinged with the torso about 68 degrees forward, kettlebell swung back between the thighs -> Standing tall with the hips locked out, arms straight out in front, bell floating at chest height
  'kettlebell-swing': {
    profile: [1, 0.85, 0.3],
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'snap the hips forward' },
      { group: 'hamstrings', role: 'main', peak: 0.9, note: 'load in the backswing, then extend the hip' },
      { group: 'back', role: 'stabilize', peak: 0.45, note: 'keeps the spine neutral in the hinge' },
      { group: 'core', role: 'stabilize', peak: 0.4, note: 'braces the trunk and stops a lean back at the top' },
    ],
    why: 'A ballistic hinge: the hips work hardest at the bottom, where the bell\'s momentum is stopped and reversed, and through the hip drive while the bell swings under the body; at the top the hips are locked out and the bell floats, so little load remains. A static model would wrongly put a big load at the top, so the profile follows the swing\'s momentum instead.',
  },
  // Upper back on the bench, hips down by the floor, barbell resting across the hips, feet flat -> Hips driven up level with the shoulders and knees, shins vertical, bar held on the hips
  'hip-thrust': {
    profile: [0.7, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'drive the hips up; hardest at lockout' },
      { group: 'hamstrings', role: 'assist', peak: 0.5, profile: [1, 0.7, 0.45], note: 'help extend the hip, most low in the range' },
    ],
    why: 'With the back on the bench and the feet planted, the external hip moment stays fairly even through the range (static estimate within about 15%), but the glutes are shortest and weakest at full hip extension, so lockout is the hardest point. With the knees bent and the shins vertical at the top, the hamstrings are short and the knee needs no flexor work there, so their share fades as the hips rise.',
  },
  // Upper back on the bench, hips down by the floor, dumbbell resting across the hips, feet flat -> Hips driven up level with the shoulders and knees, shins vertical, dumbbell held on the hips
  'dumbbell-hip-thrust': {
    profile: [0.7, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'drive the hips up; hardest at lockout' },
      { group: 'hamstrings', role: 'assist', peak: 0.5, profile: [1, 0.7, 0.45], note: 'help extend the hip, most low in the range' },
    ],
    why: 'Same mechanics as the barbell hip thrust with a lighter load: the external hip moment is fairly even through the range, while the glutes are weakest at full hip extension, so lockout is hardest. The hamstrings help most low in the range and fade as the hips rise with the knees bent.',
  },
  // Lying face up, knees bent, feet flat, hips resting on the floor -> Hips raised until shoulders, hips and knees are almost in line
  'glute-bridge': {
    profile: [0.7, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'lift the hips; hardest at the top' },
      { group: 'hamstrings', role: 'assist', peak: 0.5, profile: [1, 0.7, 0.45], note: 'help extend the hip, most low in the range' },
    ],
    why: 'Supported at the shoulders and feet, the hip moment from body weight stays nearly even through the range (static estimate within about 15%), but the glutes are weakest at full hip extension, so the top is the hardest point. With the feet close to the hips and the knees well bent, the hamstrings are short and help mostly as the hips leave the floor.',
  },
  // Lying face up, one foot flat with the knee bent, the other leg held straight in line with its thigh, hips on the floor -> Hips raised on one leg until shoulders, hips and knee are almost in line, free leg still straight
  'single-leg-glute-bridge': {
    profile: [0.7, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'lift the hips and keep the pelvis level' },
      { group: 'hamstrings', role: 'assist', peak: 0.55, profile: [1, 0.7, 0.45], note: 'help extend the hip, most low in the range' },
    ],
    why: 'One leg lifts the hips and also carries the raised leg, so the hip moment is larger than in the two-leg bridge and stays even through the range; the glutes are weakest at full extension, which makes the top the hardest. On one leg the glute medius also keeps the pelvis from dropping on the free side.',
  },
  // Lying on the side (seen from the front), top leg resting on the bottom leg, head on the lower arm -> Top leg raised about 36 degrees with the knee straight
  'side-lying-hip-abduction': {
    profile: [0.8, 0.9, 1],
    restAtStart: true,
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'the glute medius lifts the leg' },
    ],
    why: 'The leg\'s weight has its longest lever about the hip just as it leaves the other leg (about 0.8 of that at the top), but the glute medius gets weaker as it shortens, so the effort keeps rising to the top of the lift.',
  },
  // Facing away from a low pulley, hinged with the torso about 70 degrees forward, hands holding the rope between the legs just below knee height -> Standing tall with the hips through, hands at the front of the hips, cable running back between the legs
  'cable-pull-through': {
    profile: [1, 0.65, 0.25],
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'extend the hip' },
      { group: 'hamstrings', role: 'main', peak: 0.9, note: 'extend the hip' },
    ],
    why: 'The forward-leaning torso and the cable pulling the hands back toward the low pulley both have their longest moment arm about the hips in the hinged position (static estimate about 1.0, 0.65, 0.1). Standing tall, the cable line passes just below the hips, so only a small backward pull is left for the glutes to hold at lockout.',
  },
  // Standing tall, a dumbbell in each hand at the sides, feet flat -> Up on the balls of the feet, heels lifted (ankles about 30 degrees past flat)
  'standing-calf-raise': {
    profile: [0.65, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'calves', role: 'main', peak: 1, note: 'lift the heels' },
    ],
    why: 'With the heels down the body and dumbbells rest on the heels and the calves are nearly off; once the heels lift, the whole load acts through the ball of the foot with a lever that shrinks only slightly as the ankle extends, while the calf shortens and weakens, so the top is the hardest position to hold.',
  },
  // Standing on one foot with the heel down, the other foot tucked up behind -> Up on the ball of the standing foot, heel lifted (ankle about 30 degrees past flat)
  'single-leg-calf-raise': {
    profile: [0.65, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'calves', role: 'main', peak: 1, note: 'lift the heel' },
    ],
    why: 'One calf lifts the whole body: the heel carries the weight at the start, the load comes on as the heel lifts, and the top is the hardest because the calf is shortest and weakest there.',
  },
  // Standing tall on both feet, heels down, arms at the sides -> Up on the balls of both feet, heels lifted (ankles about 30 degrees past flat)
  'bodyweight-calf-raise': {
    profile: [0.65, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'calves', role: 'main', peak: 1, note: 'lift the heels' },
    ],
    why: 'Body weight rests on the heels until they lift; from then on it acts through the ball of the foot with a lever that shrinks only slightly, and the top is the hardest because the calves are shortest and weakest there.',
  },
  // Perched on a tall box with the legs almost straight down to the floor, dumbbell on the knees, feet flat (as drawn; a seated raise normally bends the knees to about 90 degrees) -> Heels lifted (ankles about 34 degrees past flat), knees bending slightly
  'seated-calf-raise': {
    profile: [0.65, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'calves', role: 'main', peak: 1, note: 'lift the heels; with bent knees mostly the soleus' },
    ],
    why: 'The dumbbell on the knees, not the body, is the load: it rests through the heels until they lift, then acts through the ball of the foot, and the calf is shortest and weakest at the top. With the knees bent near 90 degrees, as a seated raise is normally done, the soleus does most of the work because the gastrocnemius is slack; the demo currently draws the legs nearly straight.',
  },
  // Standing under the machine's shoulder pads, feet flat, heels down -> Up on the balls of the feet, heels lifted (ankles about 30 degrees past flat), pads pushed up
  'machine-calf-raise': {
    profile: [0.65, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'calves', role: 'main', peak: 1, note: 'lift the heels' },
    ],
    why: 'The pads load the shoulders and the load passes straight down the stacked joints to the heels until they lift; from then on it acts through the ball of the foot, and the top is the hardest because the calves are shortest and weakest there.',
  },
  // Lying on a flat bench, barbell held at arm's length straight above the shoulders, elbows straight. -> Bar lowered to touch the upper chest, elbows bent and level with the shoulders.
  'bench-press': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'lowers the bar under control, then drives the arms up and in' },
      { group: 'triceps', role: 'assist', peak: 0.65, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
      { group: 'shoulders', role: 'assist', peak: 0.6, note: 'front of the shoulder helps lift the arms' },
    ],
    why: 'Locked out, the bar sits over straight arms stacked on the shoulders, so little effort is needed; as it lowers, its moment arm about the shoulders grows and the chest stretches, so the bottom and the first few centimetres off the chest are hardest (the sticking region, Elliott et al. 1989). The elbow moment builds earlier in the descent than the shoulder moment, so the triceps are drawn working hard from the middle down while the chest peaks at the bottom.',
  },
  // Lying on a bench inclined about 30 degrees, barbell held at arm's length straight above the shoulders. -> Bar lowered to touch the upper chest below the collarbones, elbows bent to about shoulder level.
  'incline-bench-press': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'upper chest drives the arms up and in' },
      { group: 'shoulders', role: 'main', peak: 0.9, note: 'front of the shoulder lifts the arms forward and up' },
      { group: 'triceps', role: 'assist', peak: 0.6, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
    ],
    why: 'Same curve as the flat press: little effort with the bar over straight arms, most at and just off the chest, where the bar\'s moment arm about the shoulders is longest. The incline turns the press toward raising the arms forward and overhead, so the front deltoids work almost as hard as the upper (clavicular) chest.',
  },
  // Lying on a flat bench, dumbbells held at arm's length straight above the shoulders. -> Dumbbells lowered to the sides of the chest, elbows bent and level with the shoulders.
  'dumbbell-bench-press': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'lowers the dumbbells under control, then drives the arms up and in' },
      { group: 'triceps', role: 'assist', peak: 0.55, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
      { group: 'shoulders', role: 'assist', peak: 0.6, note: 'front of the shoulder helps lift and steady each arm' },
    ],
    why: 'As with the barbell, the dumbbells are easiest to hold over straight arms and hardest at the bottom, where they sit furthest out from the shoulder joints and the chest is stretched. Each arm balances its own dumbbell, so the shoulders also steady the load, and the free hand path asks a little less of the triceps than a fixed bar.',
  },
  // Lying on a bench inclined about 30 degrees, dumbbells held at arm's length straight above the shoulders. -> Dumbbells lowered to the sides of the upper chest, elbows bent to about shoulder level.
  'incline-dumbbell-press': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'upper chest drives the arms up and in' },
      { group: 'shoulders', role: 'main', peak: 0.9, note: 'front of the shoulder lifts the arms forward and up' },
      { group: 'triceps', role: 'assist', peak: 0.55, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
    ],
    why: 'Same mechanics as the incline barbell press: least effort with the dumbbells over straight arms, most at the bottom, where they are furthest from the shoulder joints and the chest is stretched. The incline turns the press toward raising the arms forward and up, so the front deltoids share the work with the upper chest.',
  },
  // Lying on the floor with knees bent and feet flat, dumbbells held at arm's length straight above the shoulders. -> Dumbbells lowered over the chest, elbows bent, upper arms angled down toward the floor (as drawn they stop a little short of it).
  'dumbbell-floor-press': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'drives the arms up and in' },
      { group: 'triceps', role: 'assist', peak: 0.7, profile: [0.3, 0.85, 1], note: 'straighten the elbows; a bigger share than in a bench press' },
    ],
    why: 'The floor stops the upper arms at about the point where a bench press sticks, so the press is hardest from the bottom, with no deeper stretch to help, and easiest locked out over the shoulders. Cutting off the deepest, most chest-dominant part of the range leaves the triceps a larger share of the work.',
  },
  // Straight-arm plank on the toes, hands under the shoulders, body straight from head to heels. -> Chest lowered to just above the floor, elbows bent back alongside the body, body still straight.
  'push-up': {
    profile: [0.3, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'lowers the body under control, then pushes it away from the floor' },
      { group: 'triceps', role: 'assist', peak: 0.65, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
      { group: 'shoulders', role: 'assist', peak: 0.55, note: 'front of the shoulder helps push' },
      { group: 'core', role: 'stabilize', peak: 0.45, note: 'keeps the body straight like a plank' },
    ],
    why: 'The hands carry about two thirds of body weight through the whole rep (about 64% in Ebben et al. 2011). With straight arms that load runs through joints stacked under the shoulders, while lowering stretches the chest and lengthens the moment arms at the shoulders and elbows, so the bottom is hardest, as in a bench press; the abdominals hold the body straight against sagging throughout.',
  },
  // Hands on a bench, arms straight, body straight from head to heels at about 45 degrees to the floor. -> Chest lowered to the bench, elbows bent, body still straight at about 25 degrees to the floor.
  'incline-push-up': {
    profile: [0.3, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'lowers the body, then pushes it away from the bench' },
      { group: 'triceps', role: 'assist', peak: 0.6, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
      { group: 'shoulders', role: 'assist', peak: 0.55, note: 'front of the shoulder helps push' },
    ],
    why: 'Raising the hands puts less of the body weight on them than a floor push-up (Ebben et al. 2011), but the shape of the effort is the same: least with straight arms under the shoulders, most at the bottom with the chest at the bench, where the chest is stretched and the shoulder and elbow moments are longest.',
  },
  // Kneeling with the lower legs on the floor, arms straight and hands under the shoulders, body straight from knees to head. -> Chest lowered to just above the floor, elbows bent back, body still straight from the knees.
  'knee-push-up': {
    profile: [0.3, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'lowers the body, then pushes it away from the floor' },
      { group: 'triceps', role: 'assist', peak: 0.6, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
    ],
    why: 'Pivoting on the knees puts about half of body weight on the hands instead of about two thirds (Ebben et al. 2011), but the curve is the full push-up\'s: easiest with straight arms stacked under the shoulders, hardest with the chest near the floor.',
  },
  // Supported on parallel bars with arms almost straight, shoulders over the hands, torso leaning slightly forward, knees bent. -> Shoulders lowered to about a forearm's length above the bars, elbows bent sharply, torso leaning about 25 degrees forward (as drawn the shoulders end behind the hands and the elbows dip below the bars).
  'dip': {
    profile: [0.35, 0.65, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'lower chest pulls the arms down and forward to lift the body' },
      { group: 'triceps', role: 'main', peak: 0.95, profile: [0.35, 0.85, 1], note: 'straighten the elbows' },
      { group: 'shoulders', role: 'assist', peak: 0.6, note: 'front of the shoulder helps drive the arms forward' },
    ],
    why: 'The arms carry the whole body weight. At the top it runs straight down through locked arms under the shoulders, so little effort is needed; lowering, the shoulders travel forward of the hands and the elbows bend behind them, so the moment arms grow and the bottom, with the chest and front of the shoulders stretched, is hardest. The elbow moment builds earliest, and the forward lean shifts work toward the chest.',
  },
  // Lying on a flat bench, dumbbells held at arm's length above the shoulders, elbows slightly bent. -> Arms opened wide out to the sides with the same slight elbow bend, dumbbells lowered to about chest height (from the side the arms look short as they point toward the camera).
  'dumbbell-fly': {
    profile: [0.2, 0.7, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'stretches as the arms open, then hugs them back together' },
    ],
    why: 'With the dumbbells over the shoulders the arms hold them with almost no moment arm; as the arms open, the dumbbells move out to the sides and the moment arm about the shoulders grows to its maximum at the bottom, where the chest is also longest. The fly is therefore hardest at the bottom and loses almost all tension at the top.',
  },
  // Hinged forward about 70 degrees with soft knees, barbell hanging at nearly straight arms below the shoulders -> Bar pulled in to the belly at about navel height (the summary says lower ribs), elbows bent and raised above the back, torso still hinged about 70 degrees
  'barbell-row': {
    profile: [0.4, 0.65, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbows back and squeezes the shoulder blades; the lower back holds the hinge' },
      { group: 'biceps', role: 'assist', peak: 0.55, profile: [0.2, 1, 0.6], note: 'bend the elbows, most mid-pull' },
      { group: 'hamstrings', role: 'stabilize', peak: 0.45, profile: [1, 0.8, 0.55], note: 'hold the hips in the hinge' },
    ],
    why: 'Hanging straight below the shoulders the bar has almost no lever about the shoulder, so the upper back mainly holds the shoulder blades while the lower back and hamstrings hold the hinge; as the elbows travel past the torso the bar\'s lever about the shoulder grows to its longest at the top, where the lats, rhomboids and trapezius are also shortest, so the top is hardest. The elbow flexors work most mid-pull, when the forearm slants furthest from vertical, and the hinge gets a little easier to hold as the bar comes in toward the hips (with a bar of about 0.6 body weight the hip moment falls to about 0.55 of the start in the demo).',
  },
  // Torso nearly level (about 80 degrees forward) with one hand and knee on a bench, dumbbell hanging at a nearly straight arm below the shoulder -> Dumbbell pulled up beside the hip, elbow bent and raised above the back
  'one-arm-dumbbell-row': {
    profile: [0.3, 0.6, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbow back and squeezes the shoulder blade in' },
      { group: 'biceps', role: 'assist', peak: 0.55, profile: [0.2, 1, 0.6], note: 'bends the elbow, most mid-pull' },
    ],
    why: 'The bench props the torso, so at the hang the back only holds the shoulder blade against a dumbbell that hangs with almost no lever about the shoulder; the lever grows as the elbow travels back and is longest at the top, where the lats and mid-back are shortest, so that is the hardest point. The elbow flexors work most mid-pull, when the forearm slants furthest from vertical, and less at the top, where the forearm hangs almost under the elbow.',
  },
  // Hinged forward about 58 degrees with soft knees, a dumbbell in each hand hanging at nearly straight arms below the shoulders -> Dumbbells pulled up to the sides of the waist, elbows bent and drawn back past the torso
  'dumbbell-bent-over-row': {
    profile: [0.4, 0.65, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbows back and squeezes the shoulder blades; the lower back holds the hinge' },
      { group: 'biceps', role: 'assist', peak: 0.55, profile: [0.2, 1, 0.6], note: 'bend the elbows, most mid-pull' },
    ],
    why: 'Same mechanics as the barbell row: little lever about the shoulder at the hang, where the lower back already works to hold the unsupported hinge, and the longest lever at the top, where the upper back is shortest. The elbow flexors work most mid-pull, when the forearms slant furthest from vertical.',
  },
  // Chest on an incline bench, torso about 50 degrees forward, dumbbells hanging at nearly straight arms below the shoulders -> Dumbbells pulled up beside the waist, elbows bent and drawn back past the torso
  'chest-supported-dumbbell-row': {
    profile: [0.3, 0.6, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbows back and squeezes the shoulder blades' },
      { group: 'biceps', role: 'assist', peak: 0.55, profile: [0.2, 1, 0.6], note: 'bend the elbows, most mid-pull' },
    ],
    why: 'The pad carries the torso, so the lower back is off and at the hang the upper back only holds the shoulder blades; the dumbbells\' lever about the shoulder grows as the elbows travel back and is longest at the top, where the lats, rhomboids and trapezius are shortest. The elbow flexors work most mid-pull.',
  },
  // Dead hang from an overhand grip, arms nearly straight overhead, body vertical -> Chin over the bar, elbows fully bent, shoulders just below and behind the bar, body leaning back about 18 degrees
  'pull-up': {
    profile: [0.3, 0.8, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbows down and the shoulder blades down and back' },
      { group: 'biceps', role: 'assist', peak: 0.65, profile: [0.1, 1, 0.7], note: 'bend the elbows' },
      { group: 'core', role: 'stabilize', peak: 0.35, note: 'keeps the body still, no swinging' },
    ],
    why: 'In a dead hang the straight arms are in line with the bar\'s pull, so the shoulder joints and shoulder-blade muscles hold the body while the elbow flexors are nearly idle; once the pull starts the lats and mid-back lift the whole body, and they are shortest and weakest at the top, so getting the chin over the bar is the hardest part. The elbow flexors carry most where the forearms slant most, around mid-pull; with the wider overhand grip the forearms come closer to vertical at the top.',
  },
  // Dead hang from an underhand, shoulder-width grip, arms nearly straight overhead, body vertical -> Chin over the bar, elbows fully bent in front of the body, shoulders just below and behind the bar, body leaning back about 18 degrees
  'chin-up': {
    profile: [0.3, 0.8, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbows down and the shoulder blades down and back' },
      { group: 'biceps', role: 'main', peak: 0.95, profile: [0.1, 0.9, 1], note: 'bend the elbows; the underhand grip gives them more of the work' },
    ],
    why: 'Same curve as the pull-up: nearly passive in the dead hang, then the whole body weight on muscles that are shortest at the top, the hardest point. With the underhand, narrower grip the elbows bend in front of the body and the forearms still slant at the top, so the elbow flexors work hard all the way to the chin-over-bar finish.',
  },
  // Holding the top of a pull-up: chin over the bar, elbows fully bent, body leaning back slightly -> Dead hang, arms nearly straight overhead, body vertical
  'negative-pull-up': {
    profile: [1, 0.8, 0.3],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'lengthens under load to lower the body slowly' },
      { group: 'biceps', role: 'assist', peak: 0.65, profile: [0.7, 1, 0.1], note: 'let the elbows straighten slowly' },
    ],
    why: 'The pull-up played from the top: holding the chin over the bar, with the lats and mid-back at their shortest, is the hardest point, and effort falls as the body lowers to a dead hang, where the straight arms carry it with little muscle work. In practice the lifter steps or jumps back to the top, so the return half of the loop (drawn as lifting) overstates the work.',
  },
  // Dead hang, arms straight overhead, shoulders shrugged up toward the ears -> Shoulder blades pulled down so the body rises (about 10 cm in the demo) and the chest lifts slightly; the demo also bends the elbows to about 107 degrees, which the real exercise does not
  'scapular-pull-up': {
    profile: [0.3, 0.8, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the shoulder blades down to lift the body' },
    ],
    why: 'In a dead hang the shoulder girdle hangs on passive structures; pulling the shoulder blades down lifts the whole body on the lower trapezius and lats, a near-constant load that gets harder as these muscles shorten, so the fully pulled-down position is hardest.',
  },
  // Hanging under a bar at about hip height with the arms extended, heels on the floor, body straight and about 10 degrees above horizontal -> Chest pulled up close to the bar with the elbows sharply bent, body straight and about 26 degrees above horizontal (demo glitch: at exactly s = 1 the elbow flips to the head side of the bar)
  'inverted-row': {
    profile: [0.3, 0.6, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbows back and squeezes the shoulder blades' },
      { group: 'biceps', role: 'assist', peak: 0.55, profile: [0.2, 1, 0.6], note: 'bend the elbows, most mid-pull' },
      { group: 'core', role: 'stabilize', peak: 0.3, note: 'keeps the body in one line from heels to shoulders' },
    ],
    why: 'A row with the heels on the floor: at the bottom the straight arms hang in line with the bar, so the back only holds the shoulder blades, and the top, with the elbows back and the back muscles shortest, is hardest; as the body rises a little more of its weight shifts to the heels (about 78% to 72% of body weight on the bar in the demo), which only slightly flattens that rise. In the demo the elbows stay in front of the chest through the pull, whereas a real inverted row finishes with them beside the torso.',
  },
  // Seated with the thighs under the pad, leaning back about 14 degrees, arms straight overhead holding the bar, weight stack lifted -> Bar pulled down in front of the face to about chin height, elbows bent and pointing down (the summary says upper chest; the demo stops a little short)
  'lat-pulldown': {
    profile: [0.3, 0.8, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbows down and the shoulder blades down and back' },
      { group: 'biceps', role: 'assist', peak: 0.6, profile: [0.1, 1, 0.7], note: 'bend the elbows' },
    ],
    why: 'A seated pull-up: with straight arms overhead the cable pulls in line with the arms and the back mainly holds the shoulder blades; the cable\'s lever about the shoulder grows as the bar comes down and is longest at the bottom, where the lats are shortest, so bringing the bar all the way down is the hardest part. The elbow flexors work most mid-pull, when the forearms slant most, and less at the bottom, where they are nearly vertical under the bar.',
  },
  // Standing, leaning forward about 18 degrees, straight arms raised up and forward above head height holding the cable bar -> Straight arms swept down so the bar is at the front of the thighs
  'straight-arm-pulldown': {
    profile: [0.3, 1, 0.8],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'sweeps the straight arms down to the thighs' },
    ],
    why: 'With a high pulley the cable starts nearly in line with the raised arms, so its lever about the shoulder is short; the lever is longest around mid-sweep, where the arms cross the cable at about a right angle, and eases toward the thighs, where the lats are shortest, so effort stays high to the finish. In the current demo the pulley is drawn almost level with the hands and far in front, so at the start the cable would pull the arms down rather than resist them; a pulley above head height and closer to the lifter fixes that.',
  },
  // On a 45-degree bench with the ankles under the pad, body in one straight line, arms folded on the chest -> Torso lowered to hang nearly straight down over the pad (hips flexed to about 110 degrees), back still straight
  'back-extension': {
    profile: [0.8, 1, 0.35],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'keeps the spine straight against the torso\'s weight' },
      { group: 'glutes', role: 'assist', peak: 0.65, note: 'extend the hip' },
      { group: 'hamstrings', role: 'assist', peak: 0.6, note: 'extend the hip' },
    ],
    why: 'The torso\'s weight has its longest moment arm about the hips and lower back when the torso is horizontal, which comes partway through the range on a 45-degree bench; it is a little less with the body straight at the top and much less hanging at the bottom (static estimate about 0.8, 1.0, 0.35).',
  },
  // Standing tall, bar resting on the front of the shoulders at collarbone height, elbows down and in front of the bar. -> Bar pressed to straight arms overhead, over the shoulders and mid-foot.
  'overhead-press': {
    profile: [1, 0.8, 0.3],
    restAtStart: true,
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'press the arms up overhead' },
      { group: 'triceps', role: 'assist', peak: 0.65, profile: [0.5, 1, 0.3], note: 'straighten the elbows, most as the bar passes the head' },
      { group: 'core', role: 'stabilize', peak: 0.4, note: 'braces so the lower back doesn\'t arch under the bar' },
    ],
    why: 'Between reps the bar rests on the collarbones and front of the shoulders (NSCA: lower it to touch them), so the arms are nearly off until it leaves. Just off the shoulders the bar is furthest in front of the shoulder joints, so the press is hardest from there past the face; locked out overhead the load runs down straight, stacked arms. The elbows straighten mostly in the upper half, where the triceps take over.',
  },
  // Standing tall, bar resting on the front of the shoulders at collarbone height. -> Bar locked out overhead on straight arms, legs straight; the short knee dip and drive happen in the first third of the lift.
  'push-press': {
    profile: [0.45, 1, 0.3],
    restAtStart: true,
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'press the bar the rest of the way overhead' },
      { group: 'triceps', role: 'assist', peak: 0.65, profile: [0.5, 1, 0.3], note: 'straighten the elbows to lock out' },
      { group: 'quads', role: 'assist', peak: 0.65, profile: [1, 0.25, 0.2], note: 'dip and drive the bar off the shoulders' },
    ],
    why: 'The bar rests on the shoulders while the knees dip; the quads then drive up and launch it, so the legs work hardest early while the arms carry little. The shoulders and triceps take over as the bar passes the head and must press out the rest, which is where the arms work hardest; locked out overhead the load runs down straight, stacked arms.',
  },
  // Standing tall, dumbbells held at shoulder height, elbows bent below them. -> Dumbbells pressed to straight arms overhead, over the shoulders.
  'dumbbell-shoulder-press': {
    profile: [1, 0.8, 0.3],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'press the arms up overhead' },
      { group: 'triceps', role: 'assist', peak: 0.6, profile: [0.5, 1, 0.3], note: 'straighten the elbows, most as the dumbbells pass the head' },
    ],
    why: 'Held at shoulder height with the upper arms out to the sides, the dumbbells sit furthest from the shoulder joints, so the bottom is the hardest position; pressing brings them in over the shoulders until, locked out, the load runs down straight arms. The elbows straighten mostly in the upper half, where the triceps do most of their work.',
  },
  // Standing tall, dumbbells held in front of the shoulders at chin height, elbows bent and in front, palms toward the face (the turn of the arms doesn't show from the side). -> Dumbbells pressed to straight arms overhead, palms turned forward.
  'arnold-press': {
    profile: [1, 0.8, 0.3],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'turn the arms out to the sides while pressing them overhead' },
      { group: 'triceps', role: 'assist', peak: 0.55, profile: [0.5, 1, 0.3], note: 'straighten the elbows' },
    ],
    why: 'The press starts with the elbows in front and the palms facing in, then turns the arms out to the sides while pressing, so the front and side of the shoulder share the work through the whole range. The effort curve is the dumbbell press\'s: hardest at the bottom, where the dumbbells are furthest from the shoulder joints, easiest locked out overhead.',
  },
  // Seated against the back pad, handles at shoulder height, elbows bent, weight stack resting. -> Handles pressed to straight arms overhead.
  'machine-shoulder-press': {
    profile: [1, 0.8, 0.3],
    restAtStart: true,
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'press the arms up overhead' },
      { group: 'triceps', role: 'assist', peak: 0.6, profile: [0.5, 1, 0.3], note: 'straighten the elbows' },
    ],
    why: 'The weight stack rests while the handles sit at shoulder height, so the muscles are off until it lifts; from there the press follows the dumbbell press: hardest just off the bottom, where the handles are furthest from the shoulder joints, easing to lockout overhead. The seat and back pad hold the trunk, so it needs little bracing.',
  },
  // Inverted V: hands and toes on the floor, hips high and bent to about a right angle, arms and legs straight. -> Head lowered to touch the floor with the elbows bent, hips still high (as drawn the head lands behind the hands and the forearms end flat on the floor).
  'pike-push-up': {
    profile: [0.5, 0.75, 1],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'press the body up, arms overhead relative to the trunk' },
      { group: 'triceps', role: 'assist', peak: 0.65, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
    ],
    why: 'With the hips piked high the hands carry about half the body weight or more, pressing in a direction close to overhead. Even at the top the arms lean forward of the shoulders, so the shoulders are already working; as the head lowers the elbows bend and the moment arms at the shoulders and elbows grow, so the bottom is hardest.',
  },
  // Handstand facing the wall with the toes against it, arms straight, body vertical. -> Head lowered to touch the floor, elbows bent past a right angle, body still upright by the wall.
  'handstand-push-up': {
    profile: [0.35, 0.7, 1],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'press the whole body up overhead' },
      { group: 'triceps', role: 'assist', peak: 0.7, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
      { group: 'core', role: 'stabilize', peak: 0.4, note: 'keeps the body straight and the lower back from arching' },
    ],
    why: 'Upside down the arms carry the whole body weight; locked out it runs straight through stacked joints, but as the head lowers the shoulders move off the line over the hands and the elbows bend, so the moment arms grow and the bottom, head at the floor, is hardest. The elbow moment builds earliest, and the trunk braces to keep the body straight.',
  },
  // Standing tall facing the camera, dumbbells hanging at the sides, arms straight. -> Both arms raised out to the sides to shoulder height, elbows almost straight.
  'lateral-raise': {
    profile: [0.2, 0.65, 1],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'side of the shoulder lifts the arms out to the sides' },
    ],
    why: 'Hanging at the sides the dumbbells have almost no moment arm about the shoulders; as the arms rise it grows to its maximum with the arms level at shoulder height, where the shoulder\'s lifting strength is also lower, so the top is hardest.',
  },
  // Standing tall facing the camera, working arm hanging at the side holding a handle from a low pulley on the other side, cable crossing the body. -> Working arm raised out to the side to shoulder height, cable running down across the body to the pulley.
  'cable-lateral-raise': {
    profile: [0.7, 1, 0.9],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'side of the shoulder lifts the arm out against the cable' },
    ],
    why: 'The cable pulls from a low pulley on the other side, so its moment arm about the shoulder is already about three quarters of its maximum with the arm down, peaks with the arm about halfway up and stays high to shoulder height. Unlike the dumbbell raise there is clear tension at the bottom and the effort is spread fairly evenly through the range.',
  },
  // Standing tall side-on, dumbbells hanging in front of the thighs, arms straight. -> Arms raised straight in front to shoulder height.
  'front-raise': {
    profile: [0.2, 0.65, 1],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'front of the shoulder lifts the arms forward' },
    ],
    why: 'The same lever as the lateral raise, in front of the body: hanging, the dumbbells have almost no moment arm about the shoulders, and it grows to its maximum with the arms level at shoulder height, where the shoulder\'s lifting strength is also lower, so the top is hardest.',
  },
  // Facing the camera, hinged forward about 65 degrees with a flat back and soft knees, dumbbells hanging straight down under the shoulders. -> Arms raised out to the sides until level with the shoulders, elbows almost straight.
  'rear-delt-fly': {
    profile: [0.2, 0.65, 1],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'rear of the shoulder sweeps the arms out and back' },
      { group: 'back', role: 'assist', peak: 0.6, profile: [0.45, 0.7, 1], note: 'squeezes the shoulder blades together; the lower back holds the hinge' },
    ],
    why: 'Bent over, the dumbbells hang straight down under the shoulders with almost no moment arm; raising them out to the sides moves them away from the shoulder joints until, level with the shoulders, the moment arm is longest and the rear deltoid shortest, so the top is hardest. The middle trapezius and rhomboids pull the shoulder blades together as the arms open, and the lower back holds the hinged trunk still from the start.',
  },
  // Standing tall side-on, arms hanging straight, barbell held at arm's length in front of the thighs with an underhand grip. -> Elbows fully bent with the upper arms still at the sides, bar curled up to just in front of the shoulders, forearms still tilted about 30 degrees forward of vertical.
  'barbell-curl': {
    profile: [0.2, 1, 0.8],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bend the elbows' },
    ],
    why: 'With the arms hanging, the bar sits almost straight below the elbows, so the elbow flexors barely work; the bar\'s lever about the elbows grows to its longest as the forearms pass horizontal, the hardest point. By the top the lever has roughly halved, but with the elbows kept at the sides the fully shortened flexors are much weaker there, so the top stays fairly hard.',
  },
  // Standing tall side-on, arms hanging straight, EZ bar held at arm's length in front of the thighs on its angled grips. -> Elbows fully bent with the upper arms still at the sides, bar curled up to just in front of the shoulders, forearms still tilted about 30 degrees forward of vertical.
  'ez-bar-curl': {
    profile: [0.2, 1, 0.8],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bend the elbows' },
    ],
    why: 'Same lever as the barbell curl: almost no load on the elbow flexors with the arms hanging, hardest as the forearms pass horizontal, and still fairly hard at the top, where the lever has halved but the shortened flexors are weak. The angled grip turns the forearms slightly toward palms-in, which shares a little more of the work with the brachialis and the forearm\'s brachioradialis without changing the curve.',
  },
  // Standing tall side-on, arms hanging straight at the sides, a dumbbell in each hand, palms forward. -> Elbows fully bent with the upper arms still at the sides, dumbbells curled up to just in front of the shoulders, forearms still tilted about 30 degrees forward of vertical.
  'dumbbell-curl': {
    profile: [0.2, 1, 0.8],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bend the elbows' },
    ],
    why: 'Hanging at the sides, the dumbbells sit almost straight below the elbows, so the elbow flexors barely work; their lever about the elbows is longest as the forearms pass horizontal, the hardest point. Near the top the lever roughly halves, but with the elbows kept at the sides the shortened flexors are much weaker there, so the top stays fairly hard.',
  },
  // Standing tall side-on, arms hanging straight at the sides, a dumbbell in each hand, palms facing in. -> Elbows fully bent with the upper arms still at the sides, dumbbells curled up to just in front of the shoulders with the thumbs up, forearms still tilted about 30 degrees forward of vertical.
  'hammer-curl': {
    profile: [0.2, 1, 0.8],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bend the elbows; the forearm\'s brachioradialis helps more with this grip' },
    ],
    why: 'Same lever as the dumbbell curl, so the same curve: barely any load with the arms hanging, hardest as the forearms pass horizontal, still fairly hard at the top with the elbows kept still. The palms-in grip gives the brachialis and the forearm\'s brachioradialis a bigger share of the work than a palms-up curl, which lowers the biceps\' own share a little but not the timing.',
  },
  // Lying back on a bench reclined about 40 degrees from upright, arms hanging straight down from the shoulders behind the line of the torso, a dumbbell in each hand. -> Elbows bent about 145 degrees with the upper arms still hanging, dumbbells curled up to just in front of the shoulders, forearms still about 40 degrees short of vertical.
  'incline-dumbbell-curl': {
    profile: [0.2, 1, 0.95],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bend the elbows from a full stretch' },
    ],
    why: 'The upper arms hang straight down behind the torso, so the dumbbells load the elbows as in a standing curl: no lever at the start, where the biceps is at full stretch with the shoulders extended, and the longest lever with the forearms horizontal. The demo stops with the forearms still about 40 degrees short of vertical, so the dumbbells keep most of their lever and the top stays almost as hard as the middle.',
  },
  // Seated on a bench leaning forward, upper arm braced against the inner thigh and hanging almost straight down, arm straight, dumbbell at arm's length between the knees. -> Elbow fully bent (about 150 degrees), dumbbell curled up to shoulder height just in front of the shoulder, forearm nearly vertical.
  'concentration-curl': {
    profile: [0.2, 1, 0.6],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bends the elbow' },
    ],
    why: 'With the upper arm braced on the thigh and hanging almost straight down, the dumbbell has no lever about the elbow at the start and its longest lever as the forearm passes horizontal, the hardest point. At the top the forearm is nearly vertical, so the lever falls to about a third; the fully shortened flexors are weak there, so the top is easier than the middle but not a rest.',
  },
  // Standing tall side-on facing a low pulley well out in front, arms hanging straight holding the cable bar, cable slanting forward and down to the pulley. -> Elbows fully bent with the upper arms still at the sides, bar curled up to just in front of the shoulders, cable running down at a slant to the pulley.
  'cable-curl': {
    profile: [0.1, 0.6, 1],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bend the elbows against the cable' },
    ],
    why: 'The low pulley is drawn well out in front (about 0.45 of body height), so with the arms hanging the cable pulls the hands forward and the elbow flexors carry nothing until the forearms have swung about 40 degrees forward. From there the cable\'s lever keeps growing and stays long at the top instead of fading like a dumbbell\'s, so the top, where the flexors are shortest, is hardest. With the pulley closer to the feet the middle gets harder (about 0.75) and the top stays hardest.',
  },
  // Standing tall side-on on the middle of the band, arms hanging straight at the sides holding the handles, band only slightly stretched. -> Elbows fully bent with the upper arms still at the sides, handles curled up to just in front of the shoulders, band stretched to nearly twice its starting length.
  'band-curl': {
    profile: [0.1, 0.7, 1],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bend the elbows; the band pulls harder as it stretches' },
    ],
    why: 'At the start the band runs almost along the forearms and is barely stretched, so there is next to no load. As the hands rise the band stretches to nearly twice its length and pulls harder, while its lever about the elbows is longest around horizontal; with the flexors shortened and weaker near the top, the top third is the hardest part.',
  },
  // Lying on a flat bench, barbell held with a shoulder-width grip at arm's length straight above the shoulders. -> Bar lowered to the lower chest, elbows bent and tucked close to the sides.
  'close-grip-bench-press': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, profile: [0.3, 0.85, 1], note: 'straighten the elbows from a deep bend' },
      { group: 'chest', role: 'main', peak: 0.9, note: 'drives the arms up from the chest' },
      { group: 'shoulders', role: 'assist', peak: 0.6, note: 'front of the shoulder lifts the tucked arms' },
    ],
    why: 'As in any bench press the bar is easiest to hold over straight arms and hardest at and just off the chest. The narrow grip and tucked elbows bend the elbows further and lengthen the elbow moment, so the triceps become a main mover and work hard from the middle of the range down, while the chest peaks at the bottom.',
  },
  // Hands on the edge of a bench behind the hips, arms straight, legs straight out in front with the heels toward the floor (as drawn they hover just above it at the top). -> Hips lowered below the bench top just in front of it, elbows bent past a right angle and pointing back, heels reaching the floor.
  'bench-dip': {
    profile: [0.3, 0.85, 1],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, note: 'straighten the elbows to lift the body' },
    ],
    why: 'The hands carry most of the body weight and the heels the rest. With straight arms it passes through stacked joints, but as the hips lower the elbows bend behind the hands and the elbow moment arm grows quickly, so the effort climbs steeply through the first half and is greatest at the bottom.',
  },
  // Straight-arm plank on the toes with the hands together under the chest, body straight from head to heels. -> Chest lowered to just above the hands, elbows bent back alongside the body, body still straight.
  'diamond-push-up': {
    profile: [0.3, 0.85, 1],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, note: 'straighten the elbows; the narrow hands make them lead' },
      { group: 'chest', role: 'assist', peak: 0.65, profile: [0.3, 0.6, 1], note: 'helps push the body away from the floor' },
    ],
    why: 'The hands carry about two thirds of body weight, as in a standard push-up, but with them together under the chest the elbows bend further and sit further behind the hands, so the elbow moment is larger and builds early in the descent: the triceps lead and are hardest pressed at the bottom. The chest helps most at the bottom, where it is stretched.',
  },
  // Standing tall side-on, both hands holding one dumbbell straight overhead, upper arms vertical beside the head, elbows straight. -> Upper arms still vertical, elbows fully bent, dumbbell lowered behind the neck to about shoulder height.
  'overhead-dumbbell-extension': {
    profile: [0.2, 1, 0.6],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, note: 'straighten the elbows; the long head works from a full stretch' },
    ],
    why: 'Straight overhead, the dumbbell sits on top of the forearms, so the triceps do little; its lever about the elbows is longest as the forearms pass horizontal behind the head, the hardest point, and at the deep bottom it hangs almost straight below the elbows, so the lever falls to under half even though the long head is at full stretch. In the current demo, fore lerp(2, 205) swings the forearm forward over the face; bending it back behind the head needs lerp(2, -155).',
  },
  // Lying on a flat bench, EZ bar held at arm's length above the chin, upper arms tilted slightly toward the head. -> Elbows bent to a right angle with the upper arms still, bar lowered to just past the top of the head.
  'skull-crusher': {
    profile: [0.2, 0.85, 1],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, note: 'straighten the elbows; the long head also holds the upper arms still' },
    ],
    why: 'With straight arms the bar sits almost over the elbows, so the triceps do little. As the forearms lower toward horizontal the bar\'s moment arm about the elbows grows quickly, to about 80% of its maximum by halfway, and peaks with the elbows bent to a right angle at the bottom, the hardest position.',
  },
  // Standing close to a high pulley, torso leaning slightly forward, upper arms at the sides, elbows bent about 115 degrees with the bar at lower-chest height. -> Elbows straight, bar pushed down to the front of the thighs, upper arms still at the sides.
  'triceps-pushdown': {
    profile: [0.85, 1, 0.6],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, note: 'straighten the elbows' },
    ],
    why: 'The cable from the high pulley runs nearly vertically, so its lever about the elbows is longest with the forearms around horizontal, just after the start: the triceps work hard from the first moment and hardest through the first half. At lockout the cable runs close to the forearms (still pulling them slightly forward), so the lever drops to about a third, but the fully shortened triceps are weaker there, so the finish stays moderately hard.',
  },
  // Hinged forward with the torso about 20 degrees above level and knees slightly bent, upper arm held back along the side of the torso, forearm hanging straight down holding the dumbbell. -> Elbow straightened, forearm in line with the upper arm, dumbbell extended back to just behind the hip.
  'triceps-kickback': {
    profile: [0.2, 0.45, 1],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, note: 'straightens the elbow; the long head also holds the upper arm back' },
    ],
    why: 'With the forearm hanging, the dumbbell is straight below the elbow, so the triceps carry almost nothing (the long head only helps hold the upper arm back). As the forearm swings back its lever about the elbow grows and is longest at lockout, with the arm straight and nearly level, exactly where the triceps are shortest and weakest, so lockout is by far the hardest point.',
  },
  // Standing under a band anchored overhead and a little in front, torso leaning slightly forward, upper arms at the sides, elbows bent about 115 degrees with the hands at lower-chest height, band barely stretched. -> Elbows straight, hands pushed down to the front of the thighs, band at its longest.
  'band-pushdown': {
    profile: [0.2, 1, 0.9],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, note: 'straighten the elbows; the band pulls harder as it stretches' },
    ],
    why: 'At the start the band is barely stretched, so although its lever about the elbows is long the load is small; it pulls harder as it stretches, so effort builds through the push and is highest in the last third. At lockout the band runs close to the forearms, so its lever shrinks and the final few degrees ease slightly even though the band pulls hardest there.',
  },
  // Forearm plank: elbows under the shoulders, body straight from shoulders to ankles, about 12 degrees above horizontal -> Same position (a hold)
  'plank': {
    profile: [1, 1, 1],
    muscles: [
      { group: 'core', role: 'main', peak: 1, note: 'stops the hips sagging and the lower back arching' },
    ],
    why: 'A hold: gravity pulls the middle of the body toward the floor between the forearms and toes, so the abdominals and obliques work isometrically to keep the spine and pelvis from sagging into an arch; the demand is steady while the position holds.',
  },
  // Side plank on one forearm and the side of the feet, body straight and about 18 degrees above the floor, top arm resting along the body -> Same position (a hold)
  'side-plank': {
    profile: [1, 1, 1],
    muscles: [
      { group: 'core', role: 'main', peak: 1, note: 'the lower-side obliques keep the hips lifted' },
      { group: 'glutes', role: 'stabilize', peak: 0.5, note: 'the bottom hip\'s glute medius holds the pelvis up in line' },
    ],
    why: 'A hold: gravity bends the body sideways toward the floor between the forearm and the feet, so the obliques and deep trunk muscles of the lower side work isometrically, and the gluteus medius of the bottom hip keeps the pelvis from dropping out of line.',
  },
  // Lying on the back with the shoulders and straight legs raised off the floor, arms reaching overhead, lower back pressed down -> Same position (a hold)
  'hollow-body-hold': {
    profile: [1, 1, 1],
    muscles: [
      { group: 'core', role: 'main', peak: 1, note: 'keeps the lower back pressed down against the lifted legs' },
    ],
    why: 'A hold: the raised straight legs pull the pelvis toward an arch through the hip flexors, and the raised shoulders and arms lean back on the upper trunk, so the abdominals work isometrically from both ends to keep the lower back on the floor; the demand is steady while the position holds.',
  },
  // Lying on the back, hips and knees bent 90 degrees with the shins level (tabletop), both arms pointing straight up -> One leg straightened out nearly level just above the floor and one arm reaching back overhead, the other limbs still in place (the demo moves the near arm and near leg; the exercise pairs opposite limbs)
  'dead-bug': {
    profile: [0.4, 0.8, 1],
    muscles: [
      { group: 'core', role: 'main', peak: 1, note: 'keeps the lower back flat as the leg reaches out' },
    ],
    why: 'In the tabletop the thighs are vertical, so the legs\' weight has a short lever about the hips; as one leg straightens toward the floor its lever grows (the legs\' combined moment about the hips more than doubles in the demo), and the hip flexors holding it pull the pelvis toward an arch that the abdominals must resist, so the extended position is hardest.',
  },
  // Lying on the back, knees bent with the feet flat, arms crossed on the chest, head and shoulders resting on the floor -> Upper back curled about 45 degrees off the floor so the shoulder blades clear it, lower back still down
  'crunch': {
    profile: [1, 0.9, 0.8],
    restAtStart: true,
    muscles: [
      { group: 'core', role: 'main', peak: 1, note: 'curls the ribs toward the pelvis' },
    ],
    why: 'Lying flat the floor carries the upper body; the moment the shoulders lift, the head and upper trunk hang on their longest lever, and as the trunk curls up the lever shortens (to about 60% at 45 degrees in the demo) while the shortened abdominals lose some force, so effort stays high but eases a little toward the top.',
  },
  // Dead hang from the bar, legs straight down -> Knees raised to hip height with the thighs about level and the shins hanging down
  'hanging-knee-raise': {
    profile: [0.1, 0.7, 1],
    muscles: [
      { group: 'core', role: 'main', peak: 1, note: 'holds the pelvis against the hip flexors\' pull as the knees rise' },
    ],
    why: 'In a dead hang the legs hang straight below the hips with no lever; raising the knees carries the thighs forward until they are level, where their lever is longest, so the top is hardest. The hip flexors lift the legs and the abdominals hold the pelvis against their pull, curling it up only if the knees go higher.',
  },
  // Dead hang from the bar, legs straight down -> Straight legs raised to horizontal, hips bent 90 degrees
  'hanging-leg-raise': {
    profile: [0.1, 0.7, 1],
    muscles: [
      { group: 'core', role: 'main', peak: 1, note: 'holds the pelvis against the hip flexors\' pull as the legs rise' },
    ],
    why: 'As in the knee raise, the legs have no lever in the dead hang and the longest one at the top, here with the straight legs level (about 40% more hip moment than the knee raise\'s top in the demo), so the top is hardest. The hip flexors lift the legs and the abdominals hold the pelvis steady against their pull.',
  },
  // Kneeling below a high pulley with the rope held at the ears, torso nearly upright (leaning about 16 degrees) -> Spine curled forward until the upper trunk is about level and the head points at the floor, hips only slightly more bent
  'cable-crunch': {
    profile: [0.15, 0.65, 1],
    muscles: [
      { group: 'core', role: 'main', peak: 1, note: 'curls the ribs toward the hips against the cable' },
    ],
    why: 'Upright, the cable runs almost through the spine, so it barely bends the trunk and the abdominals only brace; as the spine curls the hands move ahead of the waist and the cable\'s lever grows (to about 0.17 of body height in the demo), outgrowing the help from the trunk\'s own weight, so the fully curled position, with the abdominals shortest, is hardest.',
  },
};

/** The researched entry for an exercise, or one derived from its muscle lists. */
export function engagementFor(exercise: Pick<Exercise, 'id' | 'primary' | 'secondary' | 'tracking'>): Engagement {
  return ENGAGEMENT[exercise.id] ?? defaultEngagement(exercise);
}
