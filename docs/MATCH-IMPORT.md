# Importação de customizadas pela HenrikDev

Na aba **Partida**, o admin pode buscar por `Nome#TAG` e região ou colar um UUID/link direto `https://tracker.gg/valorant/match/<UUID>`. A busca retorna até dez partidas recentes de PC, customizadas padrão, completas, com dois times de cinco. A disponibilidade e o atraso dependem da HenrikDev; não é acompanhamento ao vivo.

## Preparar o Preview antes do merge

1. No projeto Supabase existente, aplique **somente a nova migração** `supabase/migrations/20261017_match_imports.sql`. A migração inicial de scrims já deve estar aplicada. Não apague tabelas nem reaplique dados: esta mudança é aditiva e preserva o histórico.
2. Na Vercel, configure `HENRIK_API_KEY` como segredo **somente no servidor**, para os ambientes desejados (Preview/Production). Não use prefixo `VITE_`. O segredo do ambiente Codex não é sincronizado automaticamente para a Vercel.
3. Faça um novo deploy após configurar o segredo. As quatro variáveis Supabase existentes continuam necessárias.
4. Valide o fluxo abaixo no Preview. Não mescle nem publique a alteração em produção antes de verificar a migração e as variáveis.

## Fluxo do admin

- Conclua o veto e selecione o próximo mapa sem placar/estatísticas.
- Clique em **Buscar customizada**, informe Riot ID/região ou link/UUID e escolha a partida pelo mapa, data, placar e jogadores. Há um aviso quando a partida antecede a criação da scrim; confira explicitamente antes de importar históricos antigos.
- Defina se o **Red** da API corresponde ao Time A ou B. O outro time é associado automaticamente.
- Arraste um jogador da API para um nome manual. Alternativamente, clique/toque no jogador da API e depois no nome manual; os botões também funcionam por teclado.
- O vínculo é um para um. Associar um jogador já vinculado o move, deixando o anterior pendente. Associações entre times diferentes são recusadas. É possível remover os vínculos individualmente.
- Sugestões usam nomes normalizados (maiúsculas, acentos e espaços) ou PUUID já confirmado nessa scrim. Candidatos ambíguos ficam pendentes. Os apelidos manuais não são renomeados. Nos mapas seguintes os vínculos salvos podem ser sugeridos mesmo após mudança no Riot ID.
- Revise os dez vínculos e marque a confirmação explícita. Importe. Se a sala mudou, revise a versão atual antes de confirmar novamente.

O resultado preenche rounds, placar, K/D/A, agente, dano, ADR, ACS e HS% quando disponíveis. A importação avança a série normalmente e chega aos espectadores pelo evento Realtime existente. A tela de relatório e o Markdown incluem a fonte. Correções manuais de K/D/A continuam permitidas e são marcadas; estatísticas originais e o evento de importação permanecem no histórico. Rounds importados não podem ser desfeitos manualmente. Mapas que já têm dados não são sobrescritos nesta versão.

Os lados reais são derivados do primeiro round quando disponíveis, para o relatório por lado, sem mudar o veto original. A API não fornece timestamps absolutos dos rounds nesse contrato: o evento guarda a sequência, usa o início da partida como referência e usa a duração real informada para o relatório. Não use esses timestamps para sincronizar uma gravação round a round.

## Persistência e segurança

`POST /api/scrims/:id/imports` aceita as ações `search`, `detail` e `confirm`. Todas verificam a chave de admin antes de consultar a HenrikDev. O navegador envia apenas seleção, mapa, times, vínculos e versão; o servidor consulta novamente a partida na confirmação. IDs e regiões são validados, e as requisições são dirigidas exclusivamente a `api.henrikdev.xyz`.

Um único evento `match.import` contém os dados normalizados e dez associações. O estado mantém IDs manuais, nomes, veto e anotações e adiciona PUUID/Riot ID aos jogadores. A RPC `import_match_result` grava estado, evento e resposta original privada na mesma transação, com comparação de versão e hash da chave de admin. A chave de API, chave de admin e hash não são incluídos no evento público. A auditoria identifica o ator como **admin da scrim**, pois o aplicativo não possui contas pessoais de administradores.

A tabela `scrim_match_imports` tem RLS, sem acesso anon/authenticated, e chave única `(scrim_id, provider, match_id)`. Duplicatas ou conflitos desfazem toda a transação. A mesma partida pode ser usada em scrims diferentes; não é duplicada dentro da mesma scrim. A tabela não entra na publicação Realtime: somente o evento normalizado público é distribuído.

`claim_match_lookup` limita consultas de forma persistente no Postgres: 12 por minuto por scrim e 60 por minuto no projeto, incluindo buscas, detalhes e confirmações. As janelas são fixas de minuto. Erros 429 da própria HenrikDev também são tratados; esses limites não aumentam a cota contratada do provedor.

## Validação

Os testes cobrem normalização, autorização, dados autoritativos, conflitos, vínculos duplicados, times invertidos, mapas incompatíveis, replay, preservação dos nomes, correções manuais, duas assinaturas Realtime simuladas, SQL real em PGlite, rollback, auditoria privada e limites de consultas. O fluxo visual foi exercitado no Chromium com API simulada: drag and drop real, seleção por clique, revisão obrigatória, largura móvel, importação, relatório e leitura de espectador.

O módulo de servidor também foi consultado contra a HenrikDev real com a partida `29bcb708-4964-456c-8844-891fc26fbce0`: Lotus, 13×2, dez jogadores, quinze rounds. A busca por Sova Masterclass#poker encontrou duas customizadas, incluindo a referência. Nenhuma importação ou migração foi aplicada ao Supabase de produção nesta tarefa.

No Codex, Node 24 precisou de `NODE_USE_ENV_PROXY=1` para usar o proxy de rede ao testar a API real. Isso não é necessário para o código da aplicação nem deve ser adicionado indiscriminadamente ao deploy da Vercel.
