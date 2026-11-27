// Placeholder: stage 2 replaces this.
// The iPhone app's Welcome, Terms of service and Privacy policy: src/screens/Legal.tsx's stand-in in the native
// build (NATIVE_SWAPS in scripts/native-build.ts). Stage 2 writes the app's own texts. Until then the web ones show,
// and accepting them saves the app's own terms version, so the app opens.
import { loadProfile, NATIVE_TERMS_VERSION, saveProfile } from '../../profile';
import { PrivacyScreen, TermsScreen, Welcome as WebWelcome } from '../../screens/Legal';

export { PrivacyScreen, TermsScreen };

export function Welcome({ onDone }: { onDone: () => void }) {
  return (
    <WebWelcome
      onDone={() => {
        saveProfile({ ...loadProfile(), termsVersion: NATIVE_TERMS_VERSION });
        onDone();
      }}
    />
  );
}
