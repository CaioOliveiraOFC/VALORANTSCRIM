/** Mensagens trocadas pelo WebSocket entre navegador e servidor. */

import type { Command, ScrimEvent, ScrimState } from './scrim.js';

export type Role = 'admin' | 'viewer';

export type ClientMessage =
  | { type: 'join'; scrimId: string; adminKey?: string }
  | { type: 'command'; requestId: string; command: Command };

export type ServerMessage =
  | { type: 'welcome'; role: Role; state: ScrimState; events: ScrimEvent[] }
  | { type: 'event'; event: ScrimEvent; state: ScrimState }
  | { type: 'ack'; requestId: string }
  | { type: 'error'; requestId?: string; message: string }
  | { type: 'presence'; viewers: number; admins: number };

export interface ScrimSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  phase: ScrimState['phase'];
  teams: [string, string];
  score: [number, number];
  maps: string[];
}

export interface CreateScrimResponse {
  id: string;
  adminKey: string;
}

export const WS_PATH = '/ws';
