// Settings → Install and offline: how to add fitee to the home screen, what
// is saved for offline use (with "Save for offline use"), and a new version:
// waiting ("Update now"), or needing more room on the phone ("Try again").
// Also the note every other screen shows while the pose model is being
// saved. State comes from src/offline/client.ts.
import { useEffect } from 'preact/hooks';
import { applyUpdate, promptInstall, refreshOffline, retryOffline, retryUpdate, savePoseFiles, useOffline } from '../offline/client';
import {
  appFailedMessage,
  appOnlyHeading,
  appOnlyMessage,
  formatMB,
  installHint,
  offlineView,
  saveButtonLabel,
  UPDATE_HELD_HEADING,
  updateHeldMessage,
  type OfflineView,
} from '../offline/state';
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
                <>
                  <small>
                    Then open it once while you’re online and leave it open until it has saved the pose model (about 24 MB; Settings there says “Ready to use
                    offline”). After that it works with no signal.
                  </small>
                  <small>
                    It keeps its own data, apart from {hint === 'ios-safari' ? 'Safari' : 'this browser'}: to take your plans and log with you, back them up
                    here and restore them there.
                  </small>
                </>
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
          <OfflineRow view={view} updating={info.updating} />
        </li>
        {info.updateReady ? (
          <li class="status-row" data-update="ready">
            <span class="row-main">
              <strong>A new version is ready</strong>
              <small>It updates by itself the next time you open fitee.</small>
            </span>
            <button type="button" class="small-btn secondary" disabled={info.updating} onClick={() => applyUpdate()}>
              {info.updating ? 'Updating…' : 'Update now'}
            </button>
          </li>
        ) : (
          info.updateHeld !== undefined && (
            <li class="status-row" data-update="no-room">
              <span class="row-main">
                <strong>{UPDATE_HELD_HEADING}</strong>
                <small class="warn">{updateHeldMessage(info.updateHeld)}</small>
              </span>
              <button type="button" class="small-btn secondary" disabled={info.updating || !info.online} onClick={() => void retryUpdate()}>
                {info.updating ? 'Updating…' : 'Try again'}
              </button>
            </li>
          )
        )}
      </ul>
      <p class="muted small">
        The offline copy holds none of your data. To remove it, clear this site’s data in your browser (on iPhone, delete the home-screen app). That deletes
        your data too, so back it up first.
      </p>
    </>
  );
}

function OfflineRow({ view, updating }: { view: OfflineView; updating: boolean }) {
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
    case 'checking':
      return (
        <span class="row-main">
          <strong>Offline use</strong>
          <small>Checking what’s saved on this phone…</small>
        </span>
      );
    case 'saving-app':
      return (
        <span class="row-main">
          <strong>Saving the app for offline use…</strong>
          <small>It takes a moment.</small>
        </span>
      );
    case 'app-failed':
      return (
        <>
          <span class="row-main">
            <strong>Couldn’t save the app for offline use</strong>
            <small class="warn">{appFailedMessage(view)}</small>
          </span>
          <button type="button" class="small-btn secondary" disabled={!view.online} onClick={() => void retryOffline()}>
            <Icon name="download" size={18} /> Try again
          </button>
        </>
      );
    case 'saving-pose':
      return (
        <>
          <span class="row-main">
            <strong>Saving the pose model…</strong>
            <small>
              {formatMB(view.done)} of {formatMB(view.total)}. Keep fitee open until it’s done.
            </small>
          </span>
          <progress max={view.total} value={view.done} aria-label="Saving the pose model" />
        </>
      );
    case 'app-only':
      return (
        <>
          <span class="row-main">
            <strong>{appOnlyHeading(view)}</strong>
            <small class={view.problem ? 'warn' : undefined}>{appOnlyMessage(view)}</small>
          </span>
          {/* With a new version waiting, it updates first and saves after the reload. */}
          <button type="button" class="small-btn secondary" disabled={!view.online || updating} onClick={() => void savePoseFiles()}>
            <Icon name="download" size={18} /> {updating ? 'Updating…' : saveButtonLabel(view)}
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

/**
 * Shown on every screen but Settings (which has its own row) while the pose
 * model is being saved, e.g. by itself on an installed app's first launch:
 * closing fitee stops it.
 */
export function OfflineSaveNote() {
  const { saving } = useOffline();
  if (!saving) return null;
  return (
    <div class="save-note" role="status">
      <span>
        {/* The running count isn't read out at every step; the bar carries it. */}
        <strong>Saving for offline use</strong>{' '}
        <span aria-live="off">
          {formatMB(saving.done)} of {formatMB(saving.total)}.
        </span>{' '}
        Keep fitee open until it’s done.
      </span>
      <progress max={saving.total} value={saving.done} aria-label="Saving the pose model" />
    </div>
  );
}
