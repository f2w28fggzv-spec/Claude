// Placeholder: stage 2 replaces this.
// Settings → Delete all my data in the iPhone app: src/screens/SettingsScreen.tsx's native branch hands off here.
// Stage 2 writes the flow: confirm, pause the copy writer, deleteAllData() (src/native/bridge.ts), reload to the
// Welcome screen, then "All data deleted".

export async function deleteEverything(): Promise<void> {
  console.warn('Placeholder: Delete all my data comes with stage 2.');
}
