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
  // Standing tall with soft knees, barbell hanging at arm's length against the front of the thighs -> Hips pushed back, torso about 72 degrees forward (about 18 degrees above horizontal), knees bent about 30 degrees, bar just above the knees, still against the legs
  'romanian-deadlift': {
    profile: [0.25, 0.65, 1],
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'lengthen under load, then extend the hip' },
      { group: 'glutes', role: 'main', peak: 0.9, note: 'extend the hip' },
      { group: 'back', role: 'stabilize', peak: 0.5, note: 'keeps the spine neutral as the torso tips forward' },
    ],
    why: 'The moment arm of the bar and upper body about the hips grows with the forward lean. In a static model of the animated path (bar about 0.9 times body weight) the hip moment is about 0.28, 0.65 and 1.0 of its maximum at the start, middle and bottom (lower back about 0.35 at the start): standing tall the bar hangs in front of the thighs, so the hips already carry some load. The bottom is also where the hamstrings are longest. The erectors hold the spine still against the same growing moment.',
  },
  // Standing tall with soft knees, a dumbbell in each hand hanging against the front of the thighs -> Hips pushed back, torso about 72 degrees forward, knees bent about 30 degrees, dumbbells just above knee height in front of the legs
  'dumbbell-romanian-deadlift': {
    profile: [0.25, 0.65, 1],
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'lengthen under load, then extend the hip' },
      { group: 'glutes', role: 'main', peak: 0.9, note: 'extend the hip' },
      { group: 'back', role: 'stabilize', peak: 0.5, note: 'keeps the spine neutral as the torso tips forward' },
    ],
    why: 'Same hinge and path as the barbell Romanian deadlift. With two dumbbells of about 0.2 times body weight each, the static hip moment is about 0.23, 0.66 and 1.0 of its maximum at the start, middle and bottom, so the hip extensors work hardest at the bottom, where the hamstrings are longest. The erectors hold the spine isometrically against that moment.',
  },
  // Standing tall on the near (working) leg with a soft knee, the free foot just off the floor behind with its knee bent, a dumbbell in the far hand hanging in front of the thigh -> Hinged on the standing leg until the torso is about 80 degrees forward (nearly horizontal), standing knee bent about 25 degrees, free leg straight back in line with the trunk, dumbbell hanging straight below the shoulder at about mid-shin height
  'single-leg-rdl': {
    profile: [0.15, 0.65, 1],
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'standing leg: lengthen under load, then extend the hip' },
      { group: 'glutes', role: 'main', peak: 0.95, profile: [0.35, 0.7, 1], note: 'extend the hip and keep the pelvis level on one leg' },
      { group: 'core', role: 'stabilize', peak: 0.4, note: 'keeps the hips square and the trunk from twisting' },
    ],
    why: 'The standing hip carries the torso and the dumbbell, whose moment grows with the hinge, while the free leg reaching back counterbalances part of it: in a static model of the animated path the stance-hip moment is about 0.13, 0.64 and 1.0 of its maximum. The glutes get their own, higher start because on one leg the glute medius already holds the pelvis level while standing tall and keeps doing so through the hinge. The trunk resists the twist from the dumbbell held in the opposite hand.',
  },
  // Bar resting on the floor over mid-foot against the shins (shins tilted about 10 degrees), hips above the knees and below the shoulders, torso about 70 degrees forward (about 20 degrees above horizontal), shoulders just ahead of the bar, arms straight -> Locked out standing tall, hips and knees straight, bar hanging at arm's length against the top of the thighs
  'deadlift': {
    profile: [1, 0.8, 0.25],
    restAtStart: true,
    muscles: [
      { group: 'back', role: 'main', peak: 1, profile: [1, 0.8, 0.4], note: 'holds the spine rigid and the shoulders over the bar' },
      { group: 'glutes', role: 'main', peak: 0.95, note: 'extend the hip' },
      { group: 'hamstrings', role: 'main', peak: 0.9, note: 'extend the hip' },
      { group: 'quads', role: 'assist', peak: 0.6, profile: [1, 0.5, 0.05], note: 'straighten the knees to break the bar off the floor' },
      { group: 'core', role: 'stabilize', peak: 0.45, note: 'braces the trunk' },
    ],
    why: 'Just off the floor the bar and the inclined torso have their longest moment arm about the hips and lower back, so the pull is hardest at the start and eases as the torso rises. In a static model of the animated path (bar about 1.5 times body weight) the hip moment is about 1.0, 0.8 and 0.25 and the lower-back moment about 1.0, 0.8 and 0.3 at the floor, at the knees and at lockout (the bar still hangs in front of the hips when standing). The quads straighten the knees while the bar leaves the floor and are done by the time it passes the knees; in this drawing the combined centre of mass sits almost under the knees at lift-off, so a static model gives them little, and their early-only assist follows known deadlift mechanics. The back works isometrically the whole way and, with the traps holding the shoulders, still carries the bar at lockout.',
  },
  // Wide stance, hands inside the knees, bar resting on the floor against the shins with the shoulders right over it, knees bent about 87 degrees, hips a little above knee height, torso about 60 degrees forward, arms straight -> Locked out standing tall, hips and knees straight, bar hanging at arm's length against the top of the thighs
  'sumo-deadlift': {
    profile: [1, 0.8, 0.25],
    restAtStart: true,
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'extend the hip and keep the knees pushed out' },
      { group: 'quads', role: 'main', peak: 0.9, profile: [1, 0.6, 0.05], note: 'straighten the knees off the floor' },
      { group: 'hamstrings', role: 'main', peak: 0.85, note: 'extend the hip' },
      { group: 'back', role: 'stabilize', peak: 0.5, note: 'keeps the spine neutral' },
      { group: 'core', role: 'stabilize', peak: 0.45, note: 'braces the trunk' },
    ],
    why: 'As in the conventional pull, the moment about the hips and lower back is largest just off the floor and falls toward lockout (static estimate for the animated path about 1.0, 0.9 and 0.25; the side view draws the thighs at full length, which overstates how far behind the bar the hips sit in a wide stance, so the middle value is kept at the conventional 0.8). The deeper knee bend at the start and the more upright torso put more of the early work on knee extension, so the quads stay involved further up. An EMG comparison (Escamilla et al. 2002) found more vastus medialis and lateralis activity in the sumo than in the conventional deadlift.',
  },
  // Standing tall with soft knees, barbell across the upper back, hands on the bar -> Hips pushed back, torso about 70 degrees forward (about 20 degrees above horizontal), knees bent about 30 degrees with the shins vertical, bar still on the upper back
  'good-morning': {
    profile: [0.2, 0.5, 1],
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'lengthen under load, then extend the hip' },
      { group: 'glutes', role: 'assist', peak: 0.65, note: 'help extend the hip' },
      { group: 'back', role: 'stabilize', peak: 0.5, note: 'holds the spine neutral under the bar' },
    ],
    why: 'With the bar on the upper back, its moment arm about the hips and lower back grows with the forward lean, from almost none standing (the bar sits over or just behind the hips) to the maximum at the bottom: a static model of the animated path gives about 0, 0.48 and 1.0 at the hips. The start value reflects carrying the bar on stacked joints. Because the bar sits a full trunk length from the hips, the lower back resists a large moment through the whole descent.',
  },
  // Kneeling upright on a pad, ankles held under a roller, body straight from knees to head, hands up in front of the chest -> Body lowered forward in one straight line about 66 degrees from upright, hips kept straight, hands reaching toward the floor ready to catch
  'nordic-curl': {
    profile: [0.05, 0.65, 1],
    lowering: 1,
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'brake the knee as the body tips forward' },
    ],
    why: 'Upright, the body is balanced over the knees. As it tips forward, the moment of everything above the knees grows with the sine of the lean (static estimate for the animated path about 0.03, 0.6 and 1.0), so the hamstrings work hardest at the deepest point shown, where they are also longest. The middle value sits a little above the static 0.6 because the hamstrings are shorter and weaker with the knees more bent. The lowering is the working phase of this exercise.',
  },
  // Lying face up, arms on the floor, legs long with the knees almost straight, heels on sliders, hips held just off the floor -> Heels pulled in under the knees (knees bent about 110 degrees), hips lifted into a full bridge with shoulders, hips and knees in line
  'slider-leg-curl': {
    profile: [1, 0.8, 0.3],
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'pull the heels in and hold the hips up' },
      { group: 'glutes', role: 'stabilize', peak: 0.5, note: 'hold the hips up' },
    ],
    why: 'On sliders the floor can only push straight up at the heels, so the hamstrings hold the knee against a lever that is longest with the legs long and the heels far out. In the animated path the static knee-flexion moment falls from 1.0 to about 0.65 halfway and to almost nothing at the top, where the heels sit under the knees; the hip-extension moment eases from 1.0 to about 0.55. The middle stays at 0.8 because the hamstrings are weaker with the knees more bent; at the top they mostly help the glutes hold the bridge from a short position. The hip angle changes by less than 20 degrees (the pelvis rises because the knees bend), so the glutes hold the hips up isometrically.',
  },
  // Face down on the machine, knees just unlocked (about 10 degrees bent), roller on the backs of the ankles, weight stack at rest -> Heels curled up toward the glutes, knees bent about 115 degrees
  'lying-leg-curl': {
    profile: [0.5, 0.7, 1],
    restAtStart: true,
    muscles: [
      { group: 'hamstrings', role: 'main', peak: 1, note: 'bend the knee' },
    ],
    why: 'The machine\'s resistance about the knee is roughly even through the range (the lower leg\'s own weight adds to it early and helps slightly past 90 degrees). With the hips extended, the hamstrings are already short at the hip, and curling the knee past 90 degrees shortens them further, so they lose much of their strength and the fully curled position is the hardest to hold.',
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
  // Hinged with the torso about 64 degrees forward, hips back, knees bent about 35 degrees, kettlebell hiked back between the thighs under the hips -> Standing tall with the hips locked out, straight arms a little below horizontal, bell floating at about chest height
  'kettlebell-swing': {
    profile: [1, 0.85, 0.3],
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'snap the hips forward' },
      { group: 'hamstrings', role: 'main', peak: 0.9, note: 'load in the backswing, then extend the hip' },
      { group: 'back', role: 'stabilize', peak: 0.45, note: 'keeps the spine neutral in the hinge' },
      { group: 'core', role: 'stabilize', peak: 0.4, note: 'braces the trunk and stops a lean back at the top' },
    ],
    why: 'A ballistic hinge. The hips work hardest at the bottom, where the bell\'s momentum is stopped and reversed, and through the hip drive, which in the animation is complete by about s = 0.6 while the bell swings forward. After that the bell floats up on its own, so little load remains at the top. A static model would put a sizable load at the top (the bell held at arm\'s length in front), so the profile follows the swing\'s momentum instead.',
  },
  // Upper back across the bench edge, feet flat, hips lowered until the glutes are a few centimetres off the floor (hips bent about 90 degrees, knees about 115 degrees), barbell held in the hip crease -> Hips driven up until the trunk is level and in line with the thighs, shins about vertical, bar still in the hip crease
  'hip-thrust': {
    profile: [0.7, 0.8, 1],
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'drive the hips up; hardest at lockout' },
      { group: 'hamstrings', role: 'assist', peak: 0.5, profile: [1, 0.7, 0.45], note: 'help extend the hip, most low in the range' },
    ],
    why: 'At the bottom the hips hover a few centimetres off the floor and the plates never touch it, so the bar is held on the hips from the start. The external hip moment changes little through the range because the hips barely move horizontally between the bench and the feet: a static model stays within about 15% if the bench pushes straight up; if it pushes square to the sloping back, the bottom comes out somewhat higher. The glutes are shortest and weakest at full hip extension, so lockout is the hardest point. At the bottom the feet are ahead of the knees, so the hamstrings also hold the knee; at the top the shins are vertical and the hamstrings are short, so their share fades as the hips rise.',
  },
  // Upper back across the bench edge, feet flat, hips lowered until the glutes are a few centimetres off the floor (hips bent about 90 degrees), a dumbbell held across the hips -> Hips driven up until the trunk is level and in line with the thighs, shins about vertical, dumbbell still held on the hips
  'dumbbell-hip-thrust': {
    profile: [0.7, 0.8, 1],
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'drive the hips up; hardest at lockout' },
      { group: 'hamstrings', role: 'assist', peak: 0.5, profile: [1, 0.7, 0.45], note: 'help extend the hip, most low in the range' },
    ],
    why: 'Same mechanics as the barbell hip thrust with a lighter load. The hips hover just off the floor at the bottom, so the load is held from the start. The external hip moment changes little through the range while the glutes are weakest at full hip extension, so lockout is hardest. The hamstrings help most low in the range, where they also hold the knee, and fade as the hips rise with the shins vertical.',
  },
  // Lying face up, knees bent with the feet flat a little ahead of the knees, arms on the floor by the sides, hips resting on the floor -> Hips lifted until shoulders, hips and knees form a straight line, shins about vertical
  'glute-bridge': {
    profile: [0.7, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'lift the hips; hardest at the top' },
      { group: 'hamstrings', role: 'assist', peak: 0.5, profile: [1, 0.7, 0.45], note: 'help extend the hip, most low in the range' },
    ],
    why: 'Supported at the shoulders and feet, the hip moment from body weight is nearly constant once the hips leave the floor (static estimate within about 5% through the animated range), but the glutes are weakest at full hip extension, so the top is the hardest point. With the feet close and the knees bent about 110 to 125 degrees the hamstrings are short; their knee job (the feet are ahead of the knees) is largest as the hips leave the floor (static knee-flexion moment about 1.0, 0.45, 0.3), so they help mostly early.',
  },
  // Lying face up, the working foot flat with the knee bent, the free leg held straight in line with the working thigh, hips resting on the floor -> Hips lifted on one leg until shoulders, hips and the working knee are in line, free leg still straight along the thigh line
  'single-leg-glute-bridge': {
    profile: [0.7, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'lift the hips and keep the pelvis level' },
      { group: 'hamstrings', role: 'assist', peak: 0.55, profile: [1, 0.7, 0.45], note: 'help extend the hip, most low in the range' },
    ],
    why: 'One hip lifts the pelvis and also carries the raised leg, so its moment is larger than each hip\'s in the two-leg bridge and stays nearly even through the range (static estimate 0.94 to 1.0); the glutes are weakest at full extension, which makes the top the hardest. On one leg the glute medius also keeps the pelvis from dropping on the free side. Only the working leg is coloured.',
  },
  // Lying on the left side (seen from the front), body in one line, head resting on the outstretched bottom arm, top hand on the hip, top leg resting on the bottom leg -> Top leg lifted straight about 40 degrees above the bottom leg (about 34 degrees above horizontal), pelvis not rolling back
  'side-lying-hip-abduction': {
    profile: [0.7, 0.85, 1],
    restAtStart: true,
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'the glute medius lifts the leg' },
    ],
    why: 'The leg\'s weight has its longest lever about the hip just after it leaves the other leg (it starts about horizontal) and about 0.83 of that at the top of the 40-degree lift. The hip abductors get markedly weaker as they shorten (here from about neutral to about 43 degrees of abduction from the trunk line), so the effort keeps rising to the top of the lift.',
  },
  // Facing away from a low pulley, hinged with the torso about 62 degrees forward, hips back, knees bent about 30 degrees, both hands on the rope between the thighs a little above knee height -> Standing tall with the hips through, arms hanging straight with the hands on the rope in front of the upper thighs, the cable running back between the legs
  'cable-pull-through': {
    profile: [1, 0.65, 0.25],
    muscles: [
      { group: 'glutes', role: 'main', peak: 1, note: 'extend the hip' },
      { group: 'hamstrings', role: 'main', peak: 0.9, note: 'extend the hip' },
    ],
    why: 'The forward-leaning torso and the cable pulling the hands back toward the low pulley both have their longest moment arm about the hips in the hinged position. A static model of the animated path (cable 0.3 to 0.6 times body weight) gives about 1.0, 0.62 and 0.15 to 0.22 at the start, middle and lockout. Standing tall, the cable still passes below the hips and pulls the hands back between the legs, so a small backward pull is left for the glutes to hold at lockout.',
  },
  // Standing tall with straight knees, a dumbbell hanging at each side, feet flat -> Up on the balls of the feet with the toes flat, heels high (feet about 40 degrees from the floor), body still tall over the balls of the feet
  'standing-calf-raise': {
    profile: [0.65, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'calves', role: 'main', peak: 1, note: 'lift the heels' },
    ],
    why: 'With the heels down, the heels carry the body and dumbbells and the calves only keep the balance; once the heels lift, the whole load acts through the balls of the feet. That lever (ankle to the ball of the foot, measured along the floor) shrinks as the heels rise, to under half at the top of this 40-degree rise. Calf strength falls even faster as the muscle shortens (at 30 to 40 degrees of pointing the ankle it is roughly half or less of its strength near neutral), so the top is still the hardest position to hold.',
  },
  // Standing tall on the near foot, heel down, the free knee bent with that foot lifted behind, one hand flat on a wall -> Up on the ball of the standing foot with the toes flat, heel high (foot about 40 degrees from the floor)
  'single-leg-calf-raise': {
    profile: [0.65, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'calves', role: 'main', peak: 1, note: 'lift the heel' },
    ],
    why: 'One calf lifts the whole body. The heel carries the weight at the start, and the load comes on through the ball of the foot as the heel lifts. That lever shrinks toward the top, but the calf weakens faster as it shortens, so the top is the hardest. Only the standing leg is coloured.',
  },
  // Standing tall on both feet, heels down, arms relaxed at the sides -> Up on the balls of both feet with the toes flat, heels high (feet about 40 degrees from the floor)
  'bodyweight-calf-raise': {
    profile: [0.65, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'calves', role: 'main', peak: 1, note: 'lift the heels' },
    ],
    why: 'Body weight rests on the heels until they lift; from then on it acts through the balls of the feet with a lever that shrinks toward the top, but the calves weaken faster as they shorten, so the top is the hardest.',
  },
  // Sitting on a bench, thighs level and shins vertical (knees bent about 90 degrees), feet flat, a dumbbell stood on end on each lower thigh, steadied by the hands -> Heels raised high on the balls of the feet (feet about 40 degrees from the floor), knees and dumbbells lifted a few centimetres
  'seated-calf-raise': {
    profile: [0.65, 0.8, 1],
    restAtStart: true,
    muscles: [
      { group: 'calves', role: 'main', peak: 1, note: 'lift the heels; with bent knees mostly the soleus' },
    ],
    why: 'The dumbbells on the knees, not the body, are the load. With the shins vertical they rest through the heels until the heels lift, then act through the balls of the feet. That lever shrinks toward the top, but the calf weakens faster, so the top is the hardest. With the knees bent about 90 degrees, the gastrocnemius is slack and the soleus does most of the work.',
  },
  // Standing under the shoulder pads, hands on the handles, balls of the feet on the platform edge, heels dropped below it in a stretch (feet about 18 degrees below level) -> Up on the balls of the feet, heels well above the platform (feet about 40 degrees above level), pads pushed straight up
  'machine-calf-raise': {
    profile: [0.65, 0.8, 1],
    muscles: [
      { group: 'calves', role: 'main', peak: 1, note: 'lift the heels' },
    ],
    why: 'The pads load the shoulders and the load passes down the straight body to the balls of the feet the whole time. At the start the heels hang below the platform, so the calves already hold the full load at their longest, helped by the stretch\'s passive tension. The lever from the ankle to the ball is longest there and shrinks toward the top while the calves weaken as they shorten, so the effort rises to the top, which is the hardest position to hold.',
  },
  // Lying on a flat bench, feet on the floor, barbell held at arm's length straight above the shoulders, elbows locked. -> Bar lowered to touch the lower chest (about the nipple line), elbows a little below shoulder level and about 45 to 60 degrees out from the sides.
  'bench-press': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'lowers the bar under control, then drives the arms up and in' },
      { group: 'triceps', role: 'assist', peak: 0.65, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
      { group: 'shoulders', role: 'assist', peak: 0.6, note: 'front of the shoulder helps lift the arms' },
    ],
    why: 'Locked out, the bar sits over straight arms stacked on the shoulders, so little effort is needed; lowered to the lower chest it ends about 0.07 body heights toward the feet from the shoulder joints and the chest is stretched, so the bottom is the hardest position to hold and the press is hardest just off the chest (the sticking region, Elliott et al. 1989). The forearms lean about 12 degrees toward the head from mid-way down, so the elbow\'s lever is already near its maximum half way down while the shoulder\'s is about 40% of its maximum: the triceps work hard from the middle down while the chest peaks at the bottom.',
  },
  // Lying on a bench inclined about 32 degrees, barbell held at arm's length straight above the shoulders. -> Bar lowered to the upper chest just under the collarbones, forearms upright under it, elbows a little below shoulder level.
  'incline-bench-press': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'upper chest drives the arms up and in' },
      { group: 'shoulders', role: 'main', peak: 0.9, note: 'front of the shoulder lifts the arms forward and up' },
      { group: 'triceps', role: 'assist', peak: 0.6, profile: [0.3, 1, 0.4], note: 'straighten the elbows, most through the middle of the press' },
    ],
    why: 'For the chest and front deltoids the curve is the flat press\'s: least with the bar over straight arms, most at the chest, where the bar is furthest in front of the shoulder joints (lever 0 / 0.42 / 1 of maximum). The incline turns the press toward raising the arms forward and up, so the front deltoids work almost as hard as the upper (clavicular) chest. The forearms are drawn upright under the bar at the chest (2 degrees) and lean back only mid-way (about 7 degrees), so the elbow\'s lever is longest in the middle of the press and about a third of that at the chest: the triceps are drawn working hardest mid-press.',
  },
  // Lying on a flat bench, dumbbells held at arm's length above the shoulders, elbows nearly straight. -> Dumbbells lowered beside the chest and level with it, forearms upright under them, elbows below shoulder level.
  'dumbbell-bench-press': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'lowers the dumbbells under control, then drives the arms up and in' },
      { group: 'triceps', role: 'assist', peak: 0.55, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
      { group: 'shoulders', role: 'assist', peak: 0.6, note: 'front of the shoulder helps lift and steady each arm' },
    ],
    why: 'As with the barbell, the dumbbells are easiest to hold over straight arms and hardest at the bottom, where they sit furthest out from the shoulder joints (beside the chest, 0.12 body heights out to the side) and the chest is stretched; half way down the lever is under half its maximum. Each arm balances its own dumbbell, so the shoulders also steady the load. The forearms lean only 6 to 9 degrees toward the head from mid-way down, so the elbows carry a shorter lever than with the bar, roughly level from the middle to the bottom.',
  },
  // Lying on a bench inclined about 32 degrees, dumbbells held at arm's length above the shoulders. -> Dumbbells lowered beside the upper chest and level with it, forearms upright under them, elbows below shoulder level.
  'incline-dumbbell-press': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'upper chest drives the arms up and in' },
      { group: 'shoulders', role: 'main', peak: 0.9, note: 'front of the shoulder lifts the arms forward and up' },
      { group: 'triceps', role: 'assist', peak: 0.55, profile: [0.3, 1, 0.4], note: 'straighten the elbows, most through the middle of the press' },
    ],
    why: 'Same mechanics as the incline barbell press: least effort with the dumbbells over straight arms, most at the bottom, where they are furthest from the shoulder joints and the chest is stretched. The incline turns the press toward raising the arms forward and up, so the front deltoids share the work with the upper chest. The forearms stand upright under the dumbbells at the bottom and lean back only mid-way, so the triceps\' lever is longest in the middle of the press and short at the bottom.',
  },
  // Lying on the floor with knees bent and feet flat, dumbbells held at arm's length above the shoulders. -> Dumbbells lowered until the backs of the upper arms touch the floor about 45 degrees out from the body, elbows bent to about a right angle, forearms upright under the dumbbells.
  'dumbbell-floor-press': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'drives the arms up and in' },
      { group: 'triceps', role: 'assist', peak: 0.7, profile: [0.3, 1, 0.4], note: 'straighten the elbows, most through the middle of the press' },
    ],
    why: 'The floor stops the upper arms level with the back, cutting off the deepest part of a bench press. The dumbbells are furthest out from the shoulder joints at the bottom, so that is the hardest position as long as the arms only touch the floor and stay loaded; locked out over the shoulders is easiest. At the floor the forearms stand upright under the dumbbells, so the elbows carry little there; the triceps\' lever is longest mid-press, where the forearms lean, and the shortened range leaves them a large share of the work.',
  },
  // Straight-arm plank on the toes, hands flat just behind the shoulders, body straight from head to heels at about 25 degrees to the floor. -> Chest lowered to just above the floor, elbows bent and pointing back about 45 degrees out from the body, body still straight.
  'push-up': {
    profile: [0.3, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'lowers the body under control, then pushes it away from the floor' },
      { group: 'triceps', role: 'assist', peak: 0.65, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
      { group: 'shoulders', role: 'assist', peak: 0.55, note: 'front of the shoulder helps push' },
      { group: 'core', role: 'stabilize', peak: 0.35, note: 'keeps the body straight like a plank' },
    ],
    why: 'The hands carry roughly two thirds to three quarters of body weight (about 64% measured by Ebben et al. 2011; 71% at the top rising to 76% at the bottom in this drawing). With straight arms that load runs down the arms under the shoulders. Lowering, the shoulders move ahead of the hands and the elbows bend behind them, so both levers grow and the bottom is hardest, as in a bench press; the elbow\'s lever is already near its maximum half way down. The abdominals hold the body straight against sagging throughout.',
  },
  // Hands flat on a bench, arms straight and upright under the shoulders, body straight from head to heels at about 45 degrees to the floor. -> Chest lowered to the bench edge, elbows bent and pointing back with the forearms upright, body still straight at about 30 degrees to the floor.
  'incline-push-up': {
    profile: [0.3, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'lowers the body, then pushes it away from the bench' },
      { group: 'triceps', role: 'assist', peak: 0.6, profile: [0.3, 1, 0.4], note: 'straighten the elbows, most half way down' },
      { group: 'shoulders', role: 'assist', peak: 0.55, note: 'front of the shoulder helps push' },
    ],
    why: 'Raising the hands normally puts less body weight on them than a floor push-up (Ebben et al. 2011), but for the chest and front deltoids the shape is the same: least with straight arms, most at the bottom, where the shoulders have moved furthest ahead of the hands (lever about half its maximum half way down). At the bench the forearms stand upright under the elbows, so the elbow\'s lever is longest mid-way down and short at the bottom: the triceps are drawn hardest in the middle of the rep.',
  },
  // Kneeling on the kneecaps with the shins raised, arms straight and hands flat just behind the shoulders, body straight from knees to head at about 33 degrees to the floor. -> Chest lowered to just above the floor, elbows bent and pointing back, body still straight from the knees.
  'knee-push-up': {
    profile: [0.3, 0.6, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'lowers the body, then pushes it away from the floor' },
      { group: 'triceps', role: 'assist', peak: 0.6, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
      { group: 'shoulders', role: 'assist', peak: 0.5, note: 'front of the shoulder helps push' },
    ],
    why: 'Pivoting on the knees puts about half of body weight on the hands instead of about two thirds (Ebben et al. 2011), but the curve is the full push-up\'s: easiest with straight arms under the shoulders, hardest with the chest near the floor, where the shoulders are furthest ahead of the hands and the elbows most bent.',
  },
  // Supported on parallel bars on straight arms, shoulders right over the hands, trunk upright, knees bent with the feet behind. -> Lowered until the upper arms are about level: elbows bent to about 80 degrees and pointing back, forearms nearly upright, shoulders about a forearm's length above the bars and well ahead of the hands, trunk leaning about 40 degrees forward.
  'dip': {
    profile: [0.35, 0.8, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'lower chest pulls the arms down and forward to lift the body' },
      { group: 'triceps', role: 'main', peak: 0.95, profile: [0.3, 0.65, 1], note: 'straighten the elbows' },
      { group: 'shoulders', role: 'assist', peak: 0.6, note: 'front of the shoulder helps drive the arms forward' },
    ],
    why: 'The arms carry the whole body weight and the body balances over the hands. At the top it runs straight down locked arms under the shoulders. Lowering, the trunk tips forward and the shoulders travel ahead of the hands (0.10 body heights half way down, 0.14 at the bottom) while the forearms stay nearly upright (14 degrees at the bottom), so the shoulder\'s lever grows early and the elbow\'s late: half way down the chest and front deltoids are at about three quarters of their bottom demand, the triceps at about two thirds. The bottom, with the chest and front of the shoulders stretched and the elbows past a right angle, is hardest for all of them.',
  },
  // Lying on a flat bench, dumbbells held together over the chest on nearly straight arms, elbows softly bent. -> Arms opened wide out to the sides, upper arms just below level with the shoulders, elbows still softly bent, dumbbells about level with the shoulders (from the side the arms look short as they point toward the camera).
  'dumbbell-fly': {
    profile: [0.2, 0.7, 1],
    muscles: [
      { group: 'chest', role: 'main', peak: 1, note: 'stretches as the arms open, then hugs them back together' },
      { group: 'shoulders', role: 'assist', peak: 0.5, note: 'front of the shoulder helps bring the arms up and in' },
    ],
    why: 'With the dumbbells together over the chest the arms hold them with almost no moment arm (they even sit slightly inside the shoulders); as the arms open, the dumbbells move out to the sides and the moment arm about the shoulders grows to its maximum at the bottom, where the chest is also longest. Half way the lever is about 0.63 of its maximum, a little more in effort since the chest is less stretched there. The fly is therefore hardest at the bottom and loses almost all tension at the top.',
  },
  // Hinged about 70 degrees forward with a flat back and bent knees, barbell hanging at straight arms under the shoulders, overhand grip a little wider than the shoulders -> Bar rowed up in front of the knees and thighs until it touches the lower ribs, elbows bent to about 50 degrees, flared out and raised to about the level of the back; torso still hinged at 70 degrees
  'barbell-row': {
    profile: [0.4, 0.65, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbows up and back and squeezes the shoulder blades; the lower back holds the hinge' },
      { group: 'biceps', role: 'assist', peak: 0.55, profile: [0.1, 0.8, 1], note: 'bend the elbows as the bar comes up' },
      { group: 'hamstrings', role: 'stabilize', peak: 0.45, profile: [1, 0.9, 0.8], note: 'hold the hips in the hinge' },
    ],
    why: 'At the hang the bar sits under the shoulders with no lever about them, so the upper back only holds the shoulder blades while the lower back holds the hinge; as the bar rises it moves behind the shoulders, its lever is longest at the top and the lats, rhomboids and trapezius are shortest there, so the top is hardest. Because the bar path stays in front of the thighs the forearms slant about 35 to 40 degrees from mid-pull on, so the elbow flexors\' load rises quickly and stays high to the top, where they are also shortest, while the hip moment the hamstrings hold eases only a little (to about 0.8 of the start) as the bar comes in.',
  },
  // Far knee and far hand on a flat bench, near foot on the floor, torso about 76 degrees forward (nearly level), dumbbell hanging at a straight arm under the shoulder -> Dumbbell rowed up beside the hip, elbow bent to about 65 degrees and raised above the back, forearm still hanging straight down
  'one-arm-dumbbell-row': {
    profile: [0.3, 0.7, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbow back and squeezes the shoulder blade in' },
      { group: 'biceps', role: 'assist', peak: 0.5, profile: [0.1, 0.6, 1], note: 'bends the elbow and holds it bent' },
    ],
    why: 'The bench props the torso, so at the hang the back only holds the shoulder blade against a dumbbell hanging straight under the shoulder. The upper arm then swings back through about 115 degrees, so the dumbbell\'s lever about the shoulder is already about 0.85 of its maximum at mid-pull and peaks as the elbow passes the back; the top, with the lats and mid-back shortest, is hardest. The forearm hangs plumb throughout, so the elbow flexors carry little turning load and mainly bend the elbow and hold it bent, most near the top.',
  },
  // Hinged about 58 degrees forward with a flat back and bent knees, a dumbbell in each hand hanging at straight arms under the shoulders, palms facing in -> Dumbbells rowed up beside the hips, elbows bent to about 85 degrees and drawn back past the line of the back, forearms hanging straight down
  'dumbbell-bent-over-row': {
    profile: [0.35, 0.65, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbows back and squeezes the shoulder blades; the lower back holds the hinge' },
      { group: 'biceps', role: 'assist', peak: 0.5, profile: [0.1, 0.6, 1], note: 'bend the elbows and hold them bent' },
      { group: 'hamstrings', role: 'stabilize', peak: 0.4, profile: [1, 0.9, 0.8], note: 'hold the hips in the hinge' },
    ],
    why: 'As in the barbell row the unsupported hinge keeps the lower back working from the start (a little less here, with the more upright torso and lighter load), while the dumbbells hang with no lever about the shoulders; their lever grows as the upper arms swing back (about 0.75 of its maximum at mid-pull) and is longest at the top, where the upper back is also shortest. The forearms hang plumb, so the elbow flexors mostly bend the elbows and hold them bent, most near the top.',
  },
  // Chest on an incline pad with the torso about 50 degrees forward, legs reaching back to the balls of the feet, dumbbells hanging at straight arms under the shoulders, palms in -> Dumbbells rowed up beside the hips, elbows bent to about 95 degrees and drawn back just past the line of the back, forearms hanging straight down
  'chest-supported-dumbbell-row': {
    profile: [0.3, 0.6, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbows back and squeezes the shoulder blades' },
      { group: 'biceps', role: 'assist', peak: 0.5, profile: [0.1, 0.6, 1], note: 'bend the elbows and hold them bent' },
    ],
    why: 'The pad carries the torso, so the lower back rests and at the hang the upper back only holds the shoulder blades. The upper arms sweep back through about 85 degrees, so the dumbbells\' lever about the shoulders grows steadily (about 0.7 of its maximum at mid-pull) and is longest at the top, where the lats, rhomboids and trapezius are shortest. The forearms hang plumb, so the elbow flexors mostly bend the elbows and hold them bent.',
  },
  // Dead hang from an overhand grip, arms nearly straight overhead, body vertical -> Chin over the bar, elbows fully bent, shoulders just below and behind the bar, body leaning back about 18 degrees
  'pull-up': {
    profile: [0.3, 0.8, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbows down and the shoulder blades down and back' },
      { group: 'biceps', role: 'assist', peak: 0.65, profile: [0.1, 1, 0.7], note: 'bend the elbows' },
      { group: 'core', role: 'stabilize', peak: 0.3, note: 'keeps the body still, no swinging' },
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
    lowering: 1,
    returnShare: 0.3,
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'lengthens under load to lower the body slowly' },
      { group: 'biceps', role: 'assist', peak: 0.65, profile: [0.7, 1, 0.1], note: 'let the elbows straighten slowly' },
    ],
    why: 'The pull-up played from the top: holding the chin over the bar, with the lats and mid-back at their shortest, is the hardest point, and effort falls as the body lowers to a dead hang, where the straight arms carry it with little muscle work. In practice the lifter steps or jumps back to the top, so the return half of the loop (drawn as lifting) overstates the work.',
  },
  // Dead hang with straight arms, shoulders shrugged up toward the ears -> Shoulder blades pulled down and back so the body rises about 6 cm and the chest lifts, trunk leaning back about 9 degrees; arms still straight
  'scapular-pull-up': {
    profile: [0.3, 0.85, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the shoulder blades down to lift the body' },
    ],
    why: 'In the shrugged dead hang the shoulder girdle hangs on passive tissue. Once the shoulder blades start to pull down, the lower trapezius and lats carry the whole body weight at every point of the short range, and they get shorter and weaker toward the top, so the fully pulled-down position is hardest and the middle is not far behind.',
  },
  // Lying face up under a bar set at about hip height, heels on the floor, body straight and about 22 degrees above the floor, arms straight reaching up and slightly toward the feet to an overhand grip a little wider than the shoulders -> Body pivoted on the heels to about 40 degrees until the lower chest touches the bar, elbows bent to about 45 degrees, driven down and out and finishing just past the line of the back
  'inverted-row': {
    profile: [0.3, 0.85, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbows down and back and squeezes the shoulder blades' },
      { group: 'biceps', role: 'assist', peak: 0.55, profile: [0.1, 0.7, 1], note: 'bend the elbows as the chest rises' },
      { group: 'core', role: 'stabilize', peak: 0.3, note: 'braces the trunk so the body moves in one piece' },
    ],
    why: 'A row with the heels on the floor: at the bottom the straight arms can pass the bar\'s pull along their length, so the back mainly holds the shoulder blades. Once the elbows bend, most of the body\'s weight hangs from the bar and, because the arms start angled toward the feet, its lever about the shoulders is largest early in the pull and shrinks toward the top; the shoulder-blade muscles, though, are shortest at the top with the elbows past the back, so effort builds early and stays high to the finish. Pulling the chest toward the bar loads the elbow flexors more and more as the elbows bend.',
  },
  // Seated with the thighs under the pad and the trunk leaning back about 12 degrees, arms straight overhead on a wide overhand bar under the pulley, weight stack lifted -> Bar pulled down in front of the face to the upper chest just below the collarbones, elbows sharply bent and pointing down and out under the shoulders
  'lat-pulldown': {
    profile: [0.3, 0.8, 1],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'pulls the elbows down and the shoulder blades down and back' },
      { group: 'biceps', role: 'assist', peak: 0.6, profile: [0.1, 1, 0.5], note: 'bend the elbows, most early in the pull' },
    ],
    why: 'With straight arms overhead the shoulder girdle hangs on the cable much as in a dead hang, so the back mainly holds the shoulder blades. With the wide grip the cable\'s lever about the shoulders is near its maximum from mid-pull to the chest while the lats shorten, so bringing the bar to the chest is hardest. The forearms slant most in the first half of the pull, where the elbow flexors work most; at the chest the hands sit ahead of the elbows and the cable barely loads the elbow flexors.',
  },
  // Standing a step back from a high pulley, hips back with the torso leaning forward about 30 degrees and the knees soft, nearly straight arms reaching up and forward along the cable, hands a little above head height -> Arms swept down, still nearly straight, until the bar touches the front of the thighs
  'straight-arm-pulldown': {
    profile: [0.1, 1, 0.9],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'sweeps the straight arms down to the thighs' },
    ],
    why: 'At the start the arms point along the cable, so it has almost no lever about the shoulders and the lats carry next to nothing. The lever is longest at mid-sweep, where the arms cross the cable at about a right angle, and at the thighs it is still about two thirds of that while the lats are near their shortest, so effort stays high to the finish.',
  },
  // On a 45-degree back-extension bench, ankles under the roller and thighs on the pad, body straight from heels to head along the 45-degree line, arms crossed on the chest -> Trunk lowered from the hips (hips bent about 88 degrees) until it points about 45 degrees below horizontal, back kept straight
  'back-extension': {
    profile: [0.75, 1, 0.7],
    muscles: [
      { group: 'back', role: 'main', peak: 1, note: 'keeps the spine straight against the torso\'s weight' },
      { group: 'glutes', role: 'assist', peak: 0.65, note: 'extend the hip' },
      { group: 'hamstrings', role: 'assist', peak: 0.6, note: 'extend the hip' },
    ],
    why: 'The upper body\'s weight has its longest moment arm about the hips and lower back when the trunk is horizontal, which comes halfway through the animated range. The trunk is about 45 degrees above horizontal at the top and about 43 degrees below it at the bottom, so the lever is about 0.7 of the maximum at both ends (static estimate about 0.74, 1.0, 0.69 at the hips and 0.75, 1.0, 0.68 at the lower back).',
  },
  // Standing tall, leaning back about 3 degrees, bar resting on the front of the shoulders at collarbone height, elbows down and a little in front of the bar. -> Bar pressed to straight arms overhead, over the shoulders and mid-foot, head through.
  'overhead-press': {
    profile: [1, 0.8, 0.3],
    restAtStart: true,
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'press the arms up overhead' },
      { group: 'triceps', role: 'assist', peak: 0.65, profile: [0.5, 1, 0.3], note: 'straighten the elbows, most as the bar passes the head' },
      { group: 'core', role: 'stabilize', peak: 0.4, note: 'braces so the lower back doesn\'t arch under the bar' },
    ],
    why: 'Between reps the bar rests on the front of the shoulders (NSCA: lower it to touch them), so the pressing muscles are nearly off until it leaves. From there to past the forehead the bar stays about 0.08 body heights in front of the shoulder joints (the lifter leans back about 6 degrees to let it pass the face) while the upper arms rise to horizontal, where the shoulder is weaker: that is the hardest stretch. As the bar comes back over the shoulders its lever vanishes and, locked out, the load runs down straight, stacked arms. The triceps work most through the middle, as the elbows flare out under the bar and straighten.',
  },
  // Standing tall, bar resting on the front of the shoulders at collarbone height. -> Bar locked out overhead on straight arms, legs straight again; the knee dip and drive take the first 40% of the move, with the bar still on the shoulders.
  'push-press': {
    profile: [0.2, 0.3, 0.7, 1, 0.3],
    restAtStart: true,
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'press the bar the rest of the way overhead' },
      { group: 'triceps', role: 'assist', peak: 0.65, note: 'straighten the elbows to lock out' },
      { group: 'quads', role: 'assist', peak: 0.65, profile: [0.3, 1, 0.5, 0.1, 0.05], note: 'dip and drive the bar off the shoulders' },
      { group: 'core', role: 'stabilize', peak: 0.4, note: 'braces the trunk through the dip and drive' },
    ],
    why: 'The bar rests racked on the shoulders while the knees dip (the hips drop about 5% of height) and drive (s 0 to 0.4), so the quads carry the start and fade once the legs lock; the shoulders and triceps barely work until the bar leaves the shoulders with the legs\' momentum, are hardest as it passes the head, and ease at lockout over stacked arms. Five points (s = 0, 0.25, 0.5, 0.75, 1) keep the arms cool through the dip.',
  },
  // Standing tall, dumbbells at the sides of the head about chin height, palms forward, elbows out to the sides and a little forward, below the shoulders and right under the dumbbells. -> Dumbbells pressed to straight arms right over the shoulders.
  'dumbbell-shoulder-press': {
    profile: [0.7, 1, 0.3],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'press the arms up overhead' },
      { group: 'triceps', role: 'assist', peak: 0.5, profile: [0.5, 1, 0.3], note: 'straighten the elbows, most through the middle of the press' },
    ],
    why: 'The forearms stay upright under the dumbbells, so each dumbbell\'s lever about the shoulder is the upper arm\'s horizontal reach. At the start the elbows are well below the shoulders (upper arms about 53 degrees from hanging), so the dumbbells sit closer in (0.8 of the longest lever) than when the upper arms come level, about 40% of the way up; the shoulder is also weaker the higher the arm, so the hardest stretch runs from there to about two thirds of the way up. Locked out, the load runs down straight arms over the shoulders. With the forearms upright the dumbbells put little turning load on the elbows; the triceps are drawn helping to straighten them through the middle.',
  },
  // Standing tall, dumbbells in front of the face about chin height, palms toward the face, elbows together in front of the chest (like the top of a curl); the turn of the arms doesn't show from the side. -> Dumbbells pressed to straight arms over the shoulders, palms forward, the elbows having opened out to the sides on the way.
  'arnold-press': {
    profile: [0.6, 1, 0.3],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'turn the arms out to the sides while pressing them overhead' },
      { group: 'triceps', role: 'assist', peak: 0.5, profile: [0.5, 1, 0.3], note: 'straighten the elbows' },
    ],
    why: 'The press starts with the elbows together in front and the palms facing in, then opens the arms out to the sides by about 45% of the way up, so the front and side of the shoulder share the work. The forearms stay upright under the dumbbells, so the lever is the upper arm\'s horizontal reach: at the start, with the elbows low and in front, it is about two thirds of its maximum, which comes as the upper arms pass level (about 40% of the way up); the hardest stretch is from there to about two thirds of the way up, and locked out overhead is easiest.',
  },
  // Seated against a back pad reclined about 8 degrees, hands on the handles just above and in front of the shoulders (about chin height), elbows out to the sides below them, weight stack resting. -> Handles pressed straight up to straight arms, a little in front of the head.
  'machine-shoulder-press': {
    profile: [1, 0.8, 0.3],
    restAtStart: true,
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'press the arms up overhead' },
      { group: 'triceps', role: 'assist', peak: 0.6, profile: [0.5, 1, 0.3], note: 'straighten the elbows' },
    ],
    why: 'The weight stack rests while the handles sit at the bottom, so the muscles are off until it lifts. The handles then ride straight up a guide a constant distance in front of the shoulder joints, so what changes is how bent the arms are: just off the bottom the elbows are most bent and both joints carry long levers; as the arms straighten the guide can take the slight forward lean, and at lockout the straight arms carry the load with little muscle effort. The seat and back pad hold the trunk, so it needs little bracing.',
  },
  // Inverted V on the hands and the balls of the feet: hips high and sharply bent (about 65 degrees between trunk and thighs), arms and legs straight, hands ahead of the shoulders. -> Head lowered to just off the floor in front of the hands, elbows bent to about a right angle with the forearms nearly upright, shoulders moved forward past the hands, hips still high.
  'pike-push-up': {
    profile: [0.3, 0.4, 1],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'push the body back up from the floor' },
      { group: 'triceps', role: 'assist', peak: 0.65, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
    ],
    why: 'The hands carry about half of body weight at the top and over 80% at the bottom, as the shoulders travel forward over and past the hands. With straight arms the load runs down the arms. Half way down the shoulders are right over the hands, so the shoulder muscles carry little turning load and the bending elbows (triceps) carry the middle of the rep; in the bottom half the shoulders move ahead of the hands with the elbows at a right angle, so the shoulders work hardest at the bottom.',
  },
  // Handstand with the back to the wall and the heels resting on it, hands flat about a hand's length from the wall, arms straight, body nearly vertical (leaning about 6 degrees toward the wall). -> Top of the head touching the floor a little in front of the hands, elbows bent to about a right angle and pointing back toward the wall, heels slid down the wall, body leaning about 14 degrees toward it.
  'handstand-push-up': {
    profile: [0.35, 0.5, 1],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'press the whole body up overhead' },
      { group: 'triceps', role: 'assist', peak: 0.7, profile: [0.3, 0.85, 1], note: 'straighten the elbows' },
      { group: 'core', role: 'stabilize', peak: 0.4, note: 'keeps the body straight and the lower back from arching' },
    ],
    why: 'Upside down the arms carry the whole body weight; locked out it runs straight down stacked joints. For the first half the shoulders stay nearly over the hands while the elbows bend, so the triceps carry the middle of the rep; in the second half the shoulders move ahead of the hands (0.07 body heights at the bottom) with the elbows at a right angle, so the bottom, head on the floor, is hardest for the shoulders. The trunk braces to keep the body straight against the wall.',
  },
  // Standing tall facing the camera, dumbbells hanging just out from the sides of the thighs, elbows soft. -> Both arms raised out to the sides to shoulder height, elbows slightly bent, hands no higher than the elbows.
  'lateral-raise': {
    profile: [0.2, 0.65, 1],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'side of the shoulder lifts the arms out to the sides' },
    ],
    why: 'Hanging at the sides the dumbbells have almost no moment arm about the shoulders; as the arms rise it grows to its maximum with the arms level at shoulder height, where the shoulder\'s lifting strength is also lower, so the top is hardest.',
  },
  // Standing tall facing the camera; the working (right) arm hangs across the front of the hips holding a handle from a low pulley on the lifter's left, the free hand holding the machine. -> Working arm raised out to the side to shoulder height, the cable running down across the body to the pulley.
  'cable-lateral-raise': {
    profile: [0.35, 0.9, 1],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'side of the shoulder lifts the arm out against the cable' },
    ],
    why: 'The cable runs from a low pulley on the other side, across the body. With the arm hanging across the front of the hips its lever about the shoulder is already about half its maximum; it is longest about half way up, where the arm is square to the cable, and still about three quarters of that at shoulder height. With the light loads used, the arm\'s own weight adds a lever that is greatest at shoulder height, where the shoulder is also weakest, so the effort keeps rising to the top. Unlike the dumbbell raise there is clear tension at the bottom.',
  },
  // Standing tall side-on, dumbbells against the front of the thighs, arms nearly straight (elbows soft). -> Arms raised straight in front to shoulder height, upper arms about level.
  'front-raise': {
    profile: [0.2, 0.65, 1],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'front of the shoulder lifts the arms forward' },
    ],
    why: 'The same lever as the lateral raise, in front of the body: hanging against the thighs the dumbbells have little moment arm about the shoulders, and it grows to its maximum with the arms level at shoulder height, where the shoulder\'s lifting strength is also lower, so the top is hardest.',
  },
  // Facing the camera, hinged forward about 65 degrees with a flat back and soft knees, dumbbells hanging straight down under the shoulders. -> Arms raised out to the sides until level with the back, elbows slightly bent.
  'rear-delt-fly': {
    profile: [0.2, 0.65, 1],
    muscles: [
      { group: 'shoulders', role: 'main', peak: 1, note: 'rear of the shoulder sweeps the arms out and back' },
      { group: 'back', role: 'assist', peak: 0.6, profile: [0.3, 0.7, 1], note: 'squeezes the shoulder blades together; the lower back holds the hinge' },
    ],
    why: 'Bent over, the dumbbells hang straight down under the shoulders with almost no moment arm; raising them out to the sides moves them away from the shoulder joints until, level with the back, the moment arm is longest and the rear deltoid shortest, so the top is hardest. The middle trapezius and rhomboids pull the shoulder blades together as the arms open, and the lower back holds the hinged trunk still from the start.',
  },
  // Standing tall side-on, knees soft, arms straight with the upper arms angled about 15 degrees forward so the barbell, held palms up, rests against the front of the upper thighs. -> Elbows bent about 140 degrees and drifted a little further forward (upper arms about 20 degrees ahead of the trunk), bar curled to just in front of the shoulders, forearms only about 20 degrees from vertical.
  'barbell-curl': {
    profile: [0.2, 1, 0.5],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bend the elbows' },
    ],
    why: 'On straight elbows the bar\'s weight goes through the locked joints, so the flexors carry almost nothing; once the elbows unlock the bar is already in front of them, and its lever is longest with the forearms around level, the hardest point. Because the upper arms start angled forward to clear the thighs and drift a little more at the top, the forearms finish within about 20 degrees of vertical, where the lever is down to about a third; even with the flexors short and weaker there, the top is only about half as hard.',
  },
  // Standing tall side-on, knees soft, arms straight with the upper arms angled about 15 degrees forward so the EZ bar, held on its angled grips, rests against the front of the upper thighs. -> Elbows bent about 140 degrees and drifted a little further forward (upper arms about 20 degrees ahead of the trunk), bar curled to just in front of the shoulders, forearms only about 20 degrees from vertical.
  'ez-bar-curl': {
    profile: [0.2, 1, 0.5],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bend the elbows' },
    ],
    why: 'Same path as the barbell curl: the flexors carry almost nothing on straight elbows, the bar\'s lever is longest with the forearms around level (the hardest point), and at the top the forearms are within about 20 degrees of vertical, so the lever is down to about a third and the top is only about half as hard even with the flexors shortened. The angled grip turns the forearms partly toward palms-in, giving the brachialis and the forearm\'s brachioradialis a slightly larger share without changing the curve.',
  },
  // Standing tall side-on, arms hanging straight at the sides, a dumbbell in each hand, palms forward. -> Elbows fully bent with the upper arms still at the sides, dumbbells curled up to just in front of the shoulders, forearms still tilted about 30 degrees forward of vertical.
  'dumbbell-curl': {
    profile: [0.2, 1, 0.8],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bend the elbows' },
    ],
    why: 'Hanging at the sides, the dumbbells sit almost straight below the elbows, so the elbow flexors barely work; their lever about the elbows is longest as the forearms pass horizontal, the hardest point. Near the top the lever roughly halves, but with the elbows kept at the sides the shortened flexors are much weaker there, so the top stays fairly hard.',
  },
  // Standing tall side-on, arms hanging straight at the sides, a dumbbell in each hand, palms facing in. -> Elbows bent about 130 degrees with the upper arms still at the sides, dumbbells curled up until their inner ends reach the front of the shoulders, thumbs up, forearms about 45 degrees from vertical.
  'hammer-curl': {
    profile: [0.2, 1, 0.85],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bend the elbows; the forearm\'s brachioradialis helps more with this grip' },
    ],
    why: 'As in the palms-up curl, the dumbbells hang straight below the elbows at the start and have their longest lever with the forearms around level, the hardest point. The hammer curl stops at about 130 degrees of bend with the forearms still about 45 degrees from vertical, so the dumbbells keep about two thirds of their lever at the top while the flexors are less shortened, making the top harder than in the palms-up curl. The palms-in grip gives the brachialis and the forearm\'s brachioradialis a bigger share of the work, which changes who does it, not when it is hardest.',
  },
  // Reclined on a bench about 40 degrees back from upright, back and head on the pad, feet flat, arms hanging straight down behind the line of the trunk, a dumbbell in each hand, palms forward. -> Upper arms still hanging vertically, elbows bent about 140 degrees, dumbbells curled to just in front of and slightly below the shoulders, forearms about 40 degrees from vertical.
  'incline-dumbbell-curl': {
    profile: [0.2, 1, 0.9],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bend the elbows from a full stretch' },
    ],
    why: 'The upper arms hang straight down behind the reclined trunk, so at the start the dumbbells hang below the elbows with no lever while the biceps sit at full stretch (shoulders extended about 40 degrees). The lever is longest with the forearms level; at the top the forearms are still about 40 degrees from vertical, so the dumbbells keep about two thirds of it, and the biceps, lengthened at the shoulder, lose less strength at that bend than in a standing curl, so the top stays nearly as hard as the middle.',
  },
  // Seated on the end of a bench leaning forward about 50 degrees, the working upper arm braced on the inner thigh near the knee and sloping slightly back from the shoulder, arm straight, dumbbell hanging between the legs; the free hand rests on the other knee. -> Elbow bent about 140 degrees with the upper arm still braced, dumbbell curled up in front of and a little below the shoulder, forearm still about 50 degrees from vertical.
  'concentration-curl': {
    profile: [0.2, 0.8, 1],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bends the elbow' },
    ],
    why: 'Braced on the thigh, the upper arm slopes about 10 degrees back from the shoulder, so the hanging dumbbell puts no load on the flexors at the start. The same slope means the forearm stops about 50 degrees from vertical at the top, where the dumbbell still has about three quarters of its longest lever while the flexors are fully shortened, and the forward lean shortens the biceps at the shoulder too. So the top is the hardest point, and the middle, with the longest lever but stronger muscles, is a little easier.',
  },
  // Standing tall side-on facing a low pulley a short step in front of the toes, knees soft, arms straight with the upper arms angled about 15 degrees forward, cable bar against the front of the thighs, cable running down and forward to the pulley. -> Elbows bent about 140 degrees and drifted slightly forward, bar curled to just in front of the shoulders, forearms within about 20 degrees of vertical, cable running steeply down and forward to the pulley.
  'cable-curl': {
    profile: [0.1, 1, 0.8],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bend the elbows against the cable' },
    ],
    why: 'At the start the cable runs about 10 degrees in front of the straight forearms, so it pulls the bar forward rather than bending the elbows down, and the flexors carry nothing. Once the forearms pass the cable\'s line it loads them, with the longest lever around level, the hardest point. At the top the forearms are near vertical, but the cable, angling forward to the pulley, still has about half its longest lever (a barbell keeps about a third there), so with the flexors short the top stays fairly hard.',
  },
  // Standing tall side-on on the middle of the band, arms hanging straight at the sides holding the handles, band only slightly stretched. -> Elbows bent about 140 degrees with the upper arms still at the sides, handles curled up to just in front of the shoulders, band stretched to about 1.75 times its starting length.
  'band-curl': {
    profile: [0.1, 0.7, 1],
    muscles: [
      { group: 'biceps', role: 'main', peak: 1, note: 'bend the elbows; the band pulls harder as it stretches' },
    ],
    why: 'At the start the band runs straight along the forearms and is barely stretched, so there is next to no load. As the hands rise the band stretches to about 1.75 times its starting length and pulls harder, while its lever about the elbows is longest around level; with the pull rising and the flexors shortening, effort peaks in the top third and stays close to that at the top.',
  },
  // Lying on a flat bench, barbell held with a shoulder-width grip at arm's length straight above the shoulders. -> Bar lowered to the bottom of the chest, elbows tucked close to the sides and travelling toward the hips, a little below shoulder level.
  'close-grip-bench-press': {
    profile: [0.25, 0.6, 1],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, profile: [0.3, 1, 0.7], note: 'straighten the elbows, most through the middle of the press' },
      { group: 'chest', role: 'main', peak: 0.9, note: 'drives the arms up from the chest' },
      { group: 'shoulders', role: 'assist', peak: 0.6, note: 'front of the shoulder lifts the tucked arms' },
    ],
    why: 'As in any bench press the bar is easiest to hold over straight arms and hardest at the chest, where it is furthest from the shoulder joints (lever 0 / 0.42 / 1 of maximum). With the hands at shoulder width and the elbows tucked, the elbows travel further toward the hips and the forearms lean back toward the head by about 20 degrees mid-way (12 at the chest), so the elbow\'s lever is longest in the middle of the press and still about 0.7 of that at the chest: the triceps lead through the middle while the chest peaks at the bottom.',
  },
  // Hands on the front edge of a bench behind the hips, arms straight, trunk upright, legs nearly straight out in front with the heels on the floor. -> Hips lowered straight down to below the bench top, close in front of it, elbows bent to a right angle and pointing back, heels still on the floor.
  'bench-dip': {
    profile: [0.3, 0.7, 1],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, note: 'straighten the elbows to lift the body' },
      { group: 'shoulders', role: 'assist', peak: 0.6, note: 'front of the shoulder lowers and lifts the body' },
      { group: 'chest', role: 'assist', peak: 0.45, note: 'lower chest helps push back up' },
    ],
    why: 'The hands carry about 70% of body weight and the heels the rest. With the arms straight the elbows are locked and the load presses them straight, so the triceps hold little; as the hips drop the elbows bend back behind the hands and the elbow\'s lever grows steadily, to about 0.7 of its maximum half way down and most at the bottom, where the elbows reach a right angle. The shoulders stay a constant 0.11 body heights ahead of the hands, so the front of the shoulder carries a large, steady load the whole way.',
  },
  // Straight-arm plank on the toes with the hands together under the chest, body straight from head to heels at about 24 degrees to the floor. -> Chest lowered to just above the hands, elbows tucked along the ribs and pointing back, body still straight.
  'diamond-push-up': {
    profile: [0.3, 0.85, 1],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, note: 'straighten the elbows; the narrow hands make them lead' },
      { group: 'chest', role: 'assist', peak: 0.65, note: 'helps push the body away from the floor' },
      { group: 'shoulders', role: 'assist', peak: 0.5, note: 'front of the shoulder helps push' },
      { group: 'core', role: 'stabilize', peak: 0.35, note: 'keeps the body straight like a plank' },
    ],
    why: 'The hands carry about three quarters of body weight, as in a standard push-up. With them together under the chest the forearms slant in from the elbows to the hands and the shoulders sit further ahead of the hands, so both the elbow and the shoulder levers are longer than in a standard push-up; both build steadily from straight arms to the bottom (about 0.8 of their maximum half way down), so the triceps and chest share one curve.',
  },
  // Standing tall side-on, knees soft, one dumbbell held on end overhead in both cupped hands, arms almost straight and pointing up just forward of vertical beside the head. -> Upper arms still pointing up, elbows bent about 120 degrees (a 60-degree angle at the elbow), forearms tipped back to about 20 degrees below level, dumbbell behind the head at about ear height.
  'overhead-dumbbell-extension': {
    profile: [0.2, 0.75, 1],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, note: 'straighten the elbows; the long head works from a full stretch' },
    ],
    why: 'With the arms almost straight the dumbbell sits on top of the forearms, so the triceps do little. As the forearms tip back behind the head its lever about the elbows grows, is longest with the forearms level (about 85% of the way down) and is still about 95% of that at the bottom, where the forearms are only about 20 degrees below level; the long head is also at its longest there, with the arms overhead and the elbows bent, so the bottom is the hardest point.',
  },
  // Lying on a flat bench, EZ bar held on straight arms above the face, upper arms tilted about 12 degrees toward the head. -> Upper arms unchanged, elbows bent well past a right angle (about 115 degrees of bend), bar lowered beyond the forehead, just clear of the top of the head.
  'skull-crusher': {
    profile: [0.35, 1, 0.8],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, note: 'straighten the elbows; the long head also holds the upper arms still' },
    ],
    why: 'The upper arms lean about 12 degrees toward the head, so even with straight arms the bar sits a little behind the elbows and the triceps already hold it (about a quarter of the largest lever, near full extension where they are weakest). The lever grows as the forearms lower and is longest as they pass horizontal, about two thirds of the way down; at the bottom the forearms point about 38 degrees below horizontal toward the head, so the lever is back to about 80% of its maximum. The middle of the range is the hardest.',
  },
  // Standing close under a high pulley, knees soft, leaning forward about 15 degrees from the hips, elbows pinned at the sides and bent about 100 degrees (forearms just above level), bar at about the bottom of the ribs with the cable hanging straight down onto it. -> Elbows straight, bar pushed down to the front of the upper thighs, upper arms still at the sides; the cable now slants slightly forward up to the pulley.
  'triceps-pushdown': {
    profile: [1, 0.9, 0.5],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, note: 'straighten the elbows' },
    ],
    why: 'The pulley sits straight above the bar at the start, so the cable pulls square to the near-level forearms and its lever about the elbows is at or near its longest from the first moment: holding the bar there is the hardest part. As the bar goes down the cable lines up more with the forearms, and at lockout its lever is down to under a third; the fully shortened triceps are weaker there, so the finish is about half as hard rather than a third.',
  },
  // Hinged forward with the torso about 20 degrees above level and knees slightly bent, upper arm held back along the side of the torso, forearm hanging straight down holding the dumbbell. -> Elbow straightened, forearm in line with the upper arm, dumbbell extended back to just behind the hip.
  'triceps-kickback': {
    profile: [0.2, 0.45, 1],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, note: 'straightens the elbow; the long head also holds the upper arm back' },
    ],
    why: 'With the forearm hanging, the dumbbell is straight below the elbow, so the triceps carry almost nothing (the long head only helps hold the upper arm back). As the forearm swings back its lever about the elbow grows and is longest at lockout, with the arm straight and nearly level, exactly where the triceps are shortest and weakest, so lockout is by far the hardest point.',
  },
  // Standing close under a band looped over a bar overhead, a little in front of the hands, knees soft, leaning forward about 15 degrees, elbows pinned at the sides and bent about 100 degrees (forearms just above level), hands at about the bottom of the ribs, band barely stretched. -> Elbows straight, hands pushed down to the front of the upper thighs, band stretched to about 1.5 times its starting length.
  'band-pushdown': {
    profile: [0.2, 0.85, 1],
    muscles: [
      { group: 'triceps', role: 'main', peak: 1, note: 'straighten the elbows; the band pulls harder as it stretches' },
    ],
    why: 'The band is barely stretched at the start, so although it pulls nearly square to the near-level forearms the load is small. It pulls harder the more it stretches while its lever about the elbows stays long until the last third, so effort builds through the push and peaks over the last quarter. At lockout the band lines up with the forearms and its lever shrinks to about a third, but the pull is at its strongest and the triceps at their shortest, so the finish stays close to the hardest.',
  },
  // Forearm plank: elbows under the shoulders, forearms flat, on the balls of the feet, body in one straight line about 10 degrees above horizontal -> Same position (a hold)
  'plank': {
    profile: [1, 1, 1],
    muscles: [
      { group: 'core', role: 'main', peak: 1, note: 'stops the hips sagging and the lower back arching' },
    ],
    why: 'A hold: gravity pulls the middle of the body toward the floor between the forearms and toes, so the abdominals and obliques work isometrically to keep the spine and pelvis from sagging into an arch; the demand is steady while the position holds.',
  },
  // Side plank facing the camera on the left forearm (elbow under the shoulder) and the outside edge of the stacked feet, body in one straight line about 20 degrees above the floor, top hand resting on the hip with the elbow up -> Same position (a hold)
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
  // Lying on the back with the lower back flat, hips and knees bent 90 degrees with the shins level (tabletop), both arms pointing straight up -> Near leg straightened out until the heel hovers just off the floor while the opposite (far) arm reaches back overhead to hover above the floor; the other arm and leg stay in place
  'dead-bug': {
    profile: [0.4, 0.8, 1],
    muscles: [
      { group: 'core', role: 'main', peak: 1, note: 'keeps the lower back flat as the leg and arm reach out' },
    ],
    why: 'In the tabletop the thighs are vertical, so only the shins\' weight has a lever about the hips; as one leg straightens toward the floor its lever grows (the legs\' combined moment about the hips about 2.4 times the tabletop\'s in the demo), and the hip flexors holding it pull the pelvis toward an arch that the abdominals must resist, with the arm reaching overhead adding a little more. So the extended position is hardest.',
  },
  // Lying on the back, knees bent about 90 degrees with the feet flat, arms crossed on the chest, head and shoulders resting on the floor -> Upper back curled about 34 degrees up so the shoulder blades clear the floor, chin tucked toward the chest, lower back and feet still down
  'crunch': {
    profile: [1, 0.9, 0.8],
    restAtStart: true,
    muscles: [
      { group: 'core', role: 'main', peak: 1, note: 'curls the ribs toward the pelvis' },
    ],
    why: 'Lying flat the floor carries the upper body; the moment the shoulders lift, the head and upper trunk hang on their longest lever, and as the trunk curls up the lever shortens (to about three quarters at the top of the demo\'s curl) while the shortening abdominals lose a little force, so effort stays high but eases slightly toward the top.',
  },
  // Dead hang from an overhand grip, arms straight, legs hanging straight down -> Knees raised above hip height (thighs about 25 degrees above level) with the shins hanging down and the pelvis tucked under, hips drawn back so the body stays balanced under the bar
  'hanging-knee-raise': {
    profile: [0.1, 0.7, 1],
    muscles: [
      { group: 'core', role: 'main', peak: 1, note: 'holds the pelvis against the hip flexors\' pull, then curls it up at the top' },
    ],
    why: 'In the dead hang the legs hang straight below the hips with no lever. As the knees rise the legs\' weight moves ahead of the hips (its lever about 0.7 of the maximum halfway up, near the maximum once the thighs pass level), and over the last part the pelvis tucks under, so the abdominals shorten while they lift the pelvis and legs, whose weight is then furthest ahead of the waist: the top is hardest. The hip flexors do the lifting; the abdominals hold the pelvis against their pull and then curl it.',
  },
  // Dead hang from an overhand grip, arms straight, legs hanging straight down -> Straight legs raised a little past level (about 20 degrees above horizontal) with the pelvis tucked under, hips drawn back so the body stays balanced under the bar
  'hanging-leg-raise': {
    profile: [0.1, 0.7, 1],
    muscles: [
      { group: 'core', role: 'main', peak: 1, note: 'holds the pelvis against the hip flexors\' pull, then curls it up at the top' },
    ],
    why: 'As in the knee raise the legs have no lever in the dead hang; with the knees straight their lever about the hips is about a third longer than in the knee raise and close to its maximum from the time the legs pass level, and over the last part the pelvis tucks under, so the top, with the abdominals shortest and the legs\' weight furthest ahead of the waist, is hardest.',
  },
  // Kneeling below a high pulley with the toes tucked and the hips high over the knees, torso leaning about 16 degrees forward with a straight spine, rope held beside the head -> Spine curled forward about 64 degrees so the upper trunk is about level and the head points at the floor, hips bent only about 14 degrees more
  'cable-crunch': {
    profile: [0.1, 0.85, 1],
    muscles: [
      { group: 'core', role: 'main', peak: 1, note: 'curls the ribs toward the hips against the cable' },
    ],
    why: 'Upright, the cable runs nearly through the spine and its small backward pull about the waist roughly cancels the forward lean of the upper body, so the abdominals only brace. As the spine curls the hands move well ahead of the waist, the cable\'s lever grows fast and outgrows the help from the trunk\'s own weight, so the net load on the abdominals is near its peak by mid-curl and stays there to the end, where the abdominals are shortest and the curl is hardest.',
  },
};

/** The researched entry for an exercise, or one derived from its muscle lists. */
export function engagementFor(exercise: Pick<Exercise, 'id' | 'primary' | 'secondary' | 'tracking'>): Engagement {
  return ENGAGEMENT[exercise.id] ?? defaultEngagement(exercise);
}
