# Importação de customizadas pela HenrikDev

Depois de entrar em `/admin` com uma conta liberada conforme [ADMIN-SETUP.md](ADMIN-SETUP.md), o organizador pode buscar na aba **Partida** por `Nome#TAG` e região ou colar um UUID/link direto `https://tracker.gg/valorant/match/<UUID>`. A busca retorna até dez partidas recentes de PC, customizadas padrão, completas, com dois times de cinco. A disponibilidade e o atraso dependem da HenrikDev; não é acompanhamento ao vivo.

## Preparar o Preview antes do merge

1. No projeto Supabase existente, aplique as migrações pendentes nesta ordem: `20261016_scrims.sql`, `20261017_match_imports.sql` e **`20261104_room_access.sql`**. A última é obrigatória para os controles de acesso desta versão. Não apague tabelas nem reaplique dados: esta mudança é aditiva e preserva o histórico.
2. Na Vercel, configure `HENRIK_API_KEY` como segredo **somente no servidor**, para os ambientes desejados (Preview/Production). Não use prefixo `VITE_`. O segredo do ambiente Codex não é sincronizado automaticamente para a Vercel.
3. Faça um novo deploy após configurar o segredo. As quatro variáveis Supabase existentes continuam necessárias.
4. Valide o fluxo abaixo com dados fictícios no Preview. Preview e Production compartilham o Supabase; a API antiga ignora a visibilidade. A ocultação só deve ser tratada como privada depois de publicar a versão nova nos domínios ativos e aposentar os deployments/Previews antigos com acesso de serviço ao banco.

## Fluxo do admin

- Conclua o veto e selecione o próximo mapa sem placar/estatísticas. Joguem a customizada no VALORANT; antes da importação, o espectador vê **Aguardando importação da partida para você**.
- Clique em **Buscar customizada**, informe Riot ID/região ou link/UUID e escolha a partida pelo mapa, data, placar e jogadores. Há um aviso quando a partida antecede a criação da scrim; confira explicitamente antes de importar históricos antigos.
- Defina se o **Red** da API corresponde ao Time A ou B. O outro time é associado automaticamente.
- Arraste um jogador da API para um nome manual. Alternativamente, clique/toque no jogador da API e depois no nome manual; os botões também funcionam por teclado.
- O vínculo é um para um. Associar um jogador já vinculado o move, deixando o anterior pendente. Associações entre times diferentes são recusadas. É possível remover os vínculos individualmente.
- Sugestões usam nomes normalizados (maiúsculas, acentos e espaços) ou PUUID já confirmado nessa scrim. Candidatos ambíguos ficam pendentes. Os apelidos manuais não são renomeados. Nos mapas seguintes os vínculos salvos podem ser sugeridos mesmo após mudança no Riot ID.
- Revise os dez vínculos e marque a confirmação explícita. Importe. Se a sala mudou, revise a versão atual antes de confirmar novamente.
- Confira o resultado e use o olho **Mostrar para espectadores** se a sala ainda estiver oculta. A sala também pode ser publicada antes, para a galera acompanhar o veto e os sorteios.

O resultado preenche rounds, placar, K/D/A, agente, dano, ADR, ACS e HS% quando disponíveis. A importação avança a série normalmente e chega aos espectadores pelo evento Realtime existente. A tela de relatório e o Markdown incluem a fonte. Não há marcação manual nem desfazer rounds; a API recusa esses comandos. K/D/A só pode ser ajustado pela ação **Corrigir estatística** depois que o mapa foi importado. A correção é marcada e registrada, preservando os demais dados da API e o evento original. Mapas que já têm dados não são sobrescritos nesta versão.

Os lados reais são derivados do primeiro round quando disponíveis, para o relatório por lado, sem mudar o veto original. A API não fornece timestamps absolutos dos rounds nesse contrato: o evento guarda a sequência, usa o início da partida como referência e usa a duração real informada para o relatório. Não use esses timestamps para sincronizar uma gravação round a round.

## Persistência e segurança

`POST /api/scrims/:id/imports` aceita as ações `search`, `detail` e `confirm`. Todas exigem a sessão de administrador, verificada no servidor pelo Supabase Auth e pela permissão `app_metadata.scrim_admin: true`, antes de consultar a HenrikDev. A sessão usa cookies HttpOnly; o navegador não envia uma chave de sala no corpo da requisição. O navegador envia apenas seleção, mapa, times, vínculos e versão; o servidor consulta novamente a partida na confirmação. IDs e regiões são validados, e as requisições são dirigidas exclusivamente a `api.henrikdev.xyz`.

Um único evento `match.import` contém os dados normalizados e dez associações. O estado mantém IDs manuais, nomes, veto e anotações e adiciona PUUID/Riot ID aos jogadores. A RPC `import_match_result` grava estado, evento e resposta original privada na mesma transação, com comparação de versão e do hash interno da sala, mantido para compatibilidade das RPCs. Esse hash é obtido pelo servidor após autorizar a conta; não funciona como credencial enviada pelo cliente. A chave da Henrik, senhas, cookies, tokens e hash não são incluídos no evento público. A auditoria do evento ainda identifica o ator genericamente como **admin da scrim**: o login autoriza a operação, mas o evento não atribui a importação a uma conta específica.

A tabela `scrim_match_imports` tem RLS, sem acesso anon/authenticated, e chave única `(scrim_id, provider, match_id)`. Duplicatas ou conflitos desfazem toda a transação. A mesma partida pode ser usada em scrims diferentes; não é duplicada dentro da mesma scrim. A tabela não entra na publicação Realtime. Os eventos normalizados só podem ser lidos pelo público enquanto a sala estiver publicada e não excluída, conforme o RLS de `20261104_room_access.sql`.

`claim_match_lookup` limita consultas de forma persistente no Postgres: 12 por minuto por scrim e 60 por minuto no projeto, incluindo buscas, detalhes e confirmações. As janelas são fixas de minuto. Erros 429 da própria HenrikDev também são tratados; esses limites não aumentam a cota contratada do provedor.

Excluir uma sala é uma operação lógica que conserva os eventos e as importações. Restaurar sempre deixa a sala oculta; um admin precisa publicá-la novamente pelo olho. Regras e permissão de exclusão/restauração estão em [ADMIN-SETUP.md](ADMIN-SETUP.md).

## Validação

Os testes cobrem normalização, autorização, dados autoritativos, conflitos, vínculos duplicados, times invertidos, mapas incompatíveis, replay, preservação dos nomes, correções manuais, duas assinaturas Realtime simuladas, SQL real em PGlite, rollback, auditoria privada e limites de consultas. O fluxo visual foi exercitado no Chromium com API simulada: drag and drop real, seleção por clique, revisão obrigatória, largura móvel, importação, relatório e leitura de espectador.

Na validação original da importação, o módulo de servidor foi consultado contra a HenrikDev real com a partida `29bcb708-4964-456c-8844-891fc26fbce0`: Lotus, 13×2, dez jogadores, quinze rounds. A busca por Sova Masterclass#poker encontrou duas customizadas, incluindo a referência. Naquela validação, nenhuma importação ou migração foi aplicada ao Supabase de produção.

No Codex, Node 24 precisou de `NODE_USE_ENV_PROXY=1` para usar o proxy de rede ao testar a API real. Isso não é necessário para o código da aplicação nem deve ser adicionado indiscriminadamente ao deploy da Vercel.
