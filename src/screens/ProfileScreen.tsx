import { useState } from 'preact/hooks';
import { fromUnit, toUnit } from '../log/stats';
import { loadBodyweight, loadUnit, saveBodyweight } from '../log/store';
import { ageOf, birthYearFromAge, figureOf, loadProfile, saveProfile, type Figure, type Profile, type Sex } from '../profile';
import { navigate } from '../router';
import { showToast } from '../ui/toast';
import { BodyFigure } from './anatomy';
import { Screen } from './Layout';

const num = (v: string): number | undefined => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
};
const show = (n: number | undefined, digits = 1) => (n === undefined ? '' : String(Number(n.toFixed(digits))));

const SEXES: { id: Sex | 'unspecified'; label: string }[] = [
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
  { id: 'unspecified', label: 'Prefer not to say' },
];

/** Your details, kept only on this phone. `setup` is the first-launch version. */
export function ProfileScreen({ setup = false }: { setup?: boolean }) {
  const unit = loadUnit();
  const imperial = unit === 'lb';
  const p0 = loadProfile();
  const bw0 = loadBodyweight();
  const [name, setName] = useState(p0.name ?? '');
  const [weight, setWeight] = useState(show(bw0 === undefined ? undefined : toUnit(bw0, unit)));
  const inches0 = p0.heightCm === undefined ? undefined : Math.round(p0.heightCm / 2.54);
  const [cm, setCm] = useState(show(p0.heightCm, 0));
  const [ft, setFt] = useState(inches0 === undefined ? '' : String(Math.floor(inches0 / 12)));
  const [inch, setInch] = useState(inches0 === undefined ? '' : String(inches0 % 12));
  const [age, setAge] = useState(show(ageOf(p0), 0));
  const [sex, setSex] = useState<Sex | 'unspecified' | undefined>(p0.sex);
  const [figure, setFigure] = useState<Figure | undefined>(p0.figure);
  const shownFigure = figure ?? figureOf({ sex });

  const save = () => {
    const heightCm = imperial
      ? num(ft) !== undefined || num(inch) !== undefined
        ? ((num(ft) ?? 0) * 12 + (num(inch) ?? 0)) * 2.54
        : undefined
      : num(cm);
    const a = num(age);
    if (a !== undefined && (a < 13 || a > 110)) return showToast('Form Check is for people aged 13 and over');
    const w = num(weight);
    if (w !== undefined && (w <= 0 || fromUnit(w, unit) > 400)) return showToast('Check your body weight');
    const next: Profile = {
      ...loadProfile(),
      name: name.trim() || undefined,
      heightCm: heightCm && heightCm >= 80 && heightCm <= 250 ? heightCm : undefined,
      birthYear: a === undefined ? undefined : birthYearFromAge(a),
      sex,
      figure,
    };
    saveProfile(next);
    saveBodyweight(w === undefined ? null : fromUnit(w, unit));
    showToast('Profile saved on this phone');
    navigate(setup ? '/' : '/settings');
  };

  return (
    <Screen
      title={setup ? 'About you' : 'Profile'}
      subtitle={setup ? 'Optional · used to tailor your plan' : 'Kept only on this phone'}
      back={setup ? undefined : 'settings'}
      action={
        <button type="button" onClick={save}>
          {setup ? 'Continue' : 'Save profile'}
        </button>
      }
    >
      <label class="text-field">
        <span>Name (optional)</span>
        <input type="text" value={name} maxLength={40} autoComplete="given-name" placeholder="What should we call you?" onInput={(e) => setName(e.currentTarget.value)} />
      </label>

      <div class="field-pair">
        <label class="text-field">
          <span>Body weight ({unit})</span>
          <input type="text" inputMode="decimal" value={weight} placeholder="Optional" onInput={(e) => setWeight(e.currentTarget.value)} />
        </label>
        <label class="text-field">
          <span>Age</span>
          <input type="text" inputMode="numeric" value={age} placeholder="Optional" onInput={(e) => setAge(e.currentTarget.value)} />
        </label>
      </div>
      {imperial ? (
        <div class="field-pair">
          <label class="text-field">
            <span>Height (ft)</span>
            <input type="text" inputMode="numeric" value={ft} placeholder="Optional" onInput={(e) => setFt(e.currentTarget.value)} />
          </label>
          <label class="text-field">
            <span>(in)</span>
            <input type="text" inputMode="numeric" value={inch} onInput={(e) => setInch(e.currentTarget.value)} />
          </label>
        </div>
      ) : (
        <label class="text-field">
          <span>Height (cm)</span>
          <input type="text" inputMode="numeric" value={cm} placeholder="Optional" onInput={(e) => setCm(e.currentTarget.value)} />
        </label>
      )}

      <h2 class="field">Sex (recommended)</h2>
      <div class="segmented-3" role="radiogroup" aria-label="Sex">
        {SEXES.map((s) => (
          <button type="button" role="radio" aria-checked={sex === s.id} class={sex === s.id ? 'on' : ''} onClick={() => setSex(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <p class="muted small">
        Plans follow the same research for everyone: men and women build muscle and strength at similar rates. With “Female”, rest between sets is about 20% shorter,
        because women tend to recover faster between sets. Nothing changes with your cycle: research shows no meaningful effect on lifting.
      </p>

      <h2 class="field">Body drawing</h2>
      <div class="figure-choice" role="radiogroup" aria-label="Body drawing">
        {(['female', 'male'] as const).map((f) => (
          <button type="button" role="radio" aria-checked={shownFigure === f} class={shownFigure === f ? 'on' : ''} onClick={() => setFigure(f)}>
            <BodyFigure view="front" figure={f} class="muscle-icon" muscleClass={(g) => (g === 'chest' || g === 'quads' ? 'mi-on' : 'mi-off')} />
            <span>{f === 'female' ? 'Female body' : 'Male body'}</span>
          </button>
        ))}
      </div>

      <section class="card how-used">
        <h2>How this is used</h2>
        <ul class="tips">
          <li>
            <span>
              <strong>Age</strong> — under 18 and 65 and over: no sets below 8 reps, as youth and older-adult guidelines recommend.
            </span>
          </li>
          <li>
            <span>
              <strong>Body weight</strong> — counts push-ups, pull-ups and other bodyweight sets in your volume and estimated max.
            </span>
          </li>
          <li>
            <span>
              <strong>Sex</strong> — rest times, and the body drawing unless you pick one.
            </span>
          </li>
          <li>
            <span>
              <strong>Height</strong> — shown on your profile only. Research doesn't support changing a plan by height, so it isn't used for that.
            </span>
          </li>
        </ul>
        <p class="muted small">Everything stays on this phone. Nothing is sent anywhere. New plans use your profile; rebuild a plan to apply changes.</p>
      </section>
    </Screen>
  );
}
