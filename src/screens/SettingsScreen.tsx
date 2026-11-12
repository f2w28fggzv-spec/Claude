import { useEffect, useRef, useState } from 'preact/hooks';
import { deleteAllRecordings } from '../calibration/store';
import { formatWeight } from '../log/stats';
import { deleteAll, exportAll, importAll, loadBodyweight, loadUnit, saveUnit } from '../log/store';
import { ageOf, formatHeight, loadProfile } from '../profile';
import { deleteAllSets, deleteAllVideos, loadSets } from '../sets/sets';
import type { Unit } from '../log/types';
import { navigate } from '../router';
import { downloadJson } from '../ui/download';
import { showToast } from '../ui/toast';
import { Icon } from './icons';
import { PRIVACY, Screen } from './Layout';

export const APP_VERSION = '0.7';

/** Units, data backup and the hidden developer tools. */
export function SettingsScreen() {
  const [unit, setUnit] = useState<Unit>(loadUnit);
  const file = useRef<HTMLInputElement>(null);
  const taps = useRef<number[]>([]);

  const pickUnit = (u: Unit) => {
    setUnit(u);
    saveUnit(u);
  };
  const [stored, setStored] = useState<{ sets: number; videos: number; bytes: number } | null>(null);
  const refreshStored = () =>
    void loadSets().then((all) =>
      setStored({ sets: all.length, videos: all.filter((m) => m.video).length, bytes: all.reduce((n, m) => n + (m.video?.bytes ?? 0), 0) }),
    );
  useEffect(refreshStored, []);
  const profile = loadProfile();
  const bw = loadBodyweight();
  const age = ageOf(profile);
  const summary = [
    bw !== undefined ? formatWeight(bw, unit) : '',
    profile.heightCm ? formatHeight(profile.heightCm, unit === 'lb') : '',
    age !== undefined ? `${age} years` : '',
    profile.sex === 'female' ? 'Female' : profile.sex === 'male' ? 'Male' : '',
  ].filter(Boolean);
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

      <h2 class="field">Profile</h2>
      <ul class="rows card">
        <li>
          <a href="#/profile">
            <span class="row-main">
              <strong>{profile.name ?? 'Your profile'}</strong>
              <small>{summary.length ? summary.join(' · ') : 'Body weight, height, age and sex: tailors your plan'}</small>
            </span>
            <Icon name="chevron" size={18} />
          </a>
        </li>
      </ul>

      <h2 class="field">Saved sets</h2>
      <p class="muted small">
        {stored
          ? `${stored.sets} saved set${stored.sets === 1 ? '' : 's'} on this phone, ${stored.videos} with video (${(stored.bytes / 1e6).toFixed(1)} MB). Replays are kept for your last 60 checks; videos until you delete them.`
          : 'Loading…'}
      </p>
      {stored && stored.videos > 0 && (
        <button
          type="button"
          class="secondary"
          onClick={() => {
            if (!confirm('Delete every saved video? Replays and results stay.')) return;
            void deleteAllVideos().then(() => {
              showToast('Saved videos deleted');
              refreshStored();
            });
          }}
        >
          Delete all saved videos
        </button>
      )}

      <h2 class="field">Your data</h2>
      <p class="muted small">
        {PRIVACY} Your plan, log, profile and settings live only in this browser. Back them up to a file to move them to another phone (saved videos and replays aren’t included in backups).
      </p>
      <div class="stack">
        <button type="button" class="secondary" onClick={() => downloadJson(`fitee-backup-${new Date().toISOString().slice(0, 10)}.json`, exportAll())}>
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
            if (confirm('Delete your plans, workout log, profile, saved sets and videos, and settings from this phone? This can’t be undone.')) {
              deleteAll();
              void deleteAllRecordings();
              void deleteAllSets();
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
      <h2 class="field">Legal</h2>
      <ul class="rows card">
        <li>
          <a href="#/terms">
            <span class="row-main">
              <strong>Terms of service</strong>
            </span>
            <Icon name="chevron" size={18} />
          </a>
        </li>
        <li>
          <a href="#/privacy">
            <span class="row-main">
              <strong>Privacy policy</strong>
            </span>
            <Icon name="chevron" size={18} />
          </a>
        </li>
      </ul>
      <p class="footer small">
        <button type="button" class="link version" onClick={tapVersion}>
          fitee {APP_VERSION}
        </button>
      </p>
    </Screen>
  );
}
