/**
 * Catálogo de mapas 5v5 do VALORANT.
 *
 * Os UUIDs são os identificadores de conteúdo do próprio jogo (os mesmos que o
 * endpoint oficial VAL-CONTENT-V1 da Riot devolve). A Riot não publica um CDN
 * de imagens para mapas, então as imagens vêm do espelho público e sem chave
 * de media.valorant-api.com, endereçado pelo UUID oficial. Se algum dia você
 * hospedar as imagens por conta própria, basta trocar MAP_IMAGE_BASE.
 */

export const MAP_IMAGE_BASE = 'https://media.valorant-api.com/maps';

export interface MapInfo {
  /** Slug estável usado no estado e nos eventos. */
  id: string;
  name: string;
  /** UUID de conteúdo do jogo. */
  uuid: string;
  sites: 'A/B' | 'A/B/C';
}

export const MAPS = {
  abyss: { id: 'abyss', name: 'Abyss', uuid: '224b0a95-48b9-f703-1bd8-67aca101a61f', sites: 'A/B' },
  ascent: { id: 'ascent', name: 'Ascent', uuid: '7eaecc1b-4337-bbf6-6ab9-04b8f06b3319', sites: 'A/B' },
  bind: { id: 'bind', name: 'Bind', uuid: '2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba', sites: 'A/B' },
  breeze: { id: 'breeze', name: 'Breeze', uuid: '2fb9a4fd-47b8-4e7d-a969-74b4046ebd53', sites: 'A/B' },
  corrode: { id: 'corrode', name: 'Corrode', uuid: '1c18ab1f-420d-0d8b-71d0-77ad3c439115', sites: 'A/B' },
  fracture: { id: 'fracture', name: 'Fracture', uuid: 'b529448b-4d60-346e-e89e-00a4c527a405', sites: 'A/B' },
  haven: { id: 'haven', name: 'Haven', uuid: '2bee0dc9-4ffe-519b-1cbd-7fbe763a6047', sites: 'A/B/C' },
  icebox: { id: 'icebox', name: 'Icebox', uuid: 'e2ad5c54-4114-a870-9641-8ea21279579a', sites: 'A/B' },
  lotus: { id: 'lotus', name: 'Lotus', uuid: '2fe4ed3a-450a-948b-6d6b-e89a78e680a9', sites: 'A/B/C' },
  pearl: { id: 'pearl', name: 'Pearl', uuid: 'fd267378-4d1d-484f-ff52-77821ed10dc2', sites: 'A/B' },
  split: { id: 'split', name: 'Split', uuid: 'd960549e-485c-e861-8d71-aa9d1aed12a2', sites: 'A/B' },
  summit: { id: 'summit', name: 'Summit', uuid: '756da597-416b-c0f2-f47b-afbdf28670bc', sites: 'A/B' },
  sunset: { id: 'sunset', name: 'Sunset', uuid: '92584fbe-486a-b1b2-9faa-39b0f486b498', sites: 'A/B' },
} as const satisfies Record<string, MapInfo>;

export type MapId = keyof typeof MAPS;

export const ALL_MAP_IDS = Object.keys(MAPS) as MapId[];

export function isMapId(value: unknown): value is MapId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MAPS, value);
}

/** Pool competitiva do Ato 6 (patch 13.08, 13/10/2026): entram Bind e Corrode, saem Ascent e Split. */
export const ACTIVE_COMPETITIVE_POOL: MapId[] = ['abyss', 'bind', 'corrode', 'haven', 'lotus', 'summit', 'sunset'];

export const POOL_SIZE = 7;

export type MapImageKind = 'banner' | 'splash';

/** banner ≈ 56 KB (cards); splash ≈ 5 MB, use com moderação. */
export function mapImageUrl(id: MapId, kind: MapImageKind = 'banner'): string {
  const file = kind === 'banner' ? 'listviewicon.png' : 'splash.png';
  return `${MAP_IMAGE_BASE}/${MAPS[id].uuid}/${file}`;
}
