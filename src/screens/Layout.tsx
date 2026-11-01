import type { ComponentChildren } from 'preact';

export function Screen(props: { title: string; back?: string; children: ComponentChildren }) {
  return (
    <main>
      <header class="top">
        {props.back !== undefined && (
          <a class="back" href={`#/${props.back}`} aria-label="Back">
            ‹ Back
          </a>
        )}
        <h1>{props.title}</h1>
      </header>
      {props.children}
    </main>
  );
}

export const PRIVACY = 'Technique feedback runs entirely on this phone. Video is never uploaded or saved.';
