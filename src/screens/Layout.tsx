import type { ComponentChildren } from 'preact';
import { Icon } from './icons';

export type Tab = 'plan' | 'exercises';

interface ScreenProps {
  title: string;
  /** Route to go back to ('' = home). Omit for top-level screens. */
  back?: string;
  /** Show the bottom tab bar with this tab active. */
  tab?: Tab;
  /** Pinned action at the bottom of the screen (e.g. "Next"). */
  action?: ComponentChildren;
  /** Small line under the title. */
  subtitle?: string;
  children: ComponentChildren;
}

export function Screen(props: ScreenProps) {
  const pad = props.action ? 'with-action' : props.tab ? 'with-tabs' : '';
  return (
    <>
      <main class={pad}>
        <header class="top">
          {props.back !== undefined && (
            <a class="back" href={`#/${props.back}`} aria-label="Back">
              <Icon name="back" size={22} />
            </a>
          )}
          <div>
            <h1>{props.title}</h1>
            {props.subtitle && <p class="subtitle">{props.subtitle}</p>}
          </div>
        </header>
        {props.children}
      </main>
      {props.action && <div class="action-bar">{props.action}</div>}
      {props.tab && !props.action && <TabBar active={props.tab} />}
    </>
  );
}

function TabBar({ active }: { active: Tab }) {
  return (
    <nav class="tabs" aria-label="Main">
      <a href="#/" class={active === 'plan' ? 'on' : ''} aria-current={active === 'plan' ? 'page' : undefined}>
        <Icon name="plan" />
        <span>Plan</span>
      </a>
      <a href="#/library" class={active === 'exercises' ? 'on' : ''} aria-current={active === 'exercises' ? 'page' : undefined}>
        <Icon name="exercises" />
        <span>Exercises</span>
      </a>
    </nav>
  );
}

export const PRIVACY = 'Everything runs on your phone. Video is never uploaded or saved.';
