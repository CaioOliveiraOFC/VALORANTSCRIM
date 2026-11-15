import {
  normalizeStreamSource,
  replaySource,
  type StreamChannel,
} from "./streams.js";

export interface StreamRecording {
  id: string;
  roomId: string | null;
  roomTitle?: string;
  title: string;
  source: StreamChannel;
  isPublic: boolean;
  version: number;
  createdAt: number;
}
export interface RecordingsPage {
  recordings: StreamRecording[];
  total: number;
  nextOffset: number | null;
}
export function recordingInput(input: Record<string, unknown>) {
  if (
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.trim().length > 100 ||
    /[\u0000-\u001f\u007f]/.test(input.title) ||
    typeof input.isPublic !== "boolean" ||
    typeof input.label !== "string"
  )
    throw new Error("Revise o título e a publicação da gravação.");
  return {
    title: input.title.trim(),
    source: replaySource(input.url, input.label),
    isPublic: input.isPublic,
  };
}
export function parseRecording(value: unknown): StreamRecording {
  if (!value || typeof value !== "object")
    throw new Error("Gravação inválida.");
  const r = value as StreamRecording;
  if (
    typeof r.id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(r.id) ||
    !(
      r.roomId === null ||
      (typeof r.roomId === "string" && /^[a-z0-9]{6,32}$/.test(r.roomId))
    ) ||
    typeof r.title !== "string" ||
    !r.title.trim() ||
    r.title.length > 100 ||
    typeof r.isPublic !== "boolean" ||
    !Number.isSafeInteger(r.version) ||
    r.version < 1 ||
    !Number.isSafeInteger(r.createdAt) ||
    r.createdAt < 0
  )
    throw new Error("Gravação inválida.");
  const source = normalizeStreamSource(r.source);
  if (source.kind !== "video")
    throw new Error("O histórico exige uma gravação específica.");
  return { ...r, source };
}
export function parseRecordingsPage(value: unknown): RecordingsPage {
  if (!value || typeof value !== "object")
    throw new Error("Histórico inválido.");
  const p = value as RecordingsPage;
  if (
    !Array.isArray(p.recordings) ||
    !Number.isSafeInteger(p.total) ||
    p.total < 0 ||
    !(
      p.nextOffset === null ||
      (Number.isSafeInteger(p.nextOffset) && p.nextOffset >= 0)
    )
  )
    throw new Error("Histórico inválido.");
  return { ...p, recordings: p.recordings.map(parseRecording) };
}
