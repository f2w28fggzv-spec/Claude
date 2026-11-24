// Settings → Install and offline: how to add fitee to the home screen, what
// is saved for offline use (with "Save for offline use"), and a waiting new
// version ("Update now"). State comes from src/offline/client.ts.
import { useEffect } from 'preact/hooks';
import { applyUpdate, promptInstall, refreshOffline, savePoseFiles, useOffline } from '../offline/client';
import { formatMB, installHint, offlineView, type OfflineView } from '../offline/state';
import { Icon } from './icons';

export function OfflineSection() {
  const info = useOffline();
  // Pose files may have been saved since (a technique check saves them as it loads them).
  useEffect(() => void refreshOffline(), []);
  const hint = installHint({
    standalone: info.standalone,
    installed: info.installed,
    canPrompt: info.canPrompt,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
  const view = offlineView(info);
  return (
    <>
      <h2 class="field">Install and offline</h2>
      <ul class="rows card status-rows">
        <li class="status-row" data-install={hint}>
          {hint === 'installed' ? (
            <span class="row-main">
              <strong>
                <Icon name="check" size={18} /> Installed on this phone
              </strong>
              {!info.standalone && <small>Open fitee from your home screen.</small>}
            </span>
          ) : (
            <span class="row-main">
              <strong>Add fitee to your home screen</strong>
              <small>
                {hint === 'prompt' && 'It opens like an app and works with no signal.'}
                {hint === 'ios-safari' && (
                  <>
                    Tap Share <Icon name="share" size={16} />, then Add to Home Screen.
                  </>
                )}
                {hint === 'ios-other' && 'Tap Share, then Add to Home Screen. If it isn’t there, open this page in Safari.'}
                {hint === 'other' && 'Use your browser’s menu: Install app, or Add to Home screen.'}
              </small>
              {(hint === 'ios-safari' || hint === 'ios-other') && (
                <small>The home-screen app keeps its own data, apart from Safari: to take your plans and log with you, back them up here and restore them there.</small>
              )}
            </span>
          )}
          {hint === 'prompt' && (
            <button type="button" class="small-btn secondary" onClick={() => void promptInstall()}>
              <Icon name="download" size={18} /> Install fitee
            </button>
          )}
        </li>
        <li class="status-row" data-offline={view.kind}>
          <OfflineRow view={view} />
        </li>
        {info.updateReady && (
          <li class="status-row" data-update="ready">
            <span class="row-main">
              <strong>A new version is ready</strong>
              <small>It updates by itself the next time you open fitee.</small>
            </span>
            <button type="button" class="small-btn secondary" disabled={info.updating} onClick={() => applyUpdate()}>
              {info.updating ? 'Updating…' : 'Update now'}
            </button>
          </li>
        )}
      </ul>
      <p class="muted small">
        The offline copy holds none of your data. To remove it, clear this site’s data in your browser (on iPhone, delete the home-screen app). That deletes
        your data too, so back it up first.
      </p>
    </>
  );
}

function OfflineRow({ view }: { view: OfflineView }) {
  switch (view.kind) {
    case 'off':
      return (
        <span class="row-main">
          <strong>Offline use isn’t available here</strong>
          <small>
            {view.reason === 'dev'
              ? 'Development build: the service worker only runs in the published app.'
              : view.reason === 'insecure'
                ? 'It needs a secure (https) connection.'
                : 'This browser doesn’t allow it (private browsing can turn it off).'}
          </small>
        </span>
      );
    case 'saving-app':
      return (
        <span class="row-main">
          <strong>Saving the app for offline use…</strong>
          <small>It takes a moment.</small>
        </span>
      );
    case 'saving-pose':
      return (
        <>
          <span class="row-main">
            <strong>Saving the pose model…</strong>
            <small>
              {formatMB(view.done)} of {formatMB(view.total)}
            </small>
          </span>
          <progress max={view.total} value={view.done} aria-label="Saving the pose model" />
        </>
      );
    case 'app-only':
      return (
        <>
          <span class="row-main">
            <strong>The app works offline</strong>
            <small>
              {view.failed
                ? 'Couldn’t save the pose model. Check your connection and try again.'
                : `Technique checks need the pose model (${formatMB(view.poseBytes)}). Save it to check your technique with no signal.`}
            </small>
          </span>
          <button type="button" class="small-btn secondary" disabled={!view.online} onClick={() => void savePoseFiles()}>
            <Icon name="download" size={18} /> {view.failed ? 'Try again' : 'Save for offline use'}
          </button>
          {!view.online && <small class="muted">Connect to the internet to save it.</small>}
        </>
      );
    case 'ready':
      return (
        <span class="row-main">
          <strong>
            <Icon name="check" size={18} /> Ready to use offline
          </strong>
          <small>The app and the pose model are saved on this phone ({formatMB(view.bytes)}).</small>
        </span>
      );
  }
}
