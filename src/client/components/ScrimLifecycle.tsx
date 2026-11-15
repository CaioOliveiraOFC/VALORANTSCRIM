import { useRef, useState, type FormEvent } from 'react';
import type { Command, ScrimState } from '../../shared/scrim';
import './ScrimLifecycle.css';

export function ScrimLifecycle({ state, canEdit, act, blocked = false }: {
  state: ScrimState; canEdit: boolean; act: (command: Command) => Promise<boolean>; blocked?: boolean;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('Um jogador não pôde continuar.');
  const lock = useRef(false);
  async function run(command: Command) {
    if (lock.current || blocked) return;
    lock.current = true; setBusy(true);
    try { if (await act(command)) setOpen(false); } finally { lock.current = false; setBusy(false); }
  }
  function pause(event: FormEvent) { event.preventDefault(); void run({ type: 'scrim.pause', reason }); }
  if (state.phase === 'paused') return <section className="scrim-paused" aria-label="Empate técnico"><div><span className="scrim-pause-mark" aria-hidden="true">Ⅱ</span><div><h2>Empate técnico · scrim pausada</h2><p>{state.technicalPause?.reason}</p><small>Times, mapas e resultados estão salvos. A scrim pode continuar de onde parou.</small></div></div>{canEdit && <button type="button" className="primary" disabled={busy || blocked} onClick={() => void run({ type: 'scrim.resume' })}>{busy ? 'Retomando…' : 'Retomar scrim'}</button>}</section>;
  if (!canEdit || state.phase === 'finished') return null;
  return <section className="scrim-pause-controls" aria-label="Controle da scrim">{!open ? <button type="button" className="ghost" disabled={blocked} onClick={() => setOpen(true)}>Declarar empate técnico</button> : <form onSubmit={pause}><div><h2>Pausar com empate técnico</h2><p>O evento sai dos destaques ativos. Você pode retomar depois, preservando o placar e o histórico.</p></div><label>Motivo<input name="pause-reason" value={reason} maxLength={280} required disabled={busy} onChange={event => setReason(event.target.value)} /></label><div className="row"><button type="submit" className="primary" disabled={busy || blocked || !reason.trim()}>{busy ? 'Pausando…' : 'Pausar scrim'}</button><button type="button" disabled={busy} className="ghost" onClick={() => setOpen(false)}>Cancelar</button></div></form>}</section>;
}
