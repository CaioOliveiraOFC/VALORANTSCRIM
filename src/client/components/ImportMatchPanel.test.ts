import { createElement, useState } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  readyScrim,
  sampleLinks,
  sampleMatch,
} from "../../test/import-fixture";
import type { PlayerLink } from "../../shared/imports";

const mocks = vi.hoisted(() => ({ room: {} as any }));
vi.mock("./ScrimRoom", () => ({ useRoom: () => mocks.room }));
import { ImportMatchPanel, PlayerMatcher } from "./ImportMatchPanel";

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
});
beforeEach(() => {
  mocks.room = {
    state: readyScrim().state,
    isAdmin: true,
    importRequest: vi.fn(),
  };
});

function text(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("");
}
function button(label: string) {
  const found = renderer!.root
    .findAllByType("button")
    .find((node) => node.props["aria-label"] === label || text(node) === label);
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}
function target(name: string) {
  return renderer!.root
    .findAll(
      (node) =>
        node.type === "div" &&
        node.props.className?.split(" ").includes("mapping-target"),
    )
    .find((node) =>
      node.findAllByType("strong").some((strong) => text(strong) === name),
    )!;
}
function drag(source: ReactTestInstance, destination: ReactTestInstance) {
  const values = new Map<string, string>();
  const dataTransfer = {
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? "",
    effectAllowed: "",
  };
  source.props.onDragStart({ dataTransfer });
  destination.props.onDrop({
    preventDefault() {},
    stopPropagation() {},
    dataTransfer,
  });
}
function matcher(initial: PlayerLink[] = []) {
  let links = initial;
  function Harness() {
    const [current, setCurrent] = useState(initial);
    links = current;
    return createElement(PlayerMatcher, {
      state: mocks.room.state,
      match: sampleMatch(),
      redTeam: "A",
      links: current,
      onChange: setCurrent,
    });
  }
  act(() => {
    renderer = create(createElement(Harness));
  });
  return () => links;
}
function review() {
  return renderer!.root.findByProps({ type: "checkbox" });
}
function importButton() {
  return button("Importar Lotus — 13:2");
}
async function searchMatch(match = sampleMatch(), direct = false) {
  const request = vi
    .fn()
    .mockResolvedValueOnce(direct ? { match } : { matches: [match] })
    .mockResolvedValue({});
  mocks.room.importRequest = request;
  await act(async () => {
    renderer = create(createElement(ImportMatchPanel, { mapIndex: 0 }));
  });
  act(() => button("Importar partida").props.onClick());
  act(() =>
    renderer!.root
      .findByProps({ placeholder: "Nome#TAG ou link do Tracker" })
      .props.onChange({
        target: { value: direct ? match.id : "Sova#TEST" },
      }),
  );
  await act(async () => {
    renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} });
  });
  if (!direct) {
    act(() =>
      renderer!.root
        .findAllByType("button")
        .find((node) =>
          node
            .findAllByType("strong")
            .some((strong) => text(strong) === "Lotus"),
        )!
        .props.onClick(),
    );
  }
  return request;
}

it("chooses an identity beside an alias, keeps links unique, and allows removal", () => {
  const links = matcher();
  act(() => button("Escolher jogador para Apelido 0").props.onClick());
  act(() => button("Selecionar Riot 0#TEST").props.onClick());
  expect(links()).toEqual([{ playerId: "p0", puuid: "puuid-0" }]);
  expect(button("Trocar jogador para Apelido 0").props["aria-expanded"]).toBe(
    false,
  );

  act(() => button("Escolher jogador para Apelido 1").props.onClick());
  act(() => button("Selecionar Riot 0#TEST").props.onClick());
  expect(links()).toEqual([{ playerId: "p1", puuid: "puuid-0" }]);
  expect(button("Escolher jogador para Apelido 0")).toBeDefined();

  act(() => button("Trocar jogador para Apelido 1").props.onClick());
  act(() => button("Remover associação de Apelido 1").props.onClick());
  expect(links()).toEqual([]);
});

it("drags an API identity to an alias and rejects a drop onto the other team", () => {
  const links = matcher();
  act(() => button("Escolher jogador para Apelido 0").props.onClick());
  act(() => drag(button("Selecionar Riot 0#TEST"), target("Apelido 1")));
  expect(links()).toEqual([{ playerId: "p1", puuid: "puuid-0" }]);

  act(() => button("Escolher jogador para Apelido 0").props.onClick());
  act(() => drag(button("Selecionar Riot 0#TEST"), target("Apelido 5")));
  expect(links()).toEqual([{ playerId: "p1", puuid: "puuid-0" }]);
  expect(text(renderer!.root.findByProps({ role: "status" }))).toContain(
    "outro time",
  );
});

it("drags a manual alias onto an API identity", () => {
  const links = matcher();
  act(() => button("Escolher jogador para Apelido 0").props.onClick());
  act(() =>
    drag(
      target("Apelido 1").findByProps({ className: "manual-name" }),
      button("Selecionar Riot 1#TEST"),
    ),
  );
  expect(links()).toEqual([{ playerId: "p1", puuid: "puuid-1" }]);
});

it("requires ten valid links and explicit review in the same workspace before importing", async () => {
  const request = await searchMatch();
  expect(review().props.disabled).toBe(true);
  expect(importButton().props.disabled).toBe(true);
  await act(async () => {
    await importButton().props.onClick();
  });
  expect(request).toHaveBeenCalledTimes(1);

  act(() =>
    renderer!.root
      .findByType(PlayerMatcher)
      .props.onChange(sampleLinks().slice(0, 9)),
  );
  expect(review().props.disabled).toBe(true);
  act(() =>
    renderer!.root.findByType(PlayerMatcher).props.onChange(sampleLinks()),
  );
  expect(review().props.disabled).toBe(false);
  expect(importButton().props.disabled).toBe(true);
  await act(async () => {
    await importButton().props.onClick();
  });
  expect(request).toHaveBeenCalledTimes(1);

  act(() => review().props.onChange({ target: { checked: true } }));
  expect(importButton().props.disabled).toBe(false);
  await act(async () => {
    await importButton().props.onClick();
  });
  expect(request).toHaveBeenLastCalledWith({
    action: "confirm",
    region: "br",
    matchId: sampleMatch().id,
    mapIndex: 0,
    redTeam: "A",
    links: sampleLinks(),
    expectedVersion: mocks.room.state.version,
  });
  expect(text(renderer!.root)).toContain(
    "Partida importada. Os vínculos estão salvos para a próxima.",
  );
});

it("invalidates explicit review when an association changes or suggestions are restored", async () => {
  const request = await searchMatch();
  act(() =>
    renderer!.root.findByType(PlayerMatcher).props.onChange(sampleLinks()),
  );
  act(() => review().props.onChange({ target: { checked: true } }));
  act(() => button("Trocar jogador para Apelido 0").props.onClick());
  act(() => button("Selecionar Riot 1#TEST").props.onClick());
  expect(review().props.checked).toBe(false);
  expect(importButton().props.disabled).toBe(true);

  act(() =>
    renderer!.root.findByType(PlayerMatcher).props.onChange(sampleLinks()),
  );
  act(() => review().props.onChange({ target: { checked: true } }));
  act(() => button("Restaurar sugestões").props.onClick());
  expect(review().props.checked).toBe(false);
  expect(importButton().props.disabled).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});

it("suggests reversed team orientation from saved identities without silently confirming", async () => {
  const match = sampleMatch();
  for (const player of match.players)
    player.team = player.team === "Red" ? "Blue" : "Red";
  mocks.room.state.players = mocks.room.state.players.map(
    (player: any, i: number) => ({
      ...player,
      riot: { puuid: `puuid-${i}`, name: `Old ${i}`, tag: "OLD" },
    }),
  );
  await searchMatch(match, true);
  expect(renderer!.root.findByType(PlayerMatcher).props.redTeam).toBe("B");
  expect(renderer!.root.findByType(PlayerMatcher).props.links).toHaveLength(10);
  expect(review().props.checked).toBe(false);
  expect(importButton().props.disabled).toBe(true);
  act(() => review().props.onChange({ target: { checked: true } }));
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Time da scrim correspondente ao Red" })
      .props.onChange({ target: { value: "A" } }),
  );
  expect(review().props.checked).toBe(false);
  expect(importButton().props.disabled).toBe(true);
});

it("blocks confirmation of a result from a different map", async () => {
  const match = { ...sampleMatch(), mapId: "bind" as const };
  const request = await searchMatch(match, true);
  act(() =>
    renderer!.root.findByType(PlayerMatcher).props.onChange(sampleLinks()),
  );
  expect(review().props.disabled).toBe(true);
  expect(button("Importar Bind — 13:2").props.disabled).toBe(true);
  expect(text(renderer!.root.findByProps({ role: "alert" }))).toContain(
    "resultado é de Bind",
  );
  act(() => review().props.onChange({ target: { checked: true } }));
  await act(async () => {
    await button("Importar Bind — 13:2").props.onClick();
  });
  expect(request).toHaveBeenCalledTimes(1);
});

it("requires another explicit review if the room version changes before import", async () => {
  const request = await searchMatch();
  act(() =>
    renderer!.root.findByType(PlayerMatcher).props.onChange(sampleLinks()),
  );
  act(() => review().props.onChange({ target: { checked: true } }));
  const nextVersion = mocks.room.state.version + 1;
  mocks.room.state = { ...mocks.room.state, version: nextVersion };
  act(() => renderer!.update(createElement(ImportMatchPanel, { mapIndex: 0 })));
  expect(review().props.disabled).toBe(true);
  expect(importButton().props.disabled).toBe(true);
  await act(async () => {
    await importButton().props.onClick();
  });
  expect(request).toHaveBeenCalledTimes(1);

  act(() => button("Revisar versão atual").props.onClick());
  expect(review().props.checked).toBe(false);
  expect(review().props.disabled).toBe(false);
  expect(importButton().props.disabled).toBe(true);
  act(() => review().props.onChange({ target: { checked: true } }));
  await act(async () => {
    await importButton().props.onClick();
  });
  expect(request).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedVersion: nextVersion }),
  );
});

it("renders no import controls for spectators", () => {
  mocks.room.isAdmin = false;
  act(() => {
    renderer = create(createElement(ImportMatchPanel, { mapIndex: 0 }));
  });
  expect(renderer!.toJSON()).toBeNull();
});
