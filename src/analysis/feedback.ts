// Sound cues and screen wake lock for hands-free recording.

let audio: AudioContext | undefined;

/** Must be called from a tap so iOS allows sound later. */
export function unlockAudio(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    void audio.resume();
  } catch {
    audio = undefined;
  }
}

export function beep(freq = 880, ms = 120): void {
  if (!audio) return;
  try {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.2, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + ms / 1000);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + ms / 1000);
  } catch {
    // Sound is a nicety; ignore failures.
  }
}

type Sentinel = { release(): Promise<void> };
let lock: Sentinel | undefined;

/** Keeps the screen on while the camera is in use (where supported). */
export async function keepAwake(on: boolean): Promise<void> {
  try {
    if (on && !lock) {
      const wl = (navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock;
      lock = await wl?.request('screen');
    } else if (!on && lock) {
      await lock.release();
      lock = undefined;
    }
  } catch {
    lock = undefined;
  }
}
