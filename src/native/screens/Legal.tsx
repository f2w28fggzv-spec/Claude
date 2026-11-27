// The iPhone app's Welcome, Terms of service and Privacy policy: src/screens/Legal.tsx's stand-in in the native build
// (NATIVE_SWAPS in scripts/native-build.ts), with the same exports, props and layout. The texts describe what the
// app's code does today: everything stays in the app on this iPhone, apart from what the iPhone's own backups
// include. Keep them in step with the code, and bump NATIVE_TERMS_VERSION (src/profile.ts) with NATIVE_UPDATED when
// they change. They don't say "no account" (or "no server"): a server with sign-ups is planned. Drafts for the lawyer,
// like the web texts.
import { useState } from 'preact/hooks';
import { loadProfile, NATIVE_TERMS_VERSION, saveProfile } from '../../profile';
import { navigate } from '../../router';
import { Icon } from '../../screens/icons';
import { Screen } from '../../screens/Layout';
import { Logo } from '../../ui/Logo';

/** The date of NATIVE_TERMS_VERSION, in words. */
export const NATIVE_UPDATED = '27 November 2026';

/** Section 7's open-source components, each with its licence text in src/native/licenses/ (loaded when opened). */
export const LICENCES: readonly { file: string; name: string; licence: string }[] = [
  { file: 'mediapipe.txt', name: 'MediaPipe Tasks Vision and the pose models', licence: 'Apache License 2.0' },
  { file: 'wasm-runtime-apache-2.0.txt', name: 'TensorFlow Lite, LiteRT, Abseil, OpenCV and other libraries in MediaPipe’s runtime', licence: 'Apache License 2.0' },
  { file: 'xnnpack-bsd-3-clause.txt', name: 'XNNPACK', licence: 'BSD 3-Clause License' },
  { file: 'pthreadpool-bsd-2-clause.txt', name: 'pthreadpool', licence: 'BSD 2-Clause License' },
  { file: 'protobuf-bsd-3-clause.txt', name: 'Protocol Buffers', licence: 'BSD 3-Clause License' },
  { file: 'eigen-mpl-2.0.txt', name: 'Eigen', licence: 'Mozilla Public License 2.0' },
  { file: 'fft2d.txt', name: 'fft2d (Takuya Ooura)', licence: 'its own licence' },
  { file: 'zlib.txt', name: 'zlib and MiniZip', licence: 'zlib License' },
  { file: 'emscripten-mit.txt', name: 'Emscripten and the musl C library', licence: 'MIT License' },
  { file: 'capacitor-mit.txt', name: 'Capacitor', licence: 'MIT License' },
  { file: 'apache-2.0.txt', name: 'Apache License 2.0', licence: 'full text' },
  { file: 'preact-mit.txt', name: 'Preact', licence: 'MIT License' },
  { file: 'body-highlighter-mit.txt', name: 'react-native-body-highlighter (body drawings)', licence: 'MIT License' },
  { file: 'bricolage-grotesque-OFL.txt', name: 'Bricolage Grotesque (typeface)', licence: 'SIL Open Font License 1.1' },
];

/** The licence texts, each a small chunk of its own. */
const TEXTS = import.meta.glob<string>('../licenses/*.txt', { query: '?raw', import: 'default' });

/** First-launch screen. Continuing accepts the terms and privacy policy. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const accept = (next: string) => {
    saveProfile({ ...loadProfile(), termsAcceptedAt: new Date().toISOString(), termsVersion: NATIVE_TERMS_VERSION });
    onDone();
    navigate(next);
  };
  return (
    <Screen title="Welcome to fitee">
      <section class="hero welcome">
        <div class="welcome-brand">
          <Logo height={46} heat />
          <p>Train with a plan, log every set, check your technique.</p>
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
            <Icon name="check" size={20} /> Your data stays on this iPhone and in your own backups
          </li>
        </ul>
        <button type="button" class="big" onClick={() => accept('/profile?setup')}>
          Set up my profile
        </button>
        <button type="button" class="link center" onClick={() => accept('/')}>
          Skip for now
        </button>
        <p class="muted small">
          By continuing you agree to the <a href="#/terms">Terms of service</a> and the <a href="#/privacy">Privacy policy</a>. fitee gives technique feedback,
          not medical advice.
        </p>
      </section>
    </Screen>
  );
}

/** One component in section 7: its licence text loads the first time it's opened. */
function LicenceItem({ file, name, licence }: (typeof LICENCES)[number]) {
  const [text, setText] = useState<string>();
  const load = () => {
    if (text === undefined) void TEXTS[`../licenses/${file}`]?.().then(setText);
  };
  return (
    <li>
      <details class="more small" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && load()}>
        <summary>
          {name} · {licence}
        </summary>
        <pre class="licence">{text ?? 'Loading…'}</pre>
      </details>
    </li>
  );
}

export function TermsScreen() {
  return (
    <Screen title="Terms of service" subtitle={`Last updated ${NATIVE_UPDATED}`} back="settings">
      <article class="legal">
        <p>These terms apply when you use the fitee app for iPhone (“the app”). By using the app you agree to them. If you don’t agree, please don’t use the app.</p>

        <h2>1. What the app does</h2>
        <p>
          fitee builds training plans, lets you log workouts, and gives automated technique feedback from your iPhone’s camera. Everything it needs,
          including the pose-detection model, comes with the app, so it works without a connection. Your data stays on your iPhone and in your own backups
          (see the Privacy policy).
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
          Your plans, log, profile and settings, and any sets and videos you choose to save, are stored only in the app on this iPhone. You are responsible
          for backing them up (Settings → Back up my data); fitee’s own backup files don’t include saved sets or videos. If you back up your iPhone to
          iCloud or a computer, that backup includes your plans, log, profile and settings, as it does any app’s data; fitee asks iOS to leave saved sets and
          videos out of it. Deleting the app removes what it stored on this iPhone. Copies in your iPhone’s backups stay until those backups are replaced.
        </p>

        <h2>7. Ownership and licences</h2>
        <p>
          The app and its content are provided for your personal, non-commercial use. Parts of it are open-source software and data used under their own
          licences; each is listed below with its licence.
        </p>
        <ul class="licences">
          {LICENCES.map((l) => (
            <LicenceItem key={l.file} {...l} />
          ))}
        </ul>

        <h2>8. No warranty</h2>
        <p>The app is provided “as is”, without warranties of any kind, to the extent the law allows. It may change, contain errors or stop being available.</p>

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
    <Screen title="Privacy policy" subtitle={`Last updated ${NATIVE_UPDATED}`} back="settings">
      <article class="legal">
        <p class="lead">
          Short version: everything you enter, and any video you choose to save, stays in the app on this iPhone, apart from what your iPhone’s own backups
          include (see section 1). The app sends nothing to us or to anyone else.
        </p>

        <h2>1. What is stored, and where</h2>
        <p>The app stores the following on this iPhone, inside the app (in its web storage and in files in its own folder):</p>
        <ul>
          <li>Your profile, if you fill it in: name, body weight, height, sex and age (stored as year of birth).</li>
          <li>Your plans, routines, workouts (exercises, sets, reps, weights, notes) and settings.</li>
          <li>Technique-check results: rep counts, faults found and the movement of your body as numbers (pose landmarks), so you can replay a set as a skeleton.</li>
          <li>Videos of your sets, only if you tap “Save video” after a technique check, as files in the app’s folder.</li>
        </ul>
        <p>
          So your plans, log, profile and settings aren’t lost if iOS clears the app’s web storage (it can when your iPhone runs very low on space), the app
          keeps a copy of them in a file in its own folder and puts them back from it when needed.
        </p>
        <p>
          If you back up your iPhone to iCloud or a computer, iOS includes the app’s data in that backup: your plans, log, profile and settings, and the copy
          of them. The app asks iOS to leave your saved sets (skeleton replays and saved videos) out of these backups. iOS treats this as guidance, so we can’t
          promise they never appear in one. Those backups are yours, kept by Apple or on your computer, not by us.
        </p>
        <p>None of this is sent to the developers or any third party. We can’t see it, and we can’t recover it for you.</p>

        <h2>2. The camera</h2>
        <p>
          Video from your camera is analysed on this iPhone by a pose-detection model that comes with the app. Frames are not uploaded. During a technique
          check the video is held in memory so you can choose to save it; if you don’t tap “Save video”, it is discarded when you leave the results. The app
          films without sound, and iOS asks your permission the first time it uses the camera.
        </p>
        <p>
          If you check a video you pick and choose Take Video in the picker, iOS records it, with sound if you allow the microphone; a video you pick keeps
          any sound it has, and the app keeps it only if you tap “Save video”. When you pick a video or film one with Take Video, iOS gives the app a
          temporary copy of it: fitee deletes that copy when you leave the results, the next time it starts, and when you delete all your data. A backup file
          you pick to restore is copied the same way, and deleted the next time the app starts.
        </p>
        <p>Saved videos stay in the app on this iPhone until you delete them or the app.</p>

        <h2>3. Network requests</h2>
        <p>
          The app makes no network requests. Everything it needs, including the pose model and the font, comes with the app, and you get the app and its
          updates from the App Store, under Apple’s terms and privacy policy. The app blocks requests to any server in three ways: in its own code, with a
          content security policy, and with a content blocker in its web view. There are no scripts from other sites, no analytics, no advertising and no
          tracking. If you’ve chosen in your iPhone’s settings to share analytics with app developers, iOS may send Apple crash reports and usage data about
          the app, which Apple may share with us; the app itself sends nothing.
        </p>

        <h2>4. Your choices and control</h2>
        <ul>
          <li>Every profile field is optional.</li>
          <li>Delete a workout, a saved video or a replay at any time from where it is shown.</li>
          <li>
            Settings → Delete all my data removes everything the app stored about you on this iPhone, including its copy of your data and your saved sets and
            videos. It can’t reach your iPhone’s backups: older copies there are replaced as new backups are made, or you can delete those backups in iOS
            Settings.
          </li>
          <li>
            Deleting the app from your iPhone deletes what it stored on this iPhone; copies in your iPhone’s backups stay until those backups are replaced.
            Back up first if you want to keep your data.
          </li>
          <li>Backups you export are files you save with iOS’s Save to Files panel: you choose where they go, as with a download.</li>
        </ul>

        <h2>5. Security</h2>
        <p>
          Your data is protected by your iPhone’s passcode and iOS’s file protection, not by a password in the app. Anyone who can use your unlocked iPhone
          can see it. Keep your iPhone locked. Backups are protected as you set them up (iCloud, or an encrypted backup on a computer).
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
