export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`br-brand${compact ? ' br-brand-compact' : ''}`}>
      <img src="/brand/brasa-symbol.svg" width="43" height="48" alt="" />
      <span>
        <strong>Brasa</strong>
        <small>Churras Club</small>
      </span>
    </span>
  );
}
