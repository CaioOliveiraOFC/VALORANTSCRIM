import { Home } from './components/Home';
import { ScrimRoom } from './components/ScrimRoom';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  return route.name === 'scrim' ? <ScrimRoom key={route.id} scrimId={route.id} /> : <Home />;
}
