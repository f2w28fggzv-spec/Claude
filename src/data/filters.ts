// Exercise library filters (Exercises tab). Pure functions so they can be tested.
import type { Equipment, Exercise, Level, MuscleGroup } from './types';

/** Equipment groups shown as filter chips. */
export const EQUIPMENT_FILTERS = ['barbell', 'dumbbell', 'kettlebell', 'bodyweight', 'cable', 'machine', 'band'] as const;
export type EquipmentFilter = (typeof EQUIPMENT_FILTERS)[number];

export const EQUIPMENT_FILTER_LABELS: Record<EquipmentFilter, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbells',
  kettlebell: 'Kettlebell',
  bodyweight: 'Bodyweight',
  cable: 'Cable',
  machine: 'Machine',
  band: 'Band',
};

export const LEVEL_FILTER_LABELS: Record<Level, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const TYPE_LABELS: Record<Exercise['role'], string> = {
  compound: 'Compound (multi-joint)',
  isolation: 'Isolation (single joint)',
};

export interface LibraryFilters {
  muscle: MuscleGroup | 'all';
  equipment: EquipmentFilter[];
  levels: Level[];
  types: Exercise['role'][];
  fullOnly: boolean;
}

export const NO_FILTERS: LibraryFilters = { muscle: 'all', equipment: [], levels: [], types: [], fullOnly: false };

/** No weights needed: bodyweight plus things to hang from or lean on. */
const UNLOADED = new Set<Equipment>(['bodyweight', 'pullupBar', 'dipBars', 'bench']);

/** Done with your own body as the load (weight can be added on top). */
export const isBodyweight = (e: Exercise) => e.equipment.every((q) => UNLOADED.has(q));

/** Which equipment chips an exercise matches. */
export function equipmentCategories(e: Exercise): EquipmentFilter[] {
  const out = new Set<EquipmentFilter>();
  for (const q of e.equipment) {
    if (q === 'barbell' || q === 'ezBar') out.add('barbell');
    if (q === 'dumbbell') out.add('dumbbell');
    if (q === 'kettlebell') out.add('kettlebell');
    if (q === 'cable') out.add('cable');
    if (q === 'machine') out.add('machine');
    if (q === 'band') out.add('band');
  }
  if (isBodyweight(e)) out.add('bodyweight');
  return [...out];
}

/**
 * Exercises matching every active filter group. Within a group (e.g. two
 * equipment chips) any match counts.
 */
export function filterExercises(list: Exercise[], f: LibraryFilters, query = ''): Exercise[] {
  const q = query.trim().toLowerCase();
  return list.filter(
    (e) =>
      (f.muscle === 'all' || e.primary.includes(f.muscle)) &&
      (f.equipment.length === 0 || equipmentCategories(e).some((c) => f.equipment.includes(c))) &&
      (f.levels.length === 0 || f.levels.includes(e.minLevel)) &&
      (f.types.length === 0 || f.types.includes(e.role)) &&
      (!f.fullOnly || e.analysis === 'full') &&
      (!q || e.name.toLowerCase().includes(q)),
  );
}

/** Number of active filters in the sheet (the muscle row is counted separately). */
export const sheetFilterCount = (f: LibraryFilters) =>
  f.equipment.length + f.levels.length + f.types.length + (f.fullOnly ? 1 : 0);

/** Restores saved filters, dropping anything no longer valid. */
export function sanitizeFilters(raw: unknown, muscles: readonly MuscleGroup[]): LibraryFilters {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<LibraryFilters>;
  const pick = <T,>(v: unknown, allowed: readonly T[]): T[] => (Array.isArray(v) ? allowed.filter((a) => v.includes(a)) : []);
  return {
    muscle: r.muscle && (muscles as readonly string[]).includes(r.muscle) ? r.muscle : 'all',
    equipment: pick(r.equipment, EQUIPMENT_FILTERS),
    levels: pick(r.levels, ['beginner', 'intermediate', 'advanced'] as const),
    types: pick(r.types, ['compound', 'isolation'] as const),
    fullOnly: r.fullOnly === true,
  };
}
