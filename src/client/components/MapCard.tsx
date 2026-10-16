import { useState } from 'react';
import { MAPS, mapImageUrl, type MapId } from '../../shared/maps';

export type MapCardState = 'available' | 'banned' | 'picked' | 'decider' | 'off';

interface Props {
  mapId: MapId;
  state: MapCardState;
  caption?: string;
  onClick?: () => void;
}

export function MapCard({ mapId, state, caption, onClick }: Props) {
  const [broken, setBroken] = useState(false);
  const map = MAPS[mapId];
  const body = (
    <>
      {!broken && <img src={mapImageUrl(mapId)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />}
      <span className="map-name">{map.name}</span>
      {caption && <span className="map-caption">{caption}</span>}
    </>
  );
  const className = `map-card ${state}`;
  return onClick ? (
    <button type="button" className={className} onClick={onClick} aria-pressed={state === 'picked'}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}
