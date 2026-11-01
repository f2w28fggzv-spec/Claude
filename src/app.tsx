import { useRoute } from './router';
import { Home } from './screens/Home';
import { Groups } from './screens/Groups';
import { Build } from './screens/Build';
import { ProgramView } from './screens/ProgramView';
import { Library } from './screens/Library';
import { ExerciseDetail } from './screens/ExerciseDetail';
import { Camera } from './screens/Camera';
import { Analyze } from './screens/Analyze';

export function App() {
  const { path, query } = useRoute();
  const [screen, id] = path;
  switch (screen) {
    case 'groups':
      return <Groups />;
    case 'build':
      return <Build />;
    case 'program':
      return <ProgramView id={id ?? ''} />;
    case 'library':
      return <Library />;
    case 'exercise':
      return <ExerciseDetail id={id ?? ''} />;
    case 'analyze':
      return <Analyze id={id ?? ''} />;
    case 'camera':
      return <Camera exerciseId={query.get('exercise') ?? undefined} />;
    default:
      return <Home />;
  }
}
