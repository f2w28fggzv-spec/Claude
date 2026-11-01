import { loadGroups, loadPrograms } from '../storage';
import { MUSCLE_LABELS } from '../data/types';
import { PRIVACY } from './Layout';

export function Home() {
  const groups = loadGroups();
  const programs = loadPrograms();
  return (
    <main>
      <header class="top">
        <h1>Form Check</h1>
      </header>
      <p class="privacy">{PRIVACY}</p>

      <section class="card">
        <h2>Your muscle groups</h2>
        {groups.length === 0 ? (
          <p class="muted">Pick the muscle groups you want to train. They decide your program and which exercises you see.</p>
        ) : (
          <div class="chips static">
            {groups.map((g) => (
              <span class="chip on">{MUSCLE_LABELS[g]}</span>
            ))}
          </div>
        )}
        <a class="button" href="#/groups">
          {groups.length === 0 ? 'Choose muscle groups' : 'Change muscle groups'}
        </a>
      </section>

      <nav class="stack">
        <a class={`button ${groups.length ? '' : 'disabled'}`} href={groups.length ? '#/build' : undefined}>
          Build a program
        </a>
        <a class="button secondary" href="#/library">
          Exercise library
        </a>
      </nav>

      {programs.length > 0 && (
        <section>
          <h2>Saved programs</h2>
          <ul class="list">
            {programs.map((p) => (
              <li>
                <a href={`#/program/${p.id}`}>
                  <strong>{p.name}</strong>
                  <span class="muted">
                    {p.inputs.level} · {p.days.length} days · {new Date(p.createdAt).toLocaleDateString()}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p class="footer">
        <a href="#/camera">Camera test (live pose overlay)</a>
      </p>
    </main>
  );
}
