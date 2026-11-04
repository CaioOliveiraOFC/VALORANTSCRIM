import { MAPS } from '../../shared/maps';
import type { ScrimEvent } from '../../shared/scrim';
import { drawResultLabel } from '../../shared/report';
import { fmtTime } from '../util';
import { useRoom } from './ScrimRoom';

/** Log bruto de eventos, legível. É exatamente o que fica gravado em disco. */
export function Timeline({ events }: { events: ScrimEvent[] }) {
  const { state } = useRoom();
  const team = (id: 'A' | 'B') => state.teams[id].name;
  const player = (id: string) => state.players.find((p) => p.id === id)?.name ?? 'jogador removido';
  const draw = (id: string) => state.draws?.find(item => item.id === id);
  const tabLabel = { teams: 'Times', veto: 'Veto', match: 'Partida', report: 'Relatório', timeline: 'Linha do tempo' };

  const describe = (e: ScrimEvent): string => {
    switch (e.type) {
      case 'match.import': return `Partida ${e.match.id} importada da HenrikDev no mapa ${e.mapIndex + 1}, com dez associações confirmadas pelo admin`;
      case 'scrim.create': return `Scrim criada: ${e.title}`;
      case 'settings.update': return `Configuração alterada${e.format ? ` (formato ${e.format.toUpperCase()})` : ''}${e.pool ? ` (pool: ${e.pool.map((m) => MAPS[m].name).join(', ')})` : ''}${e.title ? ` (título: ${e.title})` : ''}`;
      case 'team.rename': return `Time ${e.team} renomeado para ${e.name}`;
      case 'team.captain': return e.playerId ? `${player(e.playerId)} é capitão do ${team(e.team)}` : `${team(e.team)} sem capitão`;
      case 'player.add': return `${e.name} entrou`;
      case 'player.rename': return `Jogador renomeado para ${e.name}`;
      case 'player.remove': return `Jogador removido`;
      case 'player.assign': return `${player(e.playerId)} → ${e.team ? team(e.team) : 'banco'}`;
      case 'teams.set': return 'Times sorteados';
      case 'veto.start': return `Veto iniciado; ${team(e.first)} começa`;
      case 'veto.ban': return `Ban: ${MAPS[e.mapId].name}`;
      case 'veto.pick': return `Pick: ${MAPS[e.mapId].name}`;
      case 'veto.side': return `Lado escolhido: ${e.side === 'atk' ? 'ataque' : 'defesa'}`;
      case 'veto.undo': return 'Veto: desfeito';
      case 'veto.reset': return 'Veto reiniciado';
      case 'round.win': return `Round para ${team(e.team)}${e.note ? ` — ${e.note}` : ''}`;
      case 'round.undo': return 'Round desfeito';
      case 'stats.set': return `Stats de ${player(e.playerId)} no mapa ${e.mapIndex + 1}: ${e.line.kills}/${e.line.deaths}/${e.line.assists}`;
      case 'note.add': return `Anotação: ${e.text}`;
      case 'room.focus': return `Admin chamou a atenção para ${tabLabel[e.focus.target.tab]}${e.focus.target.mapIndex !== undefined ? `, mapa ${e.focus.target.mapIndex + 1}` : ''}`;
      case 'draw.start': return `Sorteio de ${e.draw.kind === 'captains' ? 'capitães' : 'cara ou coroa'} iniciado: ${e.draw.purpose}. Resultado: ${drawResultLabel(e.draw)}. Aguardando decisão do admin.`;
      case 'draw.accept': {
        const item = draw(e.drawId);
        return item ? `Admin aceitou o sorteio “${item.purpose}”: ${drawResultLabel(item)}` : 'Admin aceitou um sorteio';
      }
      case 'draw.reject': {
        const item = draw(e.drawId);
        return item ? `Admin descartou o sorteio “${item.purpose}”: ${drawResultLabel(item)}` : 'Admin descartou um sorteio';
      }
    }
  };

  return (
    <section className="card">
      <h2>Linha do tempo ({events.length} eventos)</h2>
      <ol className="timeline" reversed>
        {[...events].reverse().map((e) => (
          <li key={e.seq}>
            <span className="muted small">#{e.seq} · {fmtTime(e.at)}</span> {describe(e)}
          </li>
        ))}
      </ol>
    </section>
  );
}
