// The lifter's profile: kept only on this device (localStorage), numbers and
// a name only. Used to adjust plans (sex, age), count bodyweight sets (body
// weight lives in the log store) and pick the body drawing.

export type Sex = 'female' | 'male';
export type Figure = 'female' | 'male';

export interface Profile {
  /** What the app calls you. Optional. */
  name?: string;
  heightCm?: number;
  /** For training adjustments; unset or 'unspecified' uses the general guidance. */
  sex?: Sex | 'unspecified';
  /** Year of birth (age is worked out from it, so it stays right next year). */
  birthYear?: number;
  /** Body drawing for icons and the body map. Defaults from `sex`. */
  figure?: Figure;
  /** When the terms and privacy policy were accepted, and which version. */
  termsAcceptedAt?: string;
  termsVersion?: string;
}

/** Bump when the terms or privacy policy change in a way people must re-accept. */
export const TERMS_VERSION = '2026-11-08';

const KEY = 'formcheck.v1.profile';
let cache: Profile | null = null;

export function loadProfile(): Profile {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    cache = raw && typeof raw === 'object' ? sanitize(raw as Profile) : {};
  } catch {
    cache = {};
  }
  return cache;
}

export function saveProfile(p: Profile): void {
  cache = sanitize(p);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Storage blocked: keep it for this visit.
  }
}

/** Forget the cached copy (after a restore or "delete all"). */
export const resetProfileCache = () => {
  cache = null;
};

function sanitize(p: Profile): Profile {
  const out: Profile = {};
  if (typeof p.name === 'string' && p.name.trim()) out.name = p.name.trim().slice(0, 40);
  if (typeof p.heightCm === 'number' && p.heightCm >= 80 && p.heightCm <= 250) out.heightCm = Math.round(p.heightCm);
  if (p.sex === 'female' || p.sex === 'male' || p.sex === 'unspecified') out.sex = p.sex;
  if (typeof p.birthYear === 'number' && p.birthYear >= 1900 && p.birthYear <= 2100) out.birthYear = Math.round(p.birthYear);
  if (p.figure === 'female' || p.figure === 'male') out.figure = p.figure;
  if (typeof p.termsAcceptedAt === 'string') out.termsAcceptedAt = p.termsAcceptedAt;
  if (typeof p.termsVersion === 'string') out.termsVersion = p.termsVersion;
  return out;
}

/** Age in whole years (approximate: from the year of birth). */
export function ageOf(p: Profile, now = new Date()): number | undefined {
  return p.birthYear === undefined ? undefined : now.getFullYear() - p.birthYear;
}

export const birthYearFromAge = (age: number, now = new Date()) => now.getFullYear() - Math.round(age);

/** The sex used for plan adjustments, if the lifter gave one. */
export const trainingSex = (p: Profile): Sex | undefined => (p.sex === 'female' || p.sex === 'male' ? p.sex : undefined);

/** Body drawing: the lifter's choice, else from sex, else the male drawing. */
export const figureOf = (p: Profile): Figure => p.figure ?? (p.sex === 'female' ? 'female' : 'male');

export const termsAccepted = (p: Profile) => p.termsVersion === TERMS_VERSION && !!p.termsAcceptedAt;

/** Height for display: cm with kg, feet and inches with lb. */
export function formatHeight(cm: number, imperial: boolean): string {
  if (!imperial) return `${Math.round(cm)} cm`;
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)} ft ${inches % 12} in`;
}
