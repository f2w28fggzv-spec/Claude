import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './icons';

export type Tab = 'plan' | 'log' | 'exercises';

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
  /** Small button next to the title (e.g. rename). */
  titleAction?: ComponentChildren;
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
            {props.titleAction ? (
              <div class="title-row">
                <h1>{props.title}</h1>
                {props.titleAction}
              </div>
            ) : (
              <h1>{props.title}</h1>
            )}
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

const TABS: { id: Tab; href: string; icon: IconName; label: string }[] = [
  { id: 'plan', href: '#/', icon: 'plan', label: 'Train' },
  { id: 'log', href: '#/log', icon: 'calendar', label: 'Log' },
  { id: 'exercises', href: '#/library', icon: 'exercises', label: 'Exercises' },
];

function TabBar({ active }: { active: Tab }) {
  const index = TABS.findIndex((t) => t.id === active);
  return (
    <nav class="tabs" aria-label="Main" style={{ '--tab-count': String(TABS.length) }}>
      <span class="tab-pill" aria-hidden="true" style={{ transform: `translateX(${index * 100}%)` }} />
      {TABS.map((t) => (
        <a href={t.href} class={active === t.id ? 'on' : ''} aria-current={active === t.id ? 'page' : undefined}>
          <Icon name={t.icon} />
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

export const PRIVACY = 'Everything runs on your phone. Video is never uploaded or saved.';
