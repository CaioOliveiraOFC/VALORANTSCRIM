import { ALL_MAP_IDS, MAPS } from '../shared/maps.js';
import { DomainError } from '../shared/scrim.js';
import { extractMatchId, type ExternalMatch, type MatchPlayer } from '../shared/imports.js';

export class ProviderError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function regionCode(input: unknown): string {
  if (typeof input !== 'string' || !['br', 'latam', 'na', 'eu', 'ap', 'kr'].includes(input)) throw new DomainError('Região inválida.');
  return input;
}
const text = (x: unknown, max = 128): string => {
  if (typeof x !== 'string' || !x.trim() || x.length > max) throw new ProviderError(502, 'Dados incompletos recebidos da API.');
  return x;
};
const number = (x: unknown): number => {
  if (!Number.isSafeInteger(x) || (x as number) < 0 || (x as number) > 100000000) throw new ProviderError(502, 'Estatísticas inválidas recebidas da API.');
  return x as number;
};
/** Whitelist fields: never expose provider headers, keys or raw response via API. */
export function normalizeMatch(data: any, region: string): ExternalMatch {
  const meta = data?.metadata;
  if (meta?.queue?.name !== 'Custom Game' || meta?.queue?.mode_type !== 'Standard' || meta?.platform !== 'pc' || meta?.is_completed !== true) throw new ProviderError(422, 'Selecione uma customizada 5v5 padrão, de PC, já encerrada.');
  const mapId = ALL_MAP_IDS.find(id => MAPS[id].uuid === meta?.map?.id);
  if (!mapId) throw new ProviderError(422, 'O mapa desta partida ainda não é suportado.');
  const id = extractMatchId(meta.match_id ?? '');
  const startedAt = Date.parse(meta.started_at);
  if (!id || !Number.isFinite(startedAt) || !Array.isArray(data.players) || data.players.length !== 10 || !Array.isArray(data.rounds) || !data.rounds.length || data.rounds.length > 200) throw new ProviderError(422, 'A partida precisa ter dez jogadores e todos os rounds.');
  const players: MatchPlayer[] = data.players.map((p: any) => {
    if (!['Red', 'Blue'].includes(p.team_id)) throw new ProviderError(422, 'Times da partida não suportados.');
    return { puuid: text(p.puuid), name: text(p.name, 64), tag: text(p.tag, 32), team: p.team_id, agent: text(p.agent?.name),
      kills: number(p.stats?.kills), deaths: number(p.stats?.deaths), assists: number(p.stats?.assists), score: number(p.stats?.score), damage: number(p.stats?.damage?.dealt),
      headshots: number(p.stats?.headshots), bodyshots: number(p.stats?.bodyshots), legshots: number(p.stats?.legshots) };
  });
  if (new Set(players.map(p => p.puuid)).size !== 10 || !['Red', 'Blue'].every(t => players.filter(p => p.team === t).length === 5)) throw new ProviderError(422, 'A partida precisa ter dois times de cinco jogadores distintos.');
  const rounds = data.rounds.map((r: any, i: number) => {
    if (r.id !== i || !['Red', 'Blue'].includes(r.winning_team)) throw new ProviderError(502, 'Sequência de rounds incompleta.');
    return r.winning_team as 'Red' | 'Blue';
  });
  const score = { Red: 0, Blue: 0 };
  for (const t of ['Red', 'Blue'] as const) {
    const team = data.teams?.find((x: any) => x.team_id === t);
    score[t] = number(team?.rounds?.won);
    if (rounds.filter((winner: string) => winner === t).length !== score[t]) throw new ProviderError(502, 'Placar e rounds da API divergentes.');
  }
  const first = data.rounds[0];
  const role = first.winning_team_role;
  const redStartingSide = ['Attacker', 'Defender'].includes(role) ? ((first.winning_team === 'Red') === (role === 'Attacker') ? 'atk' : 'def') : undefined;
  return { id, region, mapId, startedAt, durationMs: number(meta.game_length_in_ms), players, rounds, score, ...(redStartingSide ? { redStartingSide } : {}) };
}
async function request(path: string): Promise<any> {
  const key = process.env.HENRIK_API_KEY;
  if (!key) throw new ProviderError(503, 'Importação indisponível: configure HENRIK_API_KEY no servidor da Vercel.');
  let response: Response;
  try {
    response = await fetch(`https://api.henrikdev.xyz${path}`, { headers: { Authorization: key, Accept: 'application/json', 'User-Agent': 'VALORANTSCRIM-integration-check/1.0' }, signal: AbortSignal.timeout(20000), redirect: 'error' });
  } catch { throw new ProviderError(502, 'Não foi possível acessar a API de partidas. Tente novamente.'); }
  if (!response.ok) {
    if (response.status === 429) throw new ProviderError(429, 'Limite de consultas atingido. Aguarde um minuto e tente novamente.');
    if (response.status === 404) throw new ProviderError(404, 'Jogador ou partida não encontrado nesta região.');
    if ([401, 403].includes(response.status)) throw new ProviderError(503, 'A API recusou a credencial do servidor. Confira a configuração da importação.');
    throw new ProviderError(502, 'A API de partidas está indisponível. Tente novamente mais tarde.');
  }
  try { const body = await response.json() as { data?: unknown }; return body.data; }
  catch { throw new ProviderError(502, 'Resposta inválida da API de partidas.'); }
}
export async function fetchMatch(region: string, input: string): Promise<{ match: ExternalMatch; raw: unknown }> {
  const id = extractMatchId(input);
  if (!id) throw new DomainError('Cole o ID ou o link direto de uma partida do Tracker.');
  const raw = await request(`/valorant/v4/match/${regionCode(region)}/${id}`);
  const match = normalizeMatch(raw, region);
  if (match.id !== id) throw new ProviderError(502, 'A API retornou outra partida.');
  return { match, raw };
}
export async function findMatches(region: string, riotId: unknown): Promise<ExternalMatch[]> {
  if (typeof riotId !== 'string' || riotId.length > 100) throw new DomainError('Informe o Riot ID no formato Nome#TAG.');
  const parts = riotId.trim().split('#');
  if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) throw new DomainError('Informe o Riot ID no formato Nome#TAG.');
  const data = await request(`/valorant/v4/matches/${regionCode(region)}/pc/${encodeURIComponent(parts[0].trim())}/${encodeURIComponent(parts[1].trim())}?mode=custom&size=10`);
  if (!Array.isArray(data)) throw new ProviderError(502, 'Histórico inválido recebido da API.');
  const matches: ExternalMatch[] = [];
  for (const entry of data) {
    try { matches.push(normalizeMatch(entry, region)); }
    catch (e) { if (!(e instanceof ProviderError && e.status === 422)) throw e; }
  }
  return matches.sort((a, b) => b.startedAt - a.startedAt);
}
