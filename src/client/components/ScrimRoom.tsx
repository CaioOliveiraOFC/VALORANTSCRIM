import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Command, ScrimState } from "../../shared/scrim";
import { FORMAT_LABEL } from "../../shared/veto";
import { forgetAdminKey, readAdminKey } from "../adminKeys";
import { useScrim } from "../hooks/useScrim";
import { navigate } from "../router";
import { copyText } from "../util";
import { Icon, type IconName } from "./Icon";
import { MatchPanel } from "./MatchPanel";
import { ReportPanel } from "./ReportPanel";
import { TeamsPanel } from "./TeamsPanel";
import { Timeline } from "./Timeline";
import { VetoPanel } from "./VetoPanel";

interface RoomCtx {
  importRequest: ReturnType<typeof useScrim>["importRequest"];
  state: ScrimState;
  isAdmin: boolean;
  /** Envia um comando; erros viram aviso na tela. */
  act: (command: Command) => Promise<boolean>;
}

const Ctx = createContext<RoomCtx | null>(null);

export function useRoom(): RoomCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRoom fora de ScrimRoom");
  return ctx;
}

type Tab = "teams" | "veto" | "match" | "report" | "timeline";

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "teams", label: "Preparar", icon: "users" },
  { id: "veto", label: "Escolher mapas", icon: "shield" },
  { id: "match", label: "Jogar", icon: "crosshair" },
  { id: "report", label: "Relatório", icon: "chart" },
  { id: "timeline", label: "Histórico", icon: "history" },
];

const tabForPhase = (phase: ScrimState["phase"]): Tab =>
  (
    ({
      setup: "teams",
      veto: "veto",
      live: "match",
      finished: "match",
    }) as const
  )[phase];

export function ScrimRoom({ scrimId }: { scrimId: string }) {
  const [adminKey] = useState(() => readAdminKey(scrimId));
  const { state, events, role, status, presence, send, importRequest } =
    useScrim(scrimId, adminKey);
  const [tab, setTab] = useState<Tab | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const isAdmin = role === "admin";

  // Espectadores seguem a fase automaticamente até escolherem uma aba.
  const phase = state?.phase;
  const [followPhase, setFollowPhase] = useState(true);
  useEffect(() => {
    if (phase && followPhase) setTab(tabForPhase(phase));
  }, [phase, followPhase]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const act = useCallback(
    async (command: Command) => {
      try {
        await send(command);
        return true;
      } catch (err) {
        setToast((err as Error).message);
        return false;
      }
    },
    [send],
  );

  const ctx = useMemo(
    () => (state ? { state, isAdmin, act, importRequest } : null),
    [state, isAdmin, act, importRequest],
  );

  if (status === "not-found") {
    return (
      <main className="page" id="main-content" tabIndex={-1}>
        <div className="card">
          <h2>Scrim não encontrada</h2>
          <button onClick={() => navigate("/")}>Voltar</button>
        </div>
      </main>
    );
  }

  if (!ctx || !tab) {
    return (
      <main className="page" id="main-content" tabIndex={-1}>
        <p className="muted">Conectando…</p>
      </main>
    );
  }

  const spectatorLink = `${location.origin}/s/${scrimId}`;

  const phaseLabel = {
    setup: "Preparação",
    veto: "Veto em andamento",
    live: "Partida em andamento",
    finished: "Série encerrada",
  }[ctx.state.phase];
  const mainTabs = TABS.slice(0, 3);
  const tabStop = mainTabs.some((t) => t.id === tab)
    ? tab
    : tabForPhase(ctx.state.phase);
  const phaseIndex = mainTabs.findIndex(
    (t) => t.id === tabForPhase(ctx.state.phase),
  );
  function chooseTab(id: Tab) {
    setTab(id);
    setFollowPhase(id === tabForPhase(ctx!.state.phase));
  }
  return (
    <Ctx.Provider value={ctx}>
      <main className="room-main page" id="main-content" tabIndex={-1}>
        <header className="room-header">
          <div className="room-heading">
            <div className="room-context">
              <span className={`status ${status}`}>
                {status === "online"
                  ? phaseLabel
                  : status === "connecting"
                    ? "Conectando…"
                    : "Reconectando…"}
              </span>
              <span>{FORMAT_LABEL[ctx.state.format]}</span>
              <span>
                <Icon name="eye" />
                {presence.viewers}
                <span className="sr-only"> espectadores</span>
              </span>
              <span>{isAdmin ? "Admin" : "Espectador"}</span>
            </div>
            <h1>{ctx.state.title}</h1>
          </div>
          <div className="room-header-actions">
            <button
              className="secondary share-button"
              onClick={async () =>
                setToast(
                  (await copyText(spectatorLink))
                    ? "Link da sala copiado. Envie para os amigos."
                    : spectatorLink,
                )
              }
            >
              <Icon name="link" />
              Convidar amigos
            </button>
            {isAdmin && (
              <details className="room-actions">
                <summary aria-label="Opções de acesso">•••</summary>
                <div>
                  {adminKey && (
                    <button
                      onClick={async () => {
                        const link = `${spectatorLink}#admin=${encodeURIComponent(adminKey)}`;
                        setToast(
                          (await copyText(link))
                            ? "Link de admin copiado. Guarde para acessar a sala."
                            : link,
                        );
                      }}
                    >
                      <Icon name="copy" />
                      Copiar link de admin
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          "Remover o acesso de admin deste navegador? Você precisará do link de admin para voltar.",
                        )
                      ) {
                        forgetAdminKey(scrimId);
                        location.reload();
                      }
                    }}
                  >
                    <Icon name="back" />
                    Sair do admin
                  </button>
                </div>
              </details>
            )}
          </div>
        </header>
        {isAdmin && ctx.state.version <= 1 && (
          <p className="callout">
            <Icon name="shield" />
            Guarde o link de admin em <strong>•••</strong> para voltar com o
            controle da sala.
          </p>
        )}
        <div className="room-navigation">
          <nav
            className="room-steps"
            role="tablist"
            aria-label="Etapas da scrim"
            onKeyDown={(e) => {
              const index = mainTabs.findIndex((t) => t.id === tabStop);
              let next = index;
              if (["ArrowRight", "ArrowDown"].includes(e.key))
                next = (index + 1) % mainTabs.length;
              else if (["ArrowLeft", "ArrowUp"].includes(e.key))
                next = (index + mainTabs.length - 1) % mainTabs.length;
              else if (e.key === "Home") next = 0;
              else if (e.key === "End") next = mainTabs.length - 1;
              else return;
              e.preventDefault();
              chooseTab(mainTabs[next]!.id);
              e.currentTarget
                .querySelectorAll<HTMLButtonElement>('[role="tab"]')
                [next]?.focus();
            }}
          >
            {mainTabs.map((t, i) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                tabIndex={tabStop === t.id ? 0 : -1}
                className={`${tab === t.id ? "on" : ""} ${i < phaseIndex ? "done" : ""}`}
                onClick={() => chooseTab(t.id)}
              >
                <span className="step-number">
                  {i < phaseIndex ? <Icon name="check" /> : i + 1}
                </span>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="room-records">
            {TABS.slice(3).map((t) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                aria-pressed={tab === t.id}
                aria-controls={`panel-${t.id}`}
                className={`ghost ${tab === t.id ? "on" : ""}`}
                onClick={() => chooseTab(t.id)}
              >
                <Icon name={t.icon} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div
          className="room-panel"
          role={tab === "report" || tab === "timeline" ? "region" : "tabpanel"}
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
        >
          {tab === "teams" && <TeamsPanel />}
          {tab === "veto" && <VetoPanel />}
          {tab === "match" && <MatchPanel />}
          {tab === "report" && <ReportPanel scrimId={scrimId} />}
          {tab === "timeline" && <Timeline events={events} />}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          <Icon name="check" />
          {toast}
        </div>
      )}
    </Ctx.Provider>
  );
}
