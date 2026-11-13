import { useEffect, useState } from "react";
import { normalizeBroadcast, type Broadcast } from "../../../shared/streams";
import { adminFetch } from "../../authFetch";

export function parseBroadcasts(value: unknown): Broadcast[] {
  if (!Array.isArray(value))
    throw new Error("Resposta de transmissões inválida.");
  return value.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !(
        item.roomId === null ||
        (typeof item.roomId === "string" &&
          /^[a-z0-9]{6,32}$/.test(item.roomId))
      ) ||
      !Number.isSafeInteger(item.version) ||
      item.version < 0
    )
      throw new Error("Transmissão inválida.");
    return {
      ...normalizeBroadcast(item),
      roomId: item.roomId,
      roomTitle:
        typeof item.roomTitle === "string" ? item.roomTitle : undefined,
      version: item.version,
    };
  });
}
/** Refresh configuration without replacing a viewer's chosen channel or reloading the player. */
export function useBroadcasts(roomId?: string) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false,
      running = false;
    let pending: AbortController | null = null;
    setBroadcasts([]);
    setError("");
    async function refresh() {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      const ctrl = new AbortController();
      pending = ctrl;
      try {
        const response = await adminFetch(
          roomId ? `/api/scrims/${roomId}/streams` : "/api/streams",
          { signal: ctrl.signal, cache: "no-store" },
        );
        if (!response.ok)
          throw new Error("Não foi possível atualizar as transmissões.");
        const body = await response.json();
        const next = parseBroadcasts(body.broadcasts);
        if (!disposed) {
          setBroadcasts(next);
          setError("");
        }
      } catch {
        // Stop embeds when access cannot be confirmed, including hide/delete/revocation.
        if (!disposed && !ctrl.signal.aborted) {
          setBroadcasts([]);
          setError("A transmissão ficou indisponível. Tentaremos reconectar.");
        }
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    const active = () => void refresh();
    addEventListener("focus", active);
    addEventListener("online", active);
    document.addEventListener("visibilitychange", active);
    return () => {
      disposed = true;
      pending?.abort();
      clearInterval(timer);
      removeEventListener("focus", active);
      removeEventListener("online", active);
      document.removeEventListener("visibilitychange", active);
    };
  }, [roomId]);
  return { broadcasts, error };
}
