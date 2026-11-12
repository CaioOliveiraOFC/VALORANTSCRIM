# Brasa — Churras Club

## Aplicação atual: Vercel + Supabase

A aplicação em uso combina React, Vercel Functions, Supabase Postgres/Realtime e login de organizadores pelo Supabase Auth. Espectadores abrem o link da sala sem conta; administradores entram em `/admin` com e-mail e senha de uma conta liberada pelo responsável pelo site.

- **Deploy e desenvolvimento:** [README-VERCEL.md](README-VERCEL.md).
- **Instalação do acesso:** [ADMIN-SETUP.md](docs/ADMIN-SETUP.md).
- **Criar contas, definir permissões e transferir salas:** [SUPER-ADMIN.md](docs/SUPER-ADMIN.md), pela área `/admin/management` exclusiva do Caio.
- **Tutorial para enviar aos organizadores:** [guia online](public/guia-admin.html) e [PDF](public/guia-admin.pdf), publicados em `/guia-admin.html` e `/guia-admin.pdf`.
- **Partidas pela API:** [importação de customizadas](docs/MATCH-IMPORT.md).
- **Foco e sorteios compartilhados:** [ROOM-TOOLS.md](docs/ROOM-TOOLS.md).
- **Identidade Brasa, home VCT e fixação de destaque:** [BRASA-VCT.md](docs/BRASA-VCT.md).
- **X1 em preparação:** [prévia interativa](docs/BRASA-PREVIEW.md), com dados locais de demonstração.
- **Ideias guardadas e próximas entregas:** [roadmap](docs/ROADMAP.md), incluindo troféus, transmissões Twitch e vídeos de uso.
- **Vídeos de apresentação e ajuda por seção:** [avaliação do Hyperframes](docs/VIDEO-TUTORIALS.md), ainda sem produção ou integração de vídeos.

O organizador atua somente nas próprias salas e nas ações que o Caio liberou. Perfis Organizador e Completo servem como ponto de partida para onze permissões ajustáveis. Só o Caio administra contas e transfere a propriedade das salas; as anteriores à migração ficam inicialmente com ele.

Novas salas começam ocultas. A publicação pelo olho, a importação, a correção de K/D/A e a lixeira dependem das capacidades da conta. Placar e rounds vêm da API e o histórico é preservado. Instale `20261105_super_admin.sql` após as três migrações anteriores: a política privada no banco passa a ser a autoridade de acesso. Flags antigas de `app_metadata`, `user_metadata` e links com `#admin=…` não concedem edição na versão nova.

## Servidor Node legado (referência)

As seções abaixo documentam a implementação original em `src/server`, com WebSocket e arquivos JSONL. Ela permanece no repositório para manutenção e importação do histórico; **não implementa o login atual** e não é a rota usada para hospedar a aplicação na Vercel.

Organizador de scrims com **sala em tempo real**: um admin monta os times, conduz o
veto e marca o placar; até dezenas de espectadores acompanham pelo mesmo link, sem
compartilhar tela. Tudo é **gravado como log de eventos** para gerar relatório depois.

### Como funcionava no servidor legado

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

### Regras de domínio

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

### Executar o servidor legado para manutenção

Requer Node 20+.

```bash
npm ci
npm test
npm run build
npm start          # servidor Node legado, sem o login atual
```

Variáveis desse servidor: `PORT` (padrão 8787) e `DATA_DIR` (padrão `./data`). Para a aplicação atual, `npm run dev` usa a CLI Vercel; consulte [README-VERCEL.md](README-VERCEL.md).

### Hospedagem do servidor legado

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

No cliente original desse servidor, criar uma scrim entregava uma chave/link de admin. Esse fluxo é legado: na aplicação atual, o organizador entra por `/admin` e compartilha apenas o link público da sala.

### Histórico e relatórios do servidor legado

- `GET /api/scrims`: lista de scrims gravadas (tela inicial).
- `GET /api/scrims/:id`: estado + log completo de eventos (JSON).
- `GET /api/scrims/:id/report.md`: relatório em Markdown (veto, placar por mapa,
  rounds por lado, pistols, maior sequência, notas de round, K/D/A, anotações).
- `data/<id>.events.jsonl`: o log bruto, uma linha por evento, fácil de abrir no pandas.

No fluxo original, K/D/A era preenchido à mão a partir do placar final (TAB). A aplicação atual oferece importação pela HenrikDev; consulte [MATCH-IMPORT.md](docs/MATCH-IMPORT.md). A VAL-MATCH-V1 oficial da Riot é uma integração diferente, restrita a produtos aprovados com chave de produção.

### Imagens dos mapas

A Riot não publica um CDN de imagens de mapas; a API oficial (VAL-CONTENT-V1) devolve
só nomes e IDs. As imagens vêm de `media.valorant-api.com`, um espelho público sem chave,
endereçado pelo **UUID oficial** de cada mapa. Para trocar a origem, altere
`MAP_IMAGE_BASE` em `src/shared/maps.ts`. Se uma imagem falhar, o card mostra um
degradê com o nome.

### Estrutura original

```
src/shared/   domínio puro (mapas, veto, redutor de eventos, relatório) + testes
src/server/   HTTP + WebSocket, salas e persistência em JSONL
src/client/   React (Vite)
```
