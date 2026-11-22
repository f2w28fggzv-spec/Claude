// Prints where demos' bodies sink into the floor or equipment, or where
// planted feet slide (see src/demo/contact.ts). DEMO_IDS: comma list (empty = all).
import { it } from 'vitest';
import { EXERCISES } from '../../src/data/exercises';
import { contactIssues } from '../../src/demo/contact';

it('contact report', () => {
  const ids = (process.env.DEMO_IDS ?? '').split(',').filter(Boolean);
  const list = ids.length ? EXERCISES.filter((e) => ids.includes(e.id)) : EXERCISES;
  const lines: string[] = [];
  let clean = 0;
  for (const e of list) {
    const issues = contactIssues(e.demo);
    if (!issues.length) {
      clean++;
      continue;
    }
    lines.push(`${e.id}:`);
    for (const i of issues) lines.push(`  ${i.kind.padEnd(5)} ${i.part.padEnd(26)} ${i.depth.toFixed(3)}  at s=${i.s.toFixed(1)}`);
  }
  lines.push(`${clean} of ${list.length} demo(s) clean.`);
  console.log(lines.join('\n'));
});
