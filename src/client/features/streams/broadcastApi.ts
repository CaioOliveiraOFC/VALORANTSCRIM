import { adminFetch } from "../../authFetch";
import type { Broadcast } from "../../../shared/streams";
import { parseBroadcasts } from "./useBroadcasts";

async function request(options: RequestInit = {}) {
  const response = await adminFetch("/api/admin/streams", {
    cache: "no-store",
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(body.error || "Não foi possível atualizar a live."),
      { status: response.status },
    );
  return body;
}
export async function adminBroadcasts(signal?: AbortSignal) {
  const result = await request({ signal });
  return parseBroadcasts(result.broadcasts);
}
export async function saveBroadcast(
  roomId: string | null,
  expectedVersion: number,
  config: Pick<Broadcast, "title" | "channels" | "enabled" | "promoteHome">,
) {
  return parseBroadcasts([
    await request({
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId, expectedVersion, ...config }),
    }),
  ])[0]!;
}
