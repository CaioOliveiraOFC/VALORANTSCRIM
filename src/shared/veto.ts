/**
 * Ordens de veto.
 *
 * "first" é o Team A do rulebook (quem começa o veto) e "second" é o Team B.
 * Quem ganhou o sorteio/skirmish escolhe se quer ser Team A ou Team B.
 *
 * Bo3 e Bo5 seguem o VCT Official Competition Ruleset: o lado de cada mapa é
 * escolhido pelo time que NÃO escolheu o mapa, e o lado do decider é do Team A.
 * O Bo1 não existe no Tier 1; usamos a convenção comum de bans alternados
 * com o lado escolhido pelo Team B.
 */

export type SeriesFormat = 'bo1' | 'bo3' | 'bo5';
export type VetoRole = 'first' | 'second';
export type VetoStepKind = 'ban' | 'pick' | 'side' | 'decider';

export interface VetoStepDef {
  kind: VetoStepKind;
  /** Ausente apenas no passo automático "decider". */
  role?: VetoRole;
}

const ban = (role: VetoRole): VetoStepDef => ({ kind: 'ban', role });
const pick = (role: VetoRole): VetoStepDef => ({ kind: 'pick', role });
const side = (role: VetoRole): VetoStepDef => ({ kind: 'side', role });
const decider: VetoStepDef = { kind: 'decider' };

export const VETO_SEQUENCES: Record<SeriesFormat, readonly VetoStepDef[]> = {
  bo1: [ban('first'), ban('second'), ban('first'), ban('second'), ban('first'), ban('second'), decider, side('second')],
  bo3: [
    ban('first'), ban('second'),
    pick('first'), side('second'),
    pick('second'), side('first'),
    ban('first'), ban('second'),
    decider, side('first'),
  ],
  bo5: [
    ban('first'), ban('second'),
    pick('first'), side('second'),
    pick('second'), side('first'),
    pick('first'), side('second'),
    pick('second'), side('first'),
    decider, side('first'),
  ],
};

export const MAPS_IN_SERIES: Record<SeriesFormat, number> = { bo1: 1, bo3: 3, bo5: 5 };

export const FORMAT_LABEL: Record<SeriesFormat, string> = { bo1: 'MD1', bo3: 'MD3', bo5: 'MD5' };

export function mapsToWinSeries(format: SeriesFormat): number {
  return Math.floor(MAPS_IN_SERIES[format] / 2) + 1;
}
