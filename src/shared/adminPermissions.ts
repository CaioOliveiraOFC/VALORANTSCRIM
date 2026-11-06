/** Account policy shared by the server and its administrative interface. */
export const PERMISSION_KEYS = [
  'createRooms', 'editRoom', 'manageTeams', 'manageVeto', 'manageDraws', 'manageFocus',
  'importMatches', 'correctStats', 'manageNotes', 'publishRooms', 'deleteRooms',
] as const;

export type AdminPermissionKey = typeof PERMISSION_KEYS[number];
export type AdminPermissions = Record<AdminPermissionKey, boolean>;
export type AdminPreset = 'organizer' | 'full';

export const PERMISSION_DEFINITIONS: readonly {
  key: AdminPermissionKey; label: string; description: string; group?: string;
}[] = [
  { key: 'createRooms', label: 'Criar salas', description: 'Cria novas scrims para organizar.', group: 'Sala' },
  { key: 'editRoom', label: 'Editar a sala', description: 'Altera o nome, o formato e as configurações das próprias salas.', group: 'Sala' },
  { key: 'manageTeams', label: 'Montar os times', description: 'Gerencia jogadores, equipes e capitães.', group: 'Preparação' },
  { key: 'manageVeto', label: 'Escolher os mapas', description: 'Registra bans, picks e o lado inicial de cada mapa.', group: 'Preparação' },
  { key: 'manageDraws', label: 'Controlar sorteios', description: 'Inicia, aceita ou descarta sorteios de capitães e cara ou coroa.', group: 'Condução' },
  { key: 'manageFocus', label: 'Chamar os participantes', description: 'Leva os espectadores para a seção que precisa de atenção.', group: 'Condução' },
  { key: 'importMatches', label: 'Importar partidas', description: 'Busca e confirma resultados e jogadores pela API.', group: 'Resultados' },
  { key: 'correctStats', label: 'Corrigir estatísticas', description: 'Corrige K/D/A de resultados já importados.', group: 'Resultados' },
  { key: 'manageNotes', label: 'Adicionar anotações', description: 'Registra observações no relatório da scrim.', group: 'Resultados' },
  { key: 'publishRooms', label: 'Publicar ou ocultar salas', description: 'Define a visibilidade pública das próprias salas.', group: 'Sala' },
  { key: 'deleteRooms', label: 'Gerenciar a lixeira', description: 'Retira as próprias salas da lista e permite restaurá-las, preservando o histórico.', group: 'Sala' },
];

export function noPermissions(): AdminPermissions {
  return Object.fromEntries(PERMISSION_KEYS.map(key => [key, false])) as AdminPermissions;
}

export function presetPermissions(preset: AdminPreset): AdminPermissions {
  if (preset !== 'organizer' && preset !== 'full') throw new Error('Perfil de administrador inválido.');
  const permissions = Object.fromEntries(PERMISSION_KEYS.map(key => [key, true])) as AdminPermissions;
  if (preset === 'organizer') { permissions.correctStats = false; permissions.deleteRooms = false; }
  return permissions;
}

/** A partial explicit policy is allowed; absent capabilities are always denied. */
export function parsePermissions(value: unknown): AdminPermissions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Permissões inválidas.');
  const permissions = noPermissions();
  for (const [key, allowed] of Object.entries(value)) {
    if (!(PERMISSION_KEYS as readonly string[]).includes(key) || typeof allowed !== 'boolean') {
      throw new Error('Use somente as permissões conhecidas, com valores verdadeiro ou falso.');
    }
    permissions[key as AdminPermissionKey] = allowed;
  }
  return permissions;
}

export interface AdminAccount {
  id: string;
  email: string;
  displayName: string;
  active: boolean;
  preset: AdminPreset;
  permissions: AdminPermissions;
  version: number;
  isSuperAdmin: boolean;
  provisioned: boolean;
  createdAt: number;
  updatedAt: number;
  /** True while a password operation has not been confirmed. No credential is exposed. */
  passwordResetPending?: boolean;
}

export interface AdminAccountsPage {
  accounts: AdminAccount[];
  total: number;
  nextOffset: number | null;
}
