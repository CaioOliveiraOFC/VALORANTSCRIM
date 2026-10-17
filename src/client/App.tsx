import { Home } from "./components/Home";
import { ScrimRoom } from "./components/ScrimRoom";
import { Icon } from "./components/Icon";
import { navigate, useRoute } from "./router";

export function App() {
  const route = useRoute();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Ir para o conteúdo
      </a>
      <header className="app-topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            if (!e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              navigate("/");
            }
          }}
          aria-label="Scrim — início"
        >
          <span className="brand-mark" aria-hidden="true">
            <Icon name="crosshair" />
          </span>
          <span>
            scrim<span className="brand-game">VALORANT</span>
          </span>
        </a>
        <a
          className="topbar-home"
          href="/"
          onClick={(e) => {
            if (!e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              navigate("/");
            }
          }}
        >
          Salas
        </a>
      </header>
      {route.name === "scrim" ? (
        <ScrimRoom key={route.id} scrimId={route.id} />
      ) : (
        <Home />
      )}
    </div>
  );
}
