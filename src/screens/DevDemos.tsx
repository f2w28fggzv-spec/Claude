import { engagementFor } from '../data/engagement';
import { EXERCISES } from '../data/exercises';
import { levelsAt } from '../demo/engagement';
import { demoBounds, frameMarkup, viewBoxOf } from '../demo/render';
import { ExerciseDemo } from './ExerciseDemo';
import { Screen } from './Layout';

/**
 * Hidden developer page (#/dev/demos): every exercise demo on one page.
 * ?still shows the start, middle and turnaround frames for review;
 * ?ids=a,b limits the page to those exercises. For PNG sheets of the same
 * frames without the app, see tools/demo-sheets.
 */
export function DevDemos({ still, ids }: { still: boolean; ids?: string[] }) {
  const list = ids?.length ? EXERCISES.filter((e) => ids.includes(e.id)) : EXERCISES;
  return (
    <Screen title="All demos" back="">
      <div class="dev-grid">
        {list.map((e) => {
          const box = demoBounds(e.demo);
          const spec = engagementFor(e);
          return (
            <div class="dev-cell">
              <strong class="small">{e.name}</strong>
              {still ? (
                <div class="demo-pair">
                  {[0, 0.5, 1].map((s) => (
                    <svg
                      class="demo-svg"
                      viewBox={viewBoxOf(box)}
                      dangerouslySetInnerHTML={{ __html: frameMarkup(e.demo, s, levelsAt(spec, { phase: 'out', s, u: s, action: 'lifting' }), box, `${e.id}-${s * 2}`) }}
                    />
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
