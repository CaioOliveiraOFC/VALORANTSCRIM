import { useEffect, useRef, useState } from 'react';
import type { ScrimSummary } from '../../../shared/protocol';
import { adminFetch } from '../../authFetch';

interface Feature {
  roomId: string | null;
  version: number;
}
async function request(options: RequestInit = {}): Promise<Feature> {
  const response = await adminFetch('/api/admin/home-feature', { cache: 'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(body.error || 'Não foi possível atualizar o destaque.'), {
      status: response.status,
    });
  if (
    !(body.roomId === null || typeof body.roomId === 'string') ||
    !Number.isInteger(body.version) ||
    body.version < 1
  )
    throw new Error(
      'O destaque não respondeu com a versão atualizada. Recarregue antes de tentar novamente.',
    );
  return body as Feature;
}
export function HomeFeatureControl({ rooms }: { rooms: ScrimSummary[] }) {
  const [current, setCurrent] = useState<Feature | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const locked = useRef(false);
  useEffect(() => {
    const ctrl = new AbortController();
    setError('');
    setCurrent(null);
    request({ signal: ctrl.signal })
      .then((value) => {
        if (!ctrl.signal.aborted) {
          setCurrent(value);
          setDraft(value.roomId ?? '');
        }
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) setError((err as Error).message);
      });
    return () => ctrl.abort();
  }, [retry]);
  const published = rooms.filter((room) => room.access?.isPublic && room.access.deletedAt === null);
  const stale = current?.roomId && !published.some((room) => room.id === current.roomId);
  async function save() {
    if (!current || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await request({
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId: draft || null, expectedVersion: current.version }),
      });
      setCurrent(value);
      setDraft(value.roomId ?? '');
      setNotice(
        value.roomId ? 'Sala fixada na página inicial.' : 'Seleção automática de destaque ativada.',
      );
    } catch (err) {
      setError((err as Error).message);
      if ((err as { status?: number }).status === 409) {
        try {
          const value = await request();
          setCurrent(value);
          setDraft(value.roomId ?? '');
        } catch {
          setCurrent(null);
        }
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="card club-feature-settings" aria-labelledby="club-feature-settings-title">
      <div>
        <h3 id="club-feature-settings-title">VCT em destaque na home</h3>
        <p>A seleção automática prioriza partida, veto e montagem. Só você pode fixar uma sala.</p>
      </div>
      {current && (
        <>
          <label>
            Sala em destaque
            <select
              aria-label="Sala em destaque"
              value={draft}
              disabled={busy}
              onChange={(event) => {
                setDraft(event.target.value);
                setNotice('');
              }}
            >
              <option value="">Automático</option>
              {stale && (
                <option value={current.roomId!} disabled>
                  Sala fixada indisponível — destaque automático ativo
                </option>
              )}
              {published.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.title}
                </option>
              ))}
            </select>
          </label>
          {stale && (
            <p className="muted small">
              A sala fixada ficou oculta ou indisponível. Os espectadores recebem o destaque
              automático.
            </p>
          )}
          <button
            type="button"
            className="primary"
            disabled={busy || draft === (current.roomId ?? '')}
            onClick={() => void save()}
          >
            {busy ? 'Salvando…' : 'Salvar destaque'}
          </button>
        </>
      )}
      {!current && !error && <p role="status">Carregando destaque…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          {!current && (
            <button type="button" onClick={() => setRetry((value) => value + 1)}>
              Tentar novamente
            </button>
          )}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
