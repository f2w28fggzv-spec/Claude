import { describe, expect, it } from 'vitest';
import { EXERCISES_BY_ID } from '../src/data/exercises';
import { LEVELS, MUSCLE_GROUPS, type MuscleGroup } from '../src/data/types';
import {
  AVAILABLE_EQUIPMENT,
  MAX_SETS_PER_SESSION,
  PRESCRIPTION,
  WEEKLY_SET_TARGET,
  buildProgram,
  prescriptionKind,
  type EquipmentSetting,
  type ProgramInputs,
} from '../src/program/builder';

const NOW = new Date('2026-11-01T12:00:00Z');
const build = (over: Partial<ProgramInputs> = {}) =>
  buildProgram(
    { groups: ['chest', 'back', 'quads'], daysPerWeek: 3, level: 'beginner', equipment: 'fullGym', ...over },
    NOW,
  );
const settings: EquipmentSetting[] = ['fullGym', 'dumbbells', 'bodyweight'];

describe('program builder', () => {
  it('is deterministic', () => {
    expect(build()).toEqual(build());
  });

  it('rejects an empty selection', () => {
    expect(() => build({ groups: [] })).toThrow();
  });

  for (const equipment of settings) {
    for (const level of LEVELS) {
      for (const daysPerWeek of [1, 2, 3, 4, 5, 6]) {
        const label = `${equipment}/${level}/${daysPerWeek} days, all groups`;
        it(`stays within the rules: ${label}`, () => {
          const p = build({ groups: [...MUSCLE_GROUPS], equipment, level, daysPerWeek });
          const have = AVAILABLE_EQUIPMENT[equipment];
          expect(p.days.length).toBeGreaterThan(0);
          expect(p.days.length).toBeLessThanOrEqual(daysPerWeek);
          for (const day of p.days) {
            const ids = day.items.map((i) => i.exerciseId);
            expect(new Set(ids).size, 'no duplicate exercise in a day').toBe(ids.length);
            const total = day.items.reduce((s, i) => s + i.sets, 0);
            expect(total).toBeLessThanOrEqual(MAX_SETS_PER_SESSION[level]);
            let seenIsolation = false;
            for (const item of day.items) {
              const e = EXERCISES_BY_ID.get(item.exerciseId)!;
              expect(e.equipment.every((q) => have.has(q)), `${e.id} equipment`).toBe(true);
              expect(LEVELS.indexOf(e.minLevel)).toBeLessThanOrEqual(LEVELS.indexOf(level));
              if (e.maxLevel) expect(LEVELS.indexOf(e.maxLevel)).toBeGreaterThanOrEqual(LEVELS.indexOf(level));
              if (e.role === 'compound') expect(seenIsolation, `${e.id} after isolation`).toBe(false);
              else seenIsolation = true;
              const kind = prescriptionKind(e);
              expect(item.reps).toEqual(PRESCRIPTION[level][kind].reps);
              expect(item.restSec).toBe(PRESCRIPTION[level][kind].restSec);
              expect(item.unit).toBe(kind === 'hold' ? 'seconds' : 'reps');
            }
          }
          // Every selected group gets weekly volume, or a note says why not.
          for (const g of MUSCLE_GROUPS) {
            const sets = p.weeklySets[g] ?? 0;
            const notes = p.notes.join(' ').toLowerCase();
            if (sets < 0.75 * p.targets[g]!) expect(notes, g).toContain(g);
          }
          if (daysPerWeek >= 3) for (const g of MUSCLE_GROUPS) expect(p.weeklySets[g] ?? 0, g).toBeGreaterThan(0);
        });
      }
    }
  }

  it('hits the weekly set target when there is room', () => {
    const p = build({ groups: ['chest', 'back'], daysPerWeek: 4, level: 'intermediate' });
    for (const g of ['chest', 'back'] as MuscleGroup[]) {
      expect(p.targets[g]).toBe(WEEKLY_SET_TARGET.intermediate);
      expect(p.weeklySets[g]!).toBeGreaterThanOrEqual(WEEKLY_SET_TARGET.intermediate - 2);
      expect(p.weeklySets[g]!).toBeLessThanOrEqual(WEEKLY_SET_TARGET.intermediate * 1.6);
    }
    expect(p.notes).toEqual([]);
  });

  it('trains each muscle at least twice a week when there are 2+ days', () => {
    for (const daysPerWeek of [2, 3, 4, 5, 6]) {
      const p = build({ groups: ['quads', 'chest', 'back', 'shoulders'], daysPerWeek });
      for (const g of p.inputs.groups) {
        const sessions = p.days.filter((d) => d.groups.includes(g)).length;
        expect(sessions, `${g} on ${daysPerWeek} days`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('scales volume down and says so when too many groups are squeezed into few days', () => {
    const p = build({ groups: [...MUSCLE_GROUPS], daysPerWeek: 1, level: 'advanced' });
    expect(p.targets.chest).toBeLessThan(WEEKLY_SET_TARGET.advanced);
    expect(p.notes.some((n) => n.includes('reduced'))).toBe(true);
  });

  it('only trains the selected groups directly', () => {
    const p = build({ groups: ['biceps'], daysPerWeek: 2 });
    for (const day of p.days) {
      for (const item of day.items) expect(EXERCISES_BY_ID.get(item.exerciseId)!.primary).toContain('biceps');
    }
  });

  it('prefers free weights over machines in a full gym', () => {
    const p = build({ groups: ['quads'], daysPerWeek: 2 });
    const first = EXERCISES_BY_ID.get(p.days[0].items[0].exerciseId)!;
    expect(first.equipment).not.toContain('machine');
    expect(first.role).toBe('compound');
  });
});
