import { useEffect, useRef, useState } from 'preact/hooks';

/** Small bottom sheet with one text field, for renaming a routine or workout. */
export function RenameSheet({ title, value, onSave, onClose }: { title: string; value: string; onSave: (name: string) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, []);
  const name = text.trim().replace(/\s+/g, ' ');
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet rename-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name) onSave(name);
          }}
        >
          <header class="sheet-head">
            <h2>{title}</h2>
            <button type="button" class="link" onClick={onClose}>
              Cancel
            </button>
          </header>
          <label class="text-field">
            <span>Name</span>
            <input ref={input} type="text" value={text} maxLength={40} enterKeyHint="done" onInput={(e) => setText(e.currentTarget.value)} />
          </label>
          <button type="submit" disabled={!name}>
            Save name
          </button>
        </form>
      </div>
    </div>
  );
}
