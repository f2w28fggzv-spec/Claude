// Movement patterns for exercise demos. Each returns a Demo whose pose(s)
// goes from the start position (s = 0) to the turnaround (s = 1). Patterns are
// parameterized so one pattern covers many exercises; everything is data the
// renderer draws and the tests feed through the analysis engine.
//
// One file per movement family; shared helpers and conventions in ./shared.ts.
export { FLOOR, mix, reversed } from './shared';
export * from './legs';
export * from './hinge';
export * from './glutes';
export * from './press';
export * from './overhead';
export * from './pull';
export * from './arms';
export * from './core';
export { dir } from '../figure';
