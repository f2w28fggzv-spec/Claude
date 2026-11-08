// A simple form rating for a technique check: the share of reps with no fault.
// The labels are this app's wording (HEURISTIC cut-offs); 80% matches the
// coach's "clean" form gate.

export interface FormRating {
  /** Share of clean reps, 0–100. */
  pct: number;
  label: 'Excellent' | 'Good' | 'Fair' | 'Needs work';
  tone: 'good' | 'ok' | 'bad';
}

export function formRating(cleanReps: number, reps: number): FormRating | null {
  if (reps <= 0) return null;
  const pct = Math.round((Math.max(0, Math.min(cleanReps, reps)) / reps) * 100);
  if (pct === 100) return { pct, label: 'Excellent', tone: 'good' };
  if (pct >= 80) return { pct, label: 'Good', tone: 'good' };
  if (pct >= 50) return { pct, label: 'Fair', tone: 'ok' };
  return { pct, label: 'Needs work', tone: 'bad' };
}

/** "4/5 clean reps · Good" */
export function formText(cleanReps: number, reps: number): string {
  const r = formRating(cleanReps, reps);
  return r ? `${cleanReps}/${reps} clean rep${reps === 1 ? '' : 's'} · ${r.label}` : 'No reps counted';
}
