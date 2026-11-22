// Runs the demo-sheet exporter under Vitest (it resolves the app's TypeScript
// imports the same way the tests do). Not part of `npm test`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tools/demo-sheets/export.tool.ts'], watch: false },
});
