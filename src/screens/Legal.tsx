// Welcome (first launch: accept the terms), terms of service and privacy
// policy. The texts describe what the app actually does: no account, no
// server, everything stays on the device. Keep them in step with the code.
import { MUSCLE_GROUPS } from '../data/types';
import { loadProfile, saveProfile, TERMS_VERSION } from '../profile';
import { navigate } from '../router';
import { Icon, MuscleIcon } from './icons';
import { Screen } from './Layout';

const UPDATED = '8 November 2026';

/** First-launch screen. Continuing accepts the terms and privacy policy. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const accept = (next: string) => {
    saveProfile({ ...loadProfile(), termsAcceptedAt: new Date().toISOString(), termsVersion: TERMS_VERSION });
    onDone();
    navigate(next);
  };
  return (
    <Screen title="Welcome to Form Check">
      <section class="hero welcome">
        <div class="hero-icons" aria-hidden="true">
          {MUSCLE_GROUPS.slice(0, 5).map((g) => (
            <MuscleIcon group={g} size={34} />
          ))}
        </div>
        <ul class="welcome-list">
          <li>
            <Icon name="plan" size={20} /> Plans built for the muscles you pick, or log your own workouts
          </li>
          <li>
            <Icon name="camera" size={20} /> Technique feedback from your phone camera
          </li>
          <li>
            <Icon name="calendar" size={20} /> A log of every set, rep and weight, with progress and a weekly body map
          </li>
          <li>
            <Icon name="check" size={20} /> No account. Everything stays on this phone
          </li>
        </ul>
        <button type="button" class="big" onClick={() => accept('/profile?setup')}>
          Set up my profile
        </button>
        <button type="button" class="link center" onClick={() => accept('/')}>
          Skip for now
        </button>
        <p class="muted small">
          By continuing you agree to the <a href="#/terms">Terms of service</a> and the <a href="#/privacy">Privacy policy</a>. Form Check gives technique feedback,
          not medical advice.
        </p>
      </section>
    </Screen>
  );
}

export function TermsScreen() {
  return (
    <Screen title="Terms of service" subtitle={`Last updated ${UPDATED}`} back="settings">
      <article class="legal">
        <p>These terms apply when you use Form Check (“the app”). By using the app you agree to them. If you don’t agree, please don’t use the app.</p>

        <h2>1. What the app does</h2>
        <p>
          Form Check builds training plans, lets you log workouts, and gives automated technique feedback from your phone’s camera. It runs in your web browser.
          There is no account and no server: your data stays on your device (see the Privacy policy).
        </p>

        <h2>2. Not medical advice</h2>
        <p>
          The app gives general fitness information and automated technique feedback. It is not medical advice, a diagnosis or a treatment, and it does not
          replace a doctor, physiotherapist or qualified coach. If you have a health condition, an injury, are pregnant or have recently given birth, or haven’t
          exercised for a long time, talk to a health professional before starting. Stop exercising and get help if you feel pain, dizziness or shortness of
          breath.
        </p>

        <h2>3. Technique feedback can be wrong</h2>
        <p>
          Feedback comes from a pose-detection model and rules based on published standards. It can be wrong, especially with poor lighting, loose clothing,
          the camera in the wrong place or when part of your body is out of view. When the app can’t judge something it says so. Use the feedback as a guide,
          not a guarantee that a lift is safe or correct.
        </p>

        <h2>4. Your responsibility</h2>
        <p>
          You decide what to lift and how much. Train within your abilities, use equipment that is in good condition, use a spotter or safety bars for heavy
          lifts, and place your phone somewhere safe and stable. You are responsible for how you use the app’s suggestions.
        </p>

        <h2>5. Who can use it</h2>
        <p>You must be at least 13 years old. If you are under 18, use the app only with the permission of a parent or guardian.</p>

        <h2>6. Your data</h2>
        <p>
          Your plans, log, profile and any videos you choose to save are stored only in this browser on this device. You are responsible for backing them up
          (Settings → Back up my data). Clearing your browser’s site data, using private browsing, or deleting the app’s data removes them, and they can’t be
          recovered by anyone else, because no one else has a copy. Backups don’t include saved videos or replays.
        </p>

        <h2>7. Ownership and licences</h2>
        <p>
          The app and its content are provided for your personal, non-commercial use. Parts of it are open-source software and data used under their own
          licences, including the pose-detection model (MediaPipe, Apache License 2.0) and the body drawings (react-native-body-highlighter, MIT License).
        </p>

        <h2>8. No warranty</h2>
        <p>
          The app is a prototype and is provided “as is”, without warranties of any kind, to the extent the law allows. It may change, contain errors or stop
          being available.
        </p>

        <h2>9. Limitation of liability</h2>
        <p>
          To the extent the law allows, the app’s developers are not liable for any injury, loss or damage arising from your use of the app, including from
          following its plans, weight suggestions or technique feedback. Nothing in these terms limits liability that can’t be limited by law.
        </p>

        <h2>10. Changes</h2>
        <p>We may update these terms. When we do, we change the date above, and the app asks you to accept the new version before you continue.</p>
      </article>
    </Screen>
  );
}

export function PrivacyScreen() {
  return (
    <Screen title="Privacy policy" subtitle={`Last updated ${UPDATED}`} back="settings">
      <article class="legal">
        <p class="lead">
          Short version: Form Check has no account and no server. Everything you enter, and any video you choose to save, stays in this browser on this device.
          Nothing is sent to us or to anyone else.
        </p>

        <h2>1. What is stored, and where</h2>
        <p>The app stores the following in your browser’s storage on this device (localStorage and IndexedDB):</p>
        <ul>
          <li>Your profile, if you fill it in: name, body weight, height, sex and age (stored as year of birth).</li>
          <li>Your plans, routines, workouts (exercises, sets, reps, weights, notes) and settings.</li>
          <li>Technique-check results: rep counts, faults found and the movement of your body as numbers (pose landmarks), so you can replay a set as a skeleton.</li>
          <li>Videos of your sets, only if you tap “Save video” after a technique check.</li>
          <li>Calibration recordings, if you use the hidden calibration screen (numbers only).</li>
        </ul>
        <p>None of this is sent to the developers or any third party. We can’t see it, and we can’t recover it for you.</p>

        <h2>2. The camera</h2>
        <p>
          Video from your camera is analysed on your device by a pose-detection model that is downloaded with the app. Frames are not uploaded. During a
          technique check the video is held in memory so you can choose to save it; if you don’t tap “Save video”, it is discarded when you leave the results.
          Saved videos stay on this device until you delete them.
        </p>

        <h2>3. Network requests</h2>
        <p>
          The app’s files (including the pose model) are downloaded from the website that hosts it, GitHub Pages. GitHub may log technical information, such
          as your IP address, when your browser downloads them; see GitHub’s privacy statement. After that, the app blocks requests to any other server. There
          are no analytics, no advertising, no tracking cookies and no third-party scripts.
        </p>

        <h2>4. Your choices and control</h2>
        <ul>
          <li>Every profile field is optional.</li>
          <li>Delete a workout, a saved video or a replay at any time from where it is shown.</li>
          <li>Settings → Delete all my data removes everything the app stored on this device.</li>
          <li>Backups you export are files on your device; you decide where they go.</li>
        </ul>

        <h2>5. Security</h2>
        <p>
          Your data is protected by your device and browser, not by a password in the app. Anyone who can use your unlocked device and browser can see it. Keep
          your device locked.
        </p>

        <h2>6. Children</h2>
        <p>The app is not meant for children under 13. Users under 18 should have a parent’s or guardian’s permission.</p>

        <h2>7. Changes</h2>
        <p>
          If this policy changes, we update the date above and the app asks you to accept the new version. If the app ever adds accounts or sends data
          anywhere, this policy will say so before that happens.
        </p>
      </article>
    </Screen>
  );
}
