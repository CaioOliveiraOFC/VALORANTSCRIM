# Brasa: VCT no centro e identidade em todo o site

Implementação da organização aprovada no grill. Salas 5v5 continuam sendo a
experiência principal; X1 permanece uma modalidade secundária em preparação.
Enquetes, votos e participação democrática foram adiados pelo Caio.

## Entrada e navegação

- `/`: apresentação da comunidade e VCT em destaque, usando dados públicos reais.
- `/vct`: lista das salas públicas, mantendo busca, fases e links existentes.
- `/historico`: somente os VCTs encerrados.
- `/s/:id`: sala existente, com **Times, Veto, Partida, Relatório e Linha do tempo**.
- `/admin`: organização e permissões atuais, acessível por **Minha organização**.
- `/admin/management`: gestão exclusiva do super admin, incluindo o destaque.
- `/x1`: apresentação secundária, com acesso à demonstração identificada.
- `/preview/brasa?tela=x1`: chave X1 com dados locais de exemplo.
- `/preview/brasa?tela=sugestoes`: sugestões locais de apelido e título.
- `/preview/brasa` sem tela específica abre a home VCT, preservando o link antigo.

O menu público é **Início · VCT · X1 · Histórico**. O admin vê a mesma home pública
e seus atalhos de organização. Sugestões do exemplo ficam dentro do evento.

## Como o destaque funciona

O destaque automático considera apenas a listagem pública atual. Prioriza partida
em andamento, veto e montagem. Quando não houver sala aberta, mostra o último VCT
encerrado. Dentro da mesma fase, a sala atualizada mais recentemente vem primeiro,
com desempate determinístico. Uma lista vazia ou falha não cria partidas fictícias.
O placar só aparece para resultados encerrados ou quando já há vitórias de série;
jogos sem importação não ganham estatísticas estimadas nem edição manual.

O Caio pode fixar uma sala pública em **Administração → Todas as salas → VCT em
destaque na home → Configurar**. Escolher **Automático** remove a fixação.

Uma sala fixada oculta, excluída ou ausente da listagem não aparece na home. O site
retoma a seleção automática. A escolha armazenada permanece privada para o Caio;
se a sala voltar a ser publicada, volta a ser elegível para a fixação.
Publicação, exclusão e transferência seguem as permissões já existentes.

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
importação, foco, sorteios, demonstração X1 e guia HTML/PDF. As abas e os fluxos
do VCT, importação exclusiva por API e correção de K/D/A após importar foram
preservados. O favicon e o título do navegador também usam Brasa.

Marca e ícones compartilhados ficam em `src/client/ui`. A listagem pública foi
extraída para `usePublicRooms`, preservando atualização em foco, consultas quando
a aba está visível e cookies necessários à proteção do Preview.

## Validação

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
O exemplo X1 continua local e não transmite resultados para espectadores.
A reorganização completa do servidor legado fica para uma entrega própria,
sem misturar mudanças de autenticação ao trabalho visual. Domínio e participação
por votação permanecem adiados.
