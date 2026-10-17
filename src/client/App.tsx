import { Home } from './components/Home';
import { ScrimRoom } from './components/ScrimRoom';
import { Icon } from './components/Icon';
import { navigate, useRoute } from './router';

export function App() {
  const route = useRoute();
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
    <header className="app-topbar">
      <a className="brand" href="/" onClick={e => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); navigate('/'); } }} aria-label="Scrim Control — início">
        <span className="brand-mark" aria-hidden="true"><Icon name="crosshair" /></span>
        <span>SCRIM<span className="brand-divider">/</span><strong>CONTROL</strong><small>VALORANT</small></span>
      </a>
      <div className="topbar-context"><span className="status-dot" />Sua sala. Seu time. Seu jogo.</div>
      <a className={`topbar-home ${route.name === 'scrim' ? '' : 'active'}`} href="/" onClick={e => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); navigate('/'); } }}><Icon name="grid" /><span>Minhas scrims</span></a>
    </header>
    {route.name === 'scrim' ? <ScrimRoom key={route.id} scrimId={route.id} /> : <Home />}
    <footer className="app-footer">SCRIM CONTROL <span>Feito para jogar junto.</span></footer>
  </div>;
}
