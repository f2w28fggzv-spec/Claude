import { useState } from 'preact/hooks';
import { MUSCLE_GROUPS } from '../data/types';
import { deleteProgram, loadPrograms } from '../storage';
import { Icon, MuscleIcon } from './icons';
import { PRIVACY, Screen } from './Layout';
import { PlanDays, planSubtitle } from './ProgramView';

/** Plan tab: your newest plan, or a single way to create one. */
export function Home() {
  const [, refresh] = useState(0);
  const programs = loadPrograms();
  const [current, ...older] = programs;

  if (!current) {
    return (
      <Screen title="Form Check" tab="plan">
        <section class="hero">
          <div class="hero-icons" aria-hidden="true">
            {MUSCLE_GROUPS.slice(0, 5).map((g) => (
              <MuscleIcon group={g} size={34} />
            ))}
          </div>
          <h2>Train smarter with your phone camera</h2>
          <p class="muted">Pick the muscles you want to train, get a weekly plan, and get technique feedback on every exercise.</p>
          <a class="button big" href="#/groups">
            Create my plan
          </a>
          <a class="link center" href="#/library">
            Or browse exercises
          </a>
        </section>
        <p class="privacy small center">{PRIVACY}</p>
      </Screen>
    );
  }

  return (
    <Screen title="Your plan" subtitle={planSubtitle(current)} tab="plan">
      <PlanDays program={current} />
      <a class="button secondary" href="#/groups">
        <Icon name="plus" size={18} /> New plan
      </a>
      {older.length > 0 && (
        <details class="more">
          <summary>Earlier plans ({older.length})</summary>
          <ul class="rows">
            {older.map((p) => (
              <li>
                <a href={`#/program/${p.id}`}>
                  <span class="row-main">
                    <strong>{p.name}</strong>
                    <small>{new Date(p.createdAt).toLocaleDateString()}</small>
                  </span>
                  <Icon name="chevron" size={18} />
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p class="footer small">
        <button
          type="button"
          class="link"
          onClick={() => {
            if (confirm('Delete your current plan?')) {
              deleteProgram(current.id);
              refresh((n) => n + 1);
            }
          }}
        >
          Delete plan
        </button>
        {' · '}
        <a href="#/camera">Camera test</a>
      </p>
    </Screen>
  );
}
