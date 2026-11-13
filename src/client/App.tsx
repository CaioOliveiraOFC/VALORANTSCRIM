import { lazy, Suspense, useEffect, useState, type MouseEvent } from 'react';
import { Home } from './components/Home';
import { AdminPortal } from './components/AdminPortal';
import { SuperAdminPanel } from './components/SuperAdminPanel';
import { ScrimRoom } from './components/ScrimRoom';
import { AdminAuthProvider, useAdminAuth } from './hooks/useAdminAuth';
import { navigate, useRoute, type Route } from './router';
import './components/AdminPortal.css';
import { Landing, X1Page } from './features/lobby/Landing';
import { Brand } from './ui/Brand';
import { StreamsAdmin } from './features/streams/StreamsAdmin';

const BrasaPreview = lazy(() => import('./features/brasa-preview/BrasaPreview'));

function PreviewEntry() {
  const target = new URLSearchParams(location.search).get('tela');
  useEffect(() => {
    if (target !== 'x1' && target !== 'sugestoes') {
      history.replaceState(null, '', '/');
      dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [target]);
  if (target !== 'x1' && target !== 'sugestoes')
    return (
      <main className="page">
        <a href="/">Abrir a Brasa</a>
      </main>
    );
  return (
    <Suspense
      fallback={
        <main className="page">
          <p role="status">Abrindo a prévia X1…</p>
        </main>
      }
    >
      <BrasaPreview />
    </Suspense>
  );
}

export function App() {
  const route = useRoute();
  if (route.name === 'brasa-preview') return <PreviewEntry />;
  return (
    <AdminAuthProvider>
      <AppLayout route={route} />
    </AdminAuthProvider>
  );
}

function AppLayout({ route }: { route: Route }) {
  const auth = useAdminAuth();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const titles: Record<string, string> = {
      home: 'Brasa — Churras Club',
      vct: 'Salas VCT · Brasa',
      history: 'Histórico · Brasa',
      admin: 'Minha organização · Brasa',
      management: 'Administração · Brasa',
      streams: 'Transmissões · Brasa',
      x1: 'X1 · Brasa',
      scrim: 'VCT · Brasa',
    };
    document.title = titles[route.name] ?? 'Brasa';
  }, [route.name]);
  const adminHref =
    route.name === 'scrim' ? `/admin?returnTo=${encodeURIComponent(`/s/${route.id}`)}` : '/admin';
  const internal = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate(event.currentTarget.getAttribute('href') ?? '/');
  };
  async function logout() {
    if (leaving) return;
    setLeaving(true);
    setError('');
    try {
      await auth.logout();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLeaving(false);
    }
  }
  return (
    <>
      <a className="admin-skip" href="#page-content">
        Ir para o conteúdo
      </a>
      {import.meta.env.VITE_BRASA_DEPLOYMENT === 'preview' && (
        <div className="club-preview-notice">
          <strong>Prévia do site</strong>
          <span>As salas e alterações são reais.</span>
        </div>
      )}
      <header className="account-header">
        <a className="account-brand" href="/" onClick={internal} aria-label="Brasa, início">
          <Brand />
        </a>
        <nav aria-label="Navegação principal">
          <a href="/" onClick={internal} aria-current={route.name === 'home' ? 'page' : undefined}>
            Início
          </a>
          <a
            href="/vct"
            onClick={internal}
            aria-current={route.name === 'vct' || route.name === 'scrim' ? 'page' : undefined}
          >
            VCT
          </a>
          <a href="/x1" onClick={internal} aria-current={route.name === 'x1' ? 'page' : undefined}>
            X1
          </a>
          <a
            href="/historico"
            onClick={internal}
            aria-current={route.name === 'history' ? 'page' : undefined}
          >
            Histórico
          </a>
        </nav>
        <div className="club-account-links">
          <a
            className="account-admin-link"
            href={adminHref}
            onClick={internal}
            aria-current={route.name === 'admin' ? 'page' : undefined}
          >
            {auth.status === 'admin' ? 'Minha organização' : 'Entrar como admin'}
          </a>
          {auth.status === 'admin' && auth.isSuperAdmin && (
            <a
              className="account-admin-link"
              href="/admin/management"
              onClick={internal}
              aria-current={route.name === 'management' ? 'page' : undefined}
            >
              Administração
            </a>
          )}
          {auth.status === 'admin' && auth.can('editRoom') && <a className="account-admin-link" href="/admin/lives" onClick={internal} aria-current={route.name === 'streams' ? 'page' : undefined}>Transmissões</a>}
        </div>
        {auth.status === 'admin' && (
          <div className="account-session">
            <span title={auth.email}>{auth.email}</span>
            <button
              type="button"
              className="ghost"
              disabled={leaving}
              onClick={() => void logout()}
            >
              {leaving ? 'Saindo…' : 'Sair do admin'}
            </button>
          </div>
        )}
      </header>
      {error && (
        <p className="account-header-error" role="alert">
          {error}
        </p>
      )}
      <div id="page-content" tabIndex={-1}>
        {route.name === 'scrim' ? (
          <ScrimRoom key={route.id} scrimId={route.id} />
        ) : route.name === 'admin' ? (
          <AdminPortal />
        ) : route.name === 'management' ? (
          <SuperAdminPanel />
        ) : route.name === 'streams' ? (
          <StreamsAdmin />
        ) : route.name === 'vct' ? (
          <Home />
        ) : route.name === 'history' ? (
          <Home filter="finished" />
        ) : route.name === 'x1' ? (
          <X1Page />
        ) : (
          <Landing />
        )}
      </div>
      <footer className="club-site-footer">
        <a href="/" onClick={internal} aria-label="Brasa, início">
          <Brand compact />
        </a>
        <p>O jogo é sério. A resenha também.</p>
        <a href="/guia-admin.html">Guia do administrador</a>
      </footer>
    </>
  );
}
