import { useState, type MouseEvent } from 'react';
import { Home } from './components/Home';
import { AdminPortal } from './components/AdminPortal';
import { SuperAdminPanel } from './components/SuperAdminPanel';
import { ScrimRoom } from './components/ScrimRoom';
import { AdminAuthProvider, useAdminAuth } from './hooks/useAdminAuth';
import { navigate, useRoute } from './router';
import './components/AdminPortal.css';

export function App() {
  return <AdminAuthProvider><AppLayout /></AdminAuthProvider>;
}

function AppLayout() {
  const route = useRoute();
  const auth = useAdminAuth();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');
  const adminHref = route.name === 'scrim' ? `/admin?returnTo=${encodeURIComponent(`/s/${route.id}`)}` : '/admin';
  const internal = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(event.currentTarget.getAttribute('href') ?? '/');
  };
  async function logout() {
    if (leaving) return;
    setLeaving(true); setError('');
    try { await auth.logout(); }
    catch (err) { setError((err as Error).message); }
    finally { setLeaving(false); }
  }
  return <>
    <a className="admin-skip" href="#page-content">Ir para o conteúdo</a>
    <header className="account-header">
      <a className="account-brand" href="/" onClick={internal}>Scrims <span>VALORANT</span></a>
      <nav aria-label="Navegação principal">
        <a href="/" onClick={internal} aria-current={route.name === 'home' ? 'page' : undefined}>Salas</a>
        <a href="/guia-admin.html">Guia do administrador</a>
        <a className="account-admin-link" href={adminHref} onClick={internal} aria-current={route.name === 'admin' ? 'page' : undefined}>{auth.status === 'admin' ? 'Área do administrador' : 'Entrar como admin'}</a>
        {auth.status === 'admin' && auth.isSuperAdmin && <a className="account-admin-link" href="/admin/management" onClick={internal} aria-current={route.name === 'management' ? 'page' : undefined}>Administração</a>}
      </nav>
      {auth.status === 'admin' && <div className="account-session"><span title={auth.email}>{auth.email}</span><button type="button" className="ghost" disabled={leaving} onClick={() => void logout()}>{leaving ? 'Saindo…' : 'Sair do admin'}</button></div>}
    </header>
    {error && <p className="account-header-error" role="alert">{error}</p>}
    <div id="page-content" tabIndex={-1}>
      {route.name === 'scrim' ? <ScrimRoom key={route.id} scrimId={route.id} /> : route.name === 'admin' ? <AdminPortal /> : route.name === 'management' ? <SuperAdminPanel /> : <Home />}
    </div>
  </>;
}
