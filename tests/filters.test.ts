import { describe, expect, it } from 'vitest';
import { EXERCISES, getExercise } from '../src/data/exercises';
import { NO_FILTERS, equipmentCategories, filterExercises, sanitizeFilters, sheetFilterCount } from '../src/data/filters';
import { MUSCLE_GROUPS } from '../src/data/types';

const ex = (id: string) => getExercise(id)!;
const ids = (f: Partial<typeof NO_FILTERS>, q = '') => filterExercises(EXERCISES, { ...NO_FILTERS, ...f }, q).map((e) => e.id);

describe('library filters', () => {
  it('shows everything with no filters', () => {
    expect(ids({})).toHaveLength(EXERCISES.length);
  });

  it('maps equipment to filter groups', () => {
    expect(equipmentCategories(ex('bench-press'))).toEqual(['barbell']);
    expect(equipmentCategories(ex('ez-bar-curl'))).toEqual(['barbell']);
    expect(equipmentCategories(ex('push-up'))).toEqual(['bodyweight']);
    expect(equipmentCategories(ex('pull-up'))).toEqual(['bodyweight']);
    expect(equipmentCategories(ex('bench-dip'))).toEqual(['bodyweight']);
    expect(equipmentCategories(ex('goblet-squat'))).toEqual(['dumbbell']);
    expect(equipmentCategories(ex('lat-pulldown'))).toEqual(['cable']);
  });

  it('filters by equipment (any selected item matches)', () => {
    const db = ids({ equipment: ['dumbbell'] });
    expect(db).toContain('goblet-squat');
    expect(db).not.toContain('bench-press');
    const both = ids({ equipment: ['dumbbell', 'kettlebell'] });
    expect(both).toContain('kettlebell-swing');
    expect(both).toContain('goblet-squat');
  });

  it('combines muscle, equipment, difficulty, type and analysis level', () => {
    const r = filterExercises(EXERCISES, { muscle: 'chest', equipment: ['bodyweight'], levels: ['beginner'], types: ['compound'], fullOnly: false });
    expect(r.length).toBeGreaterThan(0);
    for (const e of r) {
      expect(e.primary).toContain('chest');
      expect(equipmentCategories(e)).toContain('bodyweight');
      expect(e.minLevel).toBe('beginner');
      expect(e.role).toBe('compound');
    }
    expect(ids({ fullOnly: true }).sort()).toEqual(
      ['back-squat', 'barbell-row', 'bench-press', 'deadlift', 'overhead-press', 'romanian-deadlift'].sort(),
    );
  });

  it('searches by name', () => {
    expect(ids({}, 'squat').every((id) => ex(id).name.toLowerCase().includes('squat'))).toBe(true);
    expect(ids({ equipment: ['machine'] }, 'squat')).toEqual(['hack-squat']);
  });

  it('counts active sheet filters', () => {
    expect(sheetFilterCount(NO_FILTERS)).toBe(0);
    expect(sheetFilterCount({ ...NO_FILTERS, muscle: 'back', equipment: ['band', 'cable'], fullOnly: true })).toBe(3);
  });

  it('restores saved filters safely', () => {
    expect(sanitizeFilters(null, MUSCLE_GROUPS)).toEqual(NO_FILTERS);
    expect(sanitizeFilters({ muscle: 'wings', equipment: ['barbell', 'rocket'], levels: 'x', fullOnly: 'yes' }, MUSCLE_GROUPS)).toEqual({
      ...NO_FILTERS,
      equipment: ['barbell'],
    });
    expect(sanitizeFilters({ muscle: 'core', types: ['isolation'] }, MUSCLE_GROUPS)).toEqual({ ...NO_FILTERS, muscle: 'core', types: ['isolation'] });
  });
});
