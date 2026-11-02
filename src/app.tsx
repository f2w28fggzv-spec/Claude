import { useRoute } from './router';
import { ToastHost } from './ui/toast';
import { LogScreen } from './screens/LogScreen';
import { WorkoutScreen } from './screens/WorkoutScreen';
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

export function App() {
  const route = useRoute();
  // Keyed wrapper so the CSS entrance animation replays on every navigation
  // (used where the View Transitions API isn't available).
  return (
    <>
      <div class="page" key={`${route.path.join('/')}?${route.query}`}>
        <Routes {...route} />
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
    case 'routine':
      return <RoutineScreen id={id ?? 'new'} />;
    case 'session':
      return <SessionScreen id={id ?? ''} />;
    case 'progress':
      return <ProgressScreen id={id ?? ''} />;
    case 'settings':
      return <SettingsScreen />;
    case 'library':
      return <Library />;
    case 'exercise':
      return <ExerciseDetail id={id ?? ''} />;
    case 'dev':
      if (id === 'demos') return <DevDemos still={query.has('still')} />;
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
