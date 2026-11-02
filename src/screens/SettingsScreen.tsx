import { useRef, useState } from 'preact/hooks';
import { deleteAllRecordings } from '../calibration/store';
import { fromUnit, toUnit } from '../log/stats';
import { deleteAll, exportAll, importAll, loadBodyweight, loadUnit, saveBodyweight, saveUnit } from '../log/store';
import type { Unit } from '../log/types';
import { navigate } from '../router';
import { downloadJson } from '../ui/download';
import { showToast } from '../ui/toast';
import { PRIVACY, Screen } from './Layout';

export const APP_VERSION = '0.5';

/** Units, data backup and the hidden developer tools. */
export function SettingsScreen() {
  const [unit, setUnit] = useState<Unit>(loadUnit);
  const [bodyText, setBodyText] = useState(() => {
    const kg = loadBodyweight();
    return kg === undefined ? '' : String(Number(toUnit(kg, loadUnit()).toFixed(1)));
  });
  const file = useRef<HTMLInputElement>(null);
  const taps = useRef<number[]>([]);

  const pickUnit = (u: Unit) => {
    const kg = loadBodyweight();
    if (kg !== undefined) setBodyText(String(Number(toUnit(kg, u).toFixed(1))));
    setUnit(u);
    saveUnit(u);
  };
  const saveBody = (text: string) => {
    setBodyText(text);
    const n = Number(text.replace(',', '.'));
    if (text.trim() === '') saveBodyweight(null);
    else if (Number.isFinite(n) && n > 0) saveBodyweight(fromUnit(n, unit));
  };
  const restore = async (f: File | undefined) => {
    if (!f) return;
    try {
      const n = importAll(JSON.parse(await f.text()));
      showToast(`Restored ${n} item${n === 1 ? '' : 's'}`);
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      showToast((err as Error).message);
    }
  };
  // Tap the version five times within three seconds to open calibration.
  const tapVersion = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      navigate('/dev/calibrate');
    }
  };

  return (
    <Screen title="Settings" back="log" tab="log">
      <h2 class="field">Weight unit</h2>
      <div class="segmented-2">
        {(['kg', 'lb'] as const).map((u) => (
          <button type="button" class={unit === u ? 'on' : ''} aria-pressed={unit === u} onClick={() => pickUnit(u)}>
            <strong>{u === 'kg' ? 'Kilograms' : 'Pounds'}</strong>
            <small>{u}</small>
          </button>
        ))}
      </div>

      <h2 class="field">Body weight</h2>
      <label class="text-field inline-unit">
        <span class="sr-only">Body weight in {unit}</span>
        <input type="text" inputMode="decimal" placeholder="Optional" value={bodyText} onInput={(e) => saveBody(e.currentTarget.value)} />
        <span class="unit">{unit}</span>
      </label>
      <p class="muted small">
        Counts push-ups, pull-ups, dips and other bodyweight sets in your volume and estimated max (body weight plus any added weight). Saved with
        each workout you log from now on, only on this phone.
      </p>

      <h2 class="field">Your data</h2>
      <p class="muted small">
        {PRIVACY} Your plan, log and settings live only in this browser. Back them up to a file to move them to another phone.
      </p>
      <div class="stack">
        <button type="button" class="secondary" onClick={() => downloadJson(`form-check-backup-${new Date().toISOString().slice(0, 10)}.json`, exportAll())}>
          Back up my data
        </button>
        <button type="button" class="secondary" onClick={() => file.current?.click()}>
          Restore from a backup
        </button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void restore(e.currentTarget.files?.[0])} />
        <button
          type="button"
          class="link danger center"
          onClick={() => {
            if (confirm('Delete your plans, workout log and settings from this phone? This can’t be undone.')) {
              deleteAll();
              void deleteAllRecordings();
              showToast('All data deleted');
              setTimeout(() => (location.hash = '#/'), 400);
            }
          }}
        >
          Delete all my data
        </button>
      </div>

      <h2 class="field">Tools</h2>
      <ul class="rows card">
        <li>
          <a href="#/camera">
            <span class="row-main">
              <strong>Camera test</strong>
              <small>Check that pose tracking works on this phone</small>
            </span>
          </a>
        </li>
      </ul>
      <p class="footer small">
        <button type="button" class="link version" onClick={tapVersion}>
          Form Check {APP_VERSION}
        </button>
      </p>
    </Screen>
  );
}
