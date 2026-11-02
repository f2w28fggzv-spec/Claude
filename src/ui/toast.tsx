import { useEffect, useState } from 'preact/hooks';

// Tiny global toast: showToast('Saved') from anywhere, <ToastHost /> renders it.
type Listener = (msg: string | null) => void;
const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string, ms = 2600): void {
  clearTimeout(timer);
  listeners.forEach((l) => l(message));
  timer = setTimeout(() => listeners.forEach((l) => l(null)), ms);
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    listeners.add(setMsg);
    return () => void listeners.delete(setMsg);
  }, []);
  return msg ? (
    <div class="toast" role="status" aria-live="polite" key={msg}>
      {msg}
    </div>
  ) : null;
}
