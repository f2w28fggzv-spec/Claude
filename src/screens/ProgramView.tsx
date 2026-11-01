import { getExercise } from '../data/exercises';
import { MUSCLE_LABELS } from '../data/types';
import { EQUIPMENT_SETTING_LABELS, type Program, type ProgramItem } from '../program/builder';
import { navigate } from '../router';
import { deleteProgram, loadPrograms } from '../storage';
import { Screen } from './Layout';

// Holds a program the device refused to store, so it can still be shown.
let unsaved: Program | undefined;
export const rememberUnsaved = (p: Program) => (unsaved = p);

const LEVEL: Record<Program['inputs']['level'], string> = {
  beginner: 'New',
  intermediate: 'Some experience',
  advanced: 'Experienced',
};

const fmtRest = (s: number) => (s >= 120 ? `${s / 60} min rest` : `${s} s rest`);
const fmtSets = (i: ProgramItem) => `${i.sets} × ${i.reps[0]}–${i.reps[1]}${i.unit === 'seconds' ? ' s' : ''}`;

export const planSubtitle = (p: Program) =>
  `${p.days.length} day${p.days.length === 1 ? '' : 's'} a week · ${LEVEL[p.inputs.level]} · ${EQUIPMENT_SETTING_LABELS[p.inputs.equipment]}`;

/** The days of a plan with their exercises. Shared by the Plan tab and saved plans. */
export function PlanDays({ program }: { program: Program }) {
  return (
    <>
      {program.notes.map((n) => (
        <p class="note">{n}</p>
      ))}
      {program.days.map((day) => (
        <section class="card day">
          <header class="day-head">
            <h2>{day.name}</h2>
            <span class="muted small">{day.groups.map((g) => MUSCLE_LABELS[g]).join(' · ')}</span>
          </header>
          <ul class="rows">
            {day.items.map((item) => {
              const e = getExercise(item.exerciseId);
              return (
                <li>
                  <a href={`#/exercise/${item.exerciseId}`}>
                    <span class="row-main">
                      <strong>{e?.name ?? item.exerciseId}</strong>
                      <small>
                        {fmtRest(item.restSec)}
                        {item.perSide ? ' · each side' : ''}
                      </small>
                    </span>
                    <span class="sets">{fmtSets(item)}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <details class="more">
        <summary>Weekly sets per muscle</summary>
        <table class="volume">
          <tbody>
            {program.inputs.groups.map((g) => (
              <tr>
                <th>{MUSCLE_LABELS[g]}</th>
                <td>{program.weeklySets[g] ?? 0}</td>
                <td class="muted small">target {program.targets[g]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="muted small">Sets where a muscle only assists count as half.</p>
      </details>
    </>
  );
}

export function ProgramView({ id }: { id: string }) {
  const saved = loadPrograms().find((p) => p.id === id);
  const program = saved ?? (unsaved?.id === id ? unsaved : undefined);
  if (!program) {
    return (
      <Screen title="Plan not found" back="" tab="plan">
        <p class="muted">This plan isn’t saved on this phone.</p>
      </Screen>
    );
  }
  const remove = () => {
    if (confirm('Delete this plan?')) {
      deleteProgram(program.id);
      navigate('/');
    }
  };
  return (
    <Screen title="Your plan" subtitle={planSubtitle(program)} back="" tab="plan">
      {!saved && <p class="note">Your browser wouldn’t let us save this plan, so it will be gone when you close the page.</p>}
      <PlanDays program={program} />
      {saved && (
        <button type="button" class="link danger center" onClick={remove}>
          Delete this plan
        </button>
      )}
    </Screen>
  );
}
