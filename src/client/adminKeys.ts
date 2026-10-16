/**
 * A chave de admin viaja no fragmento da URL (#admin=...), que o navegador
 * nunca envia ao servidor nem em Referer. Ao abrir o link ela é guardada no
 * localStorage e removida da barra de endereço, para não vazar num print.
 */

const storageKey = (id: string) => `scrim-admin:${id}`;

export function readAdminKey(scrimId: string): string | undefined {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('admin');
  if (fromHash) {
    try {
      localStorage.setItem(storageKey(scrimId), fromHash);
    } catch {
      /* modo privado: segue só com a chave da URL */
    }
    history.replaceState(null, '', location.pathname + location.search);
    return fromHash;
  }
  try {
    return localStorage.getItem(storageKey(scrimId)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function forgetAdminKey(scrimId: string) {
  try {
    localStorage.removeItem(storageKey(scrimId));
  } catch {
    /* ignora */
  }
}
