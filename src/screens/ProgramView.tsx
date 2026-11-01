import { getExercise } from '../data/exercises';
import { MUSCLE_LABELS } from '../data/types';
import { EQUIPMENT_SETTING_LABELS, type Program, type ProgramItem } from '../program/builder';
import { navigate } from '../router';
import { deleteProgram, loadPrograms } from '../storage';
import { Screen } from './Layout';

// Holds a program the device refused to store, so it can still be shown.
let unsaved: Program | undefined;
export const rememberUnsaved = (p: Program) => (unsaved = p);

const fmtRest = (s: number) => (s >= 120 ? `${s / 60} min` : `${s} s`);
const fmtItem = (i: ProgramItem) =>
  `${i.sets} × ${i.reps[0]}–${i.reps[1]} ${i.unit === 'seconds' ? 's' : 'reps'}${i.perSide ? ' each side' : ''} · rest ${fmtRest(i.restSec)}`;

export function ProgramView({ id }: { id: string }) {
  const saved = loadPrograms().find((p) => p.id === id);
  const program = saved ?? (unsaved?.id === id ? unsaved : undefined);
  if (!program) {
    return (
      <Screen title="Program not found" back="">
        <p>This program isn't saved on this device.</p>
      </Screen>
    );
  }
  const remove = () => {
    if (confirm('Delete this program?')) {
      deleteProgram(program.id);
      navigate('/');
    }
  };
  const { inputs } = program;

  return (
    <Screen title={program.name} back="">
      <p class="muted">
        {inputs.level[0].toUpperCase() + inputs.level.slice(1)} · {EQUIPMENT_SETTING_LABELS[inputs.equipment]} ·{' '}
        {program.days.length} training day{program.days.length === 1 ? '' : 's'} a week
      </p>
      {!saved && <p class="warn">Your browser wouldn't let us save this program, so it will be lost when you close the page.</p>}
      {program.notes.map((n) => (
        <p class="note">{n}</p>
      ))}

      {program.days.map((day) => (
        <section class="card day">
          <h2>{day.name}</h2>
          <p class="muted small">{day.groups.map((g) => MUSCLE_LABELS[g]).join(' · ')}</p>
          <ol class="items">
            {day.items.map((item) => {
              const e = getExercise(item.exerciseId);
              return (
                <li>
                  <a href={`#/exercise/${item.exerciseId}`}>{e?.name ?? item.exerciseId}</a>
                  <span class="muted small">{fmtItem(item)}</span>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <section class="card">
        <h2>Weekly sets per muscle</h2>
        <p class="muted small">Sets where a muscle only assists count as half.</p>
        <table class="volume">
          <tbody>
            {inputs.groups.map((g) => (
              <tr>
                <th>{MUSCLE_LABELS[g]}</th>
                <td>{program.weeklySets[g] ?? 0}</td>
                <td class="muted small">target {program.targets[g]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {saved && (
        <button type="button" class="danger" onClick={remove}>
          Delete program
        </button>
      )}
    </Screen>
  );
}
