import { EXERCISES } from '../data/exercises';
import { DemoFrame, ExerciseDemo, bounds } from './ExerciseDemo';
import { Screen } from './Layout';

/**
 * Hidden developer page (#/dev/demos): every exercise demo on one page.
 * ?still shows the start and turnaround frames for review.
 */
export function DevDemos({ still }: { still: boolean }) {
  return (
    <Screen title="All demos" back="">
      <div class="dev-grid">
        {EXERCISES.map((e) => {
          const box = bounds(e.demo);
          return (
            <div class="dev-cell">
              <strong class="small">{e.name}</strong>
              {still ? (
                <div class="demo-pair">
                  {[0, 0.5, 1].map((s) => (
                    <svg class="demo-svg" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}>
                      <DemoFrame demo={e.demo} s={s} box={box} />
                    </svg>
                  ))}
                </div>
              ) : (
                <ExerciseDemo exercise={e} compact />
              )}
            </div>
          );
        })}
      </div>
    </Screen>
  );
}
