import { MAPS, type MapId } from "../../shared/maps";
import {
  availableMaps,
  currentVetoStep,
  describeVetoEntry,
  roleToTeam,
  type Side,
} from "../../shared/scrim";
import { VETO_SEQUENCES, type VetoStepDef } from "../../shared/veto";
import { MapCard, type MapCardState } from "./MapCard";
import { useRoom } from "./ScrimRoom";

const KIND_LABEL: Record<VetoStepDef["kind"], string> = {
  ban: "Banir",
  pick: "Escolher",
  side: "Lado",
  decider: "Desempate",
};

export function VetoPanel() {
  const { state, isAdmin, act } = useRoom();

  if (state.phase === "setup") {
    return (
      <div className="card empty-state">
        <h2>Fechem os times primeiro</h2>
        <p>
          Com cinco jogadores de cada lado, o organizador pode iniciar a escolha
          dos mapas na aba Preparar.
        </p>
      </div>
    );
  }

  const canReset =
    ["veto", "live"].includes(state.phase) &&
    state.maps.every((map) => map.rounds.length === 0);
  const sequence = VETO_SEQUENCES[state.format];
  const step = currentVetoStep(state);
  const free = new Set(availableMaps(state));
  const lastFor = new Map(
    state.veto
      .filter((entry) => entry.kind !== "side")
      .map((entry) => [entry.mapId, entry]),
  );
  const canChooseMap =
    isAdmin && step && (step.kind === "ban" || step.kind === "pick");
  const sideMap =
    step?.kind === "side"
      ? [...state.veto]
          .reverse()
          .find((entry) => entry.kind === "pick" || entry.kind === "decider")
      : null;

  const cardState = (id: MapId): MapCardState => {
    const entry = lastFor.get(id);
    if (!entry) return "available";
    return entry.kind === "ban"
      ? "banned"
      : entry.kind === "decider"
        ? "decider"
        : "picked";
  };
  const caption = (id: MapId) => {
    const entry = lastFor.get(id);
    if (!entry) return undefined;
    if (entry.kind === "decider") return "Desempate";
    return `${entry.kind === "ban" ? "Banido por" : "Escolhido por"} ${state.teams[entry.team!].name}`;
  };

  return (
    <div className="stack veto-stage">
      <header className="veto-instruction" aria-live="polite">
        <div>
          <h2>
            {step ? (
              <>
                <span className={`team-${step.team}`}>
                  {state.teams[step.team].name}
                </span>
                ,{" "}
                {step.kind === "ban"
                  ? "tire um mapa"
                  : step.kind === "pick"
                    ? "escolha um mapa"
                    : `escolha o lado${sideMap ? ` em ${MAPS[sideMap.mapId].name}` : ""}`}
              </>
            ) : (
              "Mapas definidos. Bora jogar."
            )}
          </h2>
          <p className="muted">
            {step
              ? !isAdmin
                ? "Aguardando o organizador registrar a escolha."
                : step.kind === "ban"
                  ? "O mapa escolhido fica fora da série."
                  : step.kind === "pick"
                    ? "O mapa escolhido entra na série."
                    : "Este será o lado inicial do time."
              : "As escolhas dos dois times estão salvas abaixo."}
          </p>
        </div>
        {isAdmin && canReset && state.veto.length > 0 && (
          <button className="ghost" onClick={() => act({ type: "veto.undo" })}>
            Desfazer escolha
          </button>
        )}
      </header>

      {isAdmin && step?.kind === "side" && (
        <div
          className="side-choice"
          role="group"
          aria-label={`Lado inicial de ${state.teams[step.team].name}`}
        >
          {(["atk", "def"] as Side[]).map((side) => (
            <button
              key={side}
              className={`side-option btn-${side}`}
              onClick={() => act({ type: "veto.side", side })}
            >
              {side === "atk" ? "Começar no ataque" : "Começar na defesa"}
            </button>
          ))}
        </div>
      )}

      <div className="map-grid" aria-label="Pool de mapas">
        {state.pool.map((id) => (
          <MapCard
            key={id}
            mapId={id}
            state={cardState(id)}
            caption={caption(id)}
            onClick={
              canChooseMap && free.has(id)
                ? () =>
                    act({
                      type: step.kind === "ban" ? "veto.ban" : "veto.pick",
                      mapId: id,
                    })
                : undefined
            }
          />
        ))}
      </div>

      <details className="card veto-options">
        <summary>
          Ver ordem das escolhas{isAdmin && canReset ? " e reiniciar" : ""}
        </summary>
        <ol className="veto-order">
          {sequence.map((definition, index) => {
            const done = state.veto[index];
            const team = definition.role
              ? state.teams[roleToTeam(state, definition.role)].name
              : "";
            return (
              <li
                key={index}
                className={
                  done ? "done" : step?.index === index ? "current" : ""
                }
                aria-current={step?.index === index ? "step" : undefined}
              >
                <span className={`kind ${definition.kind}`}>
                  {KIND_LABEL[definition.kind]}
                </span>
                <span>
                  {done
                    ? describeVetoEntry(state, done)
                    : definition.kind === "decider"
                      ? "O mapa que sobrar"
                      : team}
                </span>
              </li>
            );
          })}
        </ol>
        {isAdmin && canReset && (
          <button
            className="ghost"
            onClick={() =>
              confirm(
                "Reiniciar a escolha dos mapas? Todas as escolhas atuais serão desfeitas.",
              ) && act({ type: "veto.reset" })
            }
          >
            Reiniciar escolha dos mapas
          </button>
        )}
      </details>
    </div>
  );
}
