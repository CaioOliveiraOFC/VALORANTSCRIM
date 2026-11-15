import { adminFetch } from "../../authFetch";
import {
  parseRecording,
  parseRecordingsPage,
} from "../../../shared/recordings";

export async function recordingRequest(
  path: string,
  options: RequestInit = {},
) {
  const response = await adminFetch(path, { cache: "no-store", ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(body.error || "Não foi possível carregar as gravações."),
      { status: response.status },
    );
  return body;
}
export async function listRecordings(
  admin = false,
  offset = 0,
  roomId?: string,
) {
  const params = new URLSearchParams({
    offset: String(offset),
    ...(roomId ? { roomId } : {}),
  });
  return parseRecordingsPage(
    await recordingRequest(
      `${admin ? "/api/admin/stream-recordings" : "/api/streams/recordings"}?${params}`,
    ),
  );
}
export async function getRecording(id: string, signal?: AbortSignal) {
  return parseRecording(
    await recordingRequest(
      `/api/streams/recordings/${encodeURIComponent(id)}`,
      { signal },
    ),
  );
}
