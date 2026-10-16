# Scrims VALORANT

Organizador de scrims com **sala em tempo real**: um admin monta os times, conduz o
veto e marca o placar; até dezenas de espectadores acompanham pelo mesmo link, sem
compartilhar tela. Tudo é **gravado como log de eventos** para gerar relatório depois.

## Como funciona

```
 Admin (navegador) ──comando──▶ Servidor ──valida + grava (JSONL)──▶ data/<id>.events.jsonl
                                   │
                                   └──evento + estado──▶ admin + 9 espectadores (WebSocket)
```

- **Event sourcing**: cada clique do admin vira um evento numerado com horário. O estado
  é sempre `replay(eventos)`. Isso dá sincronização, histórico, replay e "desfazer" sem
  perder nada (o desfazer também é um evento).
- **Permissões no servidor**: ao criar a scrim o servidor gera uma chave de admin
  (guardada só como hash SHA-256). Quem entra sem ela é espectador e o servidor recusa
  qualquer comando dele.
- **Reconexão automática**: quem cair do Wi-Fi volta sozinho e recebe o estado completo.

## Regras implementadas

| Formato | Sequência (Team A = quem começa o veto) |
|---|---|
| MD3 | ban A, ban B, pick A, lado B, pick B, lado A, ban A, ban B, decider, lado A |
| MD5 | ban A, ban B, pick A, lado B, pick B, lado A, pick A, lado B, pick B, lado A, decider, lado A |
| MD1 | ban A, ban B, ban A, ban B, ban A, ban B, decider, lado B *(convenção; não existe no Tier 1)* |

MD3/MD5 seguem o VCT Official Competition Ruleset: o lado é escolhido por quem **não**
escolheu o mapa, e o lado do decider é do Team A. Quem vence o sorteio/duelo escolhe
ser Team A ou Team B.

Placar: mapa fecha em 13; no 12x12 vai para prorrogação com vantagem de 2. Lados trocam
no round 13 e alternam a cada round na prorrogação.

**Pool padrão (Ato 6, patch 13.08):** Abyss, Bind, Corrode, Haven, Lotus, Summit, Sunset.
Edite `ACTIVE_COMPETITIVE_POOL` em `src/shared/maps.ts` a cada rotação, ou troque a pool
pela tela de configuração.

## Rodar

Requer Node 20+.

```bash
npm install
npm run dev        # servidor :8787 + Vite :5173 (abra http://localhost:5173)
npm test           # regras de veto/placar
npm run build && npm start   # produção em http://localhost:8787
```

Variáveis: `PORT` (padrão 8787) e `DATA_DIR` (padrão `./data`).

## Jogar com os amigos do Discord

O link precisa ser acessível pela internet. Duas opções:

1. **Rodar no seu PC + túnel** (zero custo, bom para a noite de scrim):
   ```bash
   npm run build && npm start
   cloudflared tunnel --url http://localhost:8787   # gera um https://….trycloudflare.com
   ```
   Os dados ficam no seu disco em `data/`.
2. **Hospedar** (fica no ar sempre): use o `Dockerfile` em qualquer serviço com
   WebSocket e **disco persistente** montado em `/data` (Fly.io, Railway, Render com
   disk, uma VPS). Sem disco persistente o histórico some a cada deploy.

Fluxo: crie a scrim → você vira admin → **Copiar link p/ Discord** → cole no canal.
Use **Copiar link de admin** só para abrir como admin em outro dispositivo; não o compartilhe.

## Histórico e relatórios

- `GET /api/scrims`: lista de scrims gravadas (tela inicial).
- `GET /api/scrims/:id`: estado + log completo de eventos (JSON).
- `GET /api/scrims/:id/report.md`: relatório em Markdown (veto, placar por mapa,
  rounds por lado, pistols, maior sequência, notas de round, K/D/A, anotações).
- `data/<id>.events.jsonl`: o log bruto, uma linha por evento, fácil de abrir no pandas.

K/D/A é preenchido à mão a partir do placar final (TAB). Partidas personalizadas não
têm API pública de estatísticas: a VAL-MATCH-V1 oficial da Riot só é liberada para
produtos aprovados com chave de produção.

## Imagens dos mapas

A Riot não publica um CDN de imagens de mapas; a API oficial (VAL-CONTENT-V1) devolve
só nomes e IDs. As imagens vêm de `media.valorant-api.com`, um espelho público sem chave,
endereçado pelo **UUID oficial** de cada mapa. Para trocar a origem, altere
`MAP_IMAGE_BASE` em `src/shared/maps.ts`. Se uma imagem falhar, o card mostra um
degradê com o nome.

## Estrutura

```
src/shared/   domínio puro (mapas, veto, redutor de eventos, relatório) + testes
src/server/   HTTP + WebSocket, salas e persistência em JSONL
src/client/   React (Vite)
```
