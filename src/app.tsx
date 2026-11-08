import { useState } from 'preact/hooks';
import { loadProfile, termsAccepted } from './profile';
import { useRoute } from './router';
import { PrivacyScreen, TermsScreen, Welcome } from './screens/Legal';
import { ProfileScreen } from './screens/ProfileScreen';
import { SetScreen } from './screens/SetScreen';
import { ToastHost } from './ui/toast';
import { LogScreen } from './screens/LogScreen';
import { WorkoutScreen } from './screens/WorkoutScreen';
import { DevAnatomy } from './screens/DevAnatomy';
import { EditWorkoutScreen } from './screens/EditWorkoutScreen';
import { RoutineScreen } from './screens/RoutineScreen';
import { SessionScreen } from './screens/SessionScreen';
import { ProgressScreen } from './screens/ProgressScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { Home } from './screens/Home';
import { Groups } from './screens/Groups';
import { Build } from './screens/Build';
import { ProgramView } from './screens/ProgramView';
import { Library } from './screens/Library';
import { ExerciseDetail } from './screens/ExerciseDetail';
import { Camera } from './screens/Camera';
import { Analyze } from './screens/Analyze';
import { DevDemos } from './screens/DevDemos';
import { DevCalibrate } from './screens/DevCalibrate';

/** Pages readable before accepting the terms. */
const OPEN = new Set(['terms', 'privacy']);

export function App() {
  const route = useRoute();
  const [, rerender] = useState(0);
  // First launch (or new terms): the welcome screen until they're accepted.
  const gate = !termsAccepted(loadProfile()) && !OPEN.has(route.path[0] ?? '');
  // Keyed wrapper so the CSS entrance animation replays on every navigation
  // (used where the View Transitions API isn't available).
  return (
    <>
      <div class="page" key={gate ? 'welcome' : `${route.path.join('/')}?${route.query}`}>
        {gate ? <Welcome onDone={() => rerender((n) => n + 1)} /> : <Routes {...route} />}
      </div>
      <ToastHost />
    </>
  );
}

function Routes({ path, query }: ReturnType<typeof useRoute>) {
  const [screen, id] = path;
  switch (screen) {
    case 'groups':
      return <Groups />;
    case 'build':
      return <Build />;
    case 'program':
      return <ProgramView id={id ?? ''} />;
    case 'log':
      return <LogScreen />;
    case 'workout':
      return <WorkoutScreen />;
    case 'edit':
      return <EditWorkoutScreen id={id ?? 'new'} date={query.get('date') ?? undefined} />;
    case 'routine':
      return <RoutineScreen id={id ?? 'new'} />;
    case 'session':
      return <SessionScreen id={id ?? ''} />;
    case 'progress':
      return <ProgressScreen id={id ?? ''} />;
    case 'settings':
      return <SettingsScreen />;
    case 'set':
      return <SetScreen id={id ?? ''} />;
    case 'profile':
      return <ProfileScreen setup={query.has('setup')} />;
    case 'terms':
      return <TermsScreen />;
    case 'privacy':
      return <PrivacyScreen />;
    case 'library':
      return <Library />;
    case 'exercise':
      return <ExerciseDetail id={id ?? ''} />;
    case 'dev':
      if (id === 'demos') return <DevDemos still={query.has('still')} />;
      if (id === 'anatomy') return <DevAnatomy />;
      if (id === 'calibrate') return <DevCalibrate exerciseId={query.get('exercise') ?? undefined} />;
      return <Home />;
    case 'analyze':
      return <Analyze id={id ?? ''} calibrate={query.has('calibrate')} />;
    case 'camera':
      return <Camera exerciseId={query.get('exercise') ?? undefined} />;
    default:
      return <Home />;
  }
}
