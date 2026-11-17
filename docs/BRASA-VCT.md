# Brasa: VCT no centro e identidade em todo o site

Salas 5v5 são a experiência principal. O site público apresenta a comunidade,
as scrims, o histórico e as gravações. O conceito X1 está preservado no código,
mas oculto das páginas públicas. Enquetes, votos e participação democrática
continuam adiados pelo Caio.

## Entrada e navegação

- `/`: apresentação da comunidade e VCT em destaque, usando dados públicos reais.
- `/vct`: lista das salas públicas, mantendo busca, fases e links existentes.
- `/historico`: VCTs encerrados e em **Empate técnico · pode retomar**.
- `/gravacoes`: acervo público dos links de replays.
- `/s/:id`: sala existente, com **Times, Veto, Partida, Relatório e Linha do tempo**.
- `/admin`: organização e permissões atuais, acessível por **Minha organização**.
- `/admin/management`: gestão exclusiva do super admin, incluindo o destaque.
- `/admin/lives`: consulta da mídia dos próprios eventos; edição depende da
  permissão concedida. O super admin consulta todos os eventos e configura a
  live independente na home.
- Os antigos caminhos `/x1` e `/preview/brasa`, incluindo os exemplos de chave
  e sugestões, voltam à home; não oferecem o conceito ao público.

O menu público é **Início · VCT · Histórico · Gravações**. O admin vê a mesma home
pública e seus atalhos de organização. **Lives e gravações** fica disponível
para consulta administrativa mesmo quando a conta não possui edição de mídia.

## Como o destaque funciona

O destaque automático considera apenas a listagem pública atual. Prioriza partida
em andamento, veto e montagem. Quando não houver sala aberta, mostra o último VCT
encerrado. Dentro da mesma fase, a sala atualizada mais recentemente vem primeiro,
com desempate determinístico. Uma lista vazia ou falha não cria partidas fictícias.
O placar só aparece para resultados encerrados ou quando já há vitórias de série;
jogos sem importação não ganham estatísticas estimadas nem edição manual.

O Caio pode fixar uma sala pública em **Administração → Todas as salas → VCT em
destaque na home → Configurar**. Escolher **Automático** remove a fixação.

Uma sala fixada oculta, excluída, em empate técnico ou ausente da listagem não aparece na home. O site
retoma a seleção automática. A escolha armazenada permanece privada para o Caio;
se a sala voltar a ser publicada, volta a ser elegível para a fixação.
Publicação, exclusão e transferência seguem as permissões já existentes.

## Pausa e mídia do evento

**Declarar empate técnico → Pausar scrim** tira a sala dos destaques e das listas
ativas sem alterar jogadores, mapas ou placar. Ela permanece no histórico e
pode voltar à fase anterior com **Retomar scrim**. A pausa e a retomada chegam
aos espectadores pelo log Realtime. Veja [EVENT-PAUSE-MEDIA.md](EVENT-PAUSE-MEDIA.md).

O player fica na própria sala, em **Acompanhe este evento**. **Ao vivo** reúne
links e perspectivas de Twitch, YouTube e Kick; **Gravações** reúne os replays
daquele evento. Não é necessário criar uma transmissão em outro painel para
depois adicioná-la à scrim. O espectador troca sua perspectiva sem alterar a
seleção dos demais.

O Caio também pode divulgar uma live independente na página inicial, sem scrim.
Publicar ou ocultar o player é uma ação manual: o site não detecta início/fim
da live. O acervo mantém links de vídeos, sem copiar arquivos; a disponibilidade
depende da plataforma. Consulte [STREAMS.md](STREAMS.md).

### Instalação necessária apenas para fixar uma sala

Aplicar uma vez no SQL Editor, após `20261105_super_admin.sql`:

**[`20261112_home_feature.sql`](../supabase/migrations/20261112_home_feature.sql)**

A atualização adiciona dois campos à configuração privada e três RPCs. Nenhum
evento, placar, proprietário ou estado de sala é reescrito. Não há nova variável
de ambiente. Antes dessa migração, a home funciona no modo automático. O controle
de fixação mostra a pendência somente ao super admin. Não é necessário reaplicar
as migrações anteriores já instaladas.

As RPCs são exclusivas de `service_role`, com `search_path` vazio. A gravação
revalida conta ativa, UUID do super admin, geração da sessão, visibilidade e versão
esperada dentro da transação. Bloqueios seguem conta → sala → configuração. A
mudança fica na auditoria privada. Duas abas com versões antigas recebem conflito
e revisam a seleção atual, sem sobrescrever a decisão nova.

## Identidade Brasa

Fundo carvão, superfícies quentes, laranja como ação e dourado como destaque.
Barlow Condensed nos títulos, Source Sans 3 nos textos, fontes locais com OFL.
As duas equipes continuam distinguíveis por cores próprias e rótulos.

A identidade foi aplicada à home, listas, salas, login, painéis administrativos,
importação, foco, sorteios, players e guia HTML/PDF. As abas e os fluxos
do VCT, importação exclusiva por API e correção de K/D/A após importar foram
preservados. O favicon e o título do navegador também usam Brasa.

Marca e ícones compartilhados ficam em `src/client/ui`. A listagem pública foi
extraída para `usePublicRooms`, preservando atualização em foco, consultas quando
a aba está visível e cookies necessários à proteção do Preview.

## Evidências da entrega inicial da identidade

- `npm ci --cache /tmp/valorantscrim-npm-cache`, typecheck, build e testes.
- **366 testes em 30 arquivos**, incluindo destaque, permissões, conflito de
  versão, salas ocultas e RLS/RPC da atualização real no PGlite.
- 15 cenários Chromium com API e as cinco migrações SQL reais locais; Auth, REST, Henrik e
  imagens de mapas simulados. Nenhuma gravação no Supabase hospedado.
- Home, lista, histórico, login, organização, super admin, abas VCT, sorteio,
  fixação, conflito entre abas e fallback após ocultação.
- Layouts em 320, 390, 768 e 1440 px; guia e PDF regenerado com cinco páginas A4.

O Preview usa a variável de ambiente automática `VERCEL_ENV`, filtrada para um
rótulo público, e mostra **As salas e alterações são reais**. Isso distingue a
interface conectada do exemplo X1. Não é necessário criar variável no painel.

Capturas: [home desktop](images/brasa-home-desktop.png),
[home mobile](images/brasa-home-mobile.png),
[times](images/brasa-vct-teams.png), [partida](images/brasa-vct-match.png),
[organização](images/brasa-organization-desktop.png),
[fixação](images/brasa-home-settings.png),
[sorteio](images/brasa-draw-dialog.png) e [guia mobile](images/brasa-guide-mobile.png).

## Etapas seguintes

X1 persistente, convites e sugestões reais de apelido/título seguem no plano.
O conceito X1 permanece local no código, sem transmissão de resultados e sem
acesso público. A [referência técnica](BRASA-PREVIEW.md) preserva suas regras.
A reorganização completa do servidor legado fica para uma entrega própria,
sem misturar mudanças de autenticação ao trabalho visual. Domínio e participação
por votação permanecem adiados.
