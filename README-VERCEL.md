# Deploy na Vercel + Supabase — Scrims VALORANT

A aplicação usa React, Vercel Functions, Supabase Postgres (estado e log de eventos) e Supabase Realtime (Postgres Changes + Presence). Organizadores entram em `/admin` com identidade Supabase Auth e capacidades definidas na política privada do banco. Cada um administra somente as próprias salas. O Caio é o único super admin, com gestão de contas e acesso global em `/admin/management`. Espectadores acompanham salas publicadas sem login.

Para a instalação inicial, siga [ADMIN-SETUP.md](docs/ADMIN-SETUP.md). Para criar, suspender, redefinir senhas, alterar permissões ou transferir salas pela interface, consulte [SUPER-ADMIN.md](docs/SUPER-ADMIN.md). O material para os organizadores é o [guia online](public/guia-admin.html) e o [PDF](public/guia-admin.pdf), publicados em `/guia-admin.html` e `/guia-admin.pdf`.

## Configurar sem instalar nada no PC

1. Crie um projeto em https://supabase.com/dashboard (região próxima dos jogadores).
2. Em um projeto novo, aplique os arquivos SQL na ordem indicada abaixo. Antes de `20261105_super_admin.sql`, confira a conta confirmada do Caio no Auth. Para atualizar um projeto em uso, preserve tabelas e histórico e siga a ordem coordenada descrita em **Atualizar permissões de mídia em um projeto em uso**; essa atualização publica a aplicação compatível antes do novo SQL.
3. Na Vercel, importe `CaioOliveiraOFC/VALORANTSCRIM` e selecione a branch de produção. Framework Preset: **Vite**. Build Command: `npm run build`. Output Directory: `dist`.
4. Configure em **Project Settings → Environment Variables** as quatro variáveis Supabase de `.env.example` e `HENRIK_API_KEY` para importar partidas. Escolha os ambientes Production/Preview e o projeto Supabase correspondente a cada um. `SUPABASE_SERVICE_ROLE_KEY` e `HENRIK_API_KEY` são segredos de servidor: nunca use prefixo `VITE_`.
5. A migração de super admin fixa o UUID da conta existente `caio.oliveira2014@hotmail.com`, importa admins legados e atribui as salas anteriores ao Caio, preservando os dados. Depois, crie os organizadores e seus perfis pela área **Administração**. Não há cadastro público nem SQL recorrente por conta.
6. Faça o deploy e teste `/api/health` (`ok:true`). Entre como Caio, confira `/admin/management` e crie organizadores e salas fictícias para testar propriedade e capacidades. Publique uma sala pelo olho e abra seu link em uma janela privada como espectador. Novas salas começam ocultas; o checkbox **Mostrar para espectadores** permite publicá-las na criação. A proteção de Preview da Vercel, quando ativa, é um acesso separado do login da aplicação.
7. Divulgue no Discord o link público da sala. E-mail e senha ficam com os organizadores. O fluxo funcional está em `/`, `/admin` e `/s/:id`; conceitos visuais não substituem uma sala real. O conceito X1 está oculto do público, inclusive pelos links antigos `/x1` e `/preview/brasa`.

### Ordem das migrações

Os arquivos ficam em `supabase/migrations/`. Execute cada um apenas quando ainda estiver pendente:

| Ordem | Arquivo | Função |
|---|---|---|
| 1 | `20261016_scrims.sql` | Estado, log de eventos, RLS e Realtime. |
| 2 | `20261017_match_imports.sql` | Importação transacional de resultados e limites de consulta. |
| 3 | `20261104_room_access.sql` | Publicação, ocultação e exclusão reversível das salas. |
| 4 | `20261105_super_admin.sql` | Contas administrativas, permissões e propriedade das salas. |
| 5 | `20261112_home_feature.sql` | Fixação do VCT em destaque pelo super admin. |
| 6 | `20261113_streams.sql` | Links e publicação de lives. |
| 7 | `20261114_multiplatform_streams.sql` | Twitch, YouTube, Kick e histórico dos links de gravações. |
| 8 | `20261116_media_permissions.sql` | Consulta de mídia para admins ativos e edição separada por `manageStreams`. |

A pausa por empate técnico usa o estado JSON e o log de eventos existentes. Ela não exige uma migração própria. A sequência acima é para instalação; não reaplique migrações ou dados apenas para cadastrar um organizador ou publicar uma live.

### Atualizar permissões de mídia em um projeto em uso

Se o projeto já usa as três plataformas e as gravações, somente
`20261116_media_permissions.sql` está pendente para esta atualização. A publicação
da aplicação e a execução desse SQL precisam ser coordenadas em uma janela curta.
O deploy não executa a migração. Mantenha o PR sem publicar até haver quem possa
executar o SQL e validar o acesso imediatamente depois do deploy.

1. Valide a aplicação nova e o SQL juntos localmente/PGlite ou em um Preview com
   banco isolado. Neste projeto, Preview e Production compartilham o Supabase;
   aplicar o SQL nesse banco enquanto produção ainda usa a aplicação antiga
   interrompe o login e o acesso de todos os admins, inclusive o Caio. A versão
   antiga rejeita a nova política com doze chaves.
2. Publique primeiro a **aplicação compatível com `manageStreams`** e confirme o
   login administrativo. Ela aceita a política anterior de onze chaves e trata
   a capacidade ausente como desligada. Até o SQL ser aplicado, o painel/API
   administrativo de mídia responde **503** indicando a migração pendente;
   operações de contas que enviam doze capacidades também ficam indisponíveis.
   Evite editar contas nesse intervalo. As consultas e os players públicos
   existentes continuam disponíveis.
3. Logo em seguida, execute uma vez `20261116_media_permissions.sql` no projeto
   correto. Não aplique esse arquivo antes de publicar a aplicação compatível.
   A migração conserva mídia e histórico e inicia `manageStreams` desligado para
   admins existentes que não são super admin.
4. Confirme que o RPC privado `get_stream_capabilities`, consultado pelo servidor,
   informa `mediaPermissions: true`. Verifique login do Caio e de um organizador,
   consulta de mídia própria sem edição e recusa de acesso privado de outro
   proprietário. Conceda e revogue **Gerenciar lives e gravações** pela interface
   usando uma conta de teste e confirme os bloqueios no servidor. Confira também
   a live pública e os replays existentes.

**Recuperação:** após o SQL de doze chaves, restaurar um deploy anterior à
compatibilidade com `manageStreams` também pode deixar o acesso administrativo
em **503**. Prefira uma versão/correção compatível com as doze chaves. Uma reversão
do esquema exige procedimento específico e coordenado com a aplicação; não
apague a chave manualmente nem reaplique migrações antigas, pois isso pode perder
concessões já feitas. Preserve as permissões atuais e o histórico durante a
recuperação. Só considere a atualização concluída depois da validação da aplicação
e do SQL no mesmo ambiente.

**Atenção:** Vercel não hospeda WebSockets persistentes, mas o navegador estabelece a conexão Realtime diretamente com Supabase. O servidor só executa uma função curta por comando. Todos os eventos (com `seq` e `at`) são gravados numa transação atômica com a versão do estado.

### Testes práticos

- Com um organizador de teste, crie uma MD3 oculta e confira que outro organizador e o público não a listam nem abrem seu link/relatório. Com a capacidade de publicação, mostre pelo olho e abra o link de espectador em duas janelas; verifique veto, sorteios e resultados importados sem recarregar.
- Sem sessão de administrador, `POST /api/scrims` e `POST /api/scrims/ID/command` devem responder HTTP 403, inclusive se o corpo contiver uma chave antiga de admin.
- Faça dois cliques simultâneos de admin: uma ação deve persistir, a outra pode receber conflito HTTP 409, sem perda ou duplicação de eventos.
- Recarregue ambas as janelas; verifique histórico, estatísticas e `/api/scrims/ID/report.md`. Teste **Sair do admin**, suspensão e redefinição de senha: as sessões antigas não devem permitir novas edições nem voltar por renovação. Reativar preserva as capacidades, mas exige novo login.
- Confira RLS: a chave pública só faz `SELECT` dos eventos de salas publicadas e não excluídas; eventos ocultos não retornam linhas. `scrims` permanece inacessível. Teste ocultar, excluir e restaurar nas próprias salas com as capacidades correspondentes, além de tentar editar a sala pública de outro organizador: deve abrir apenas como espectador.
- Com uma conta sem **Gerenciar lives e gravações**, confira o acesso de consulta a **Lives e gravações** e às configurações/gravações das próprias salas. **Editar a sala** sozinha não deve permitir alterações de mídia. Tentativas diretas de alteração pela API devem ser recusadas. Conceda `manageStreams` e confira o cadastro/publicação; revogue-a e confirme o bloqueio de novas alterações.
- Em uma sala de teste, publique dois links ao vivo, troque de perspectiva como espectador e cadastre um replay na própria sala. Confira que outra sala não mostra essa gravação e que ocultar a live não apaga o replay.
- Declare empate técnico com placar já importado. Confira a retirada dos destaques ativos, a presença no histórico e a retomada sem mudança nos jogadores, veto, mapas ou placar.
- Abra a home e os antigos links X1 como espectador. Eles não devem oferecer o conceito, sua configuração ou sugestões simuladas.

### Notas e limites

- O histórico antigo exige uma importação explícita antes de desativar o servidor anterior. Siga a seção abaixo; os arquivos originais e hashes internos das salas são preservados. As salas anteriores ficam com o Caio; ele pode transferi-las a outro organizador sem mudar o histórico.
- A API lê todo o histórico por páginas internas, respeitando a versão do snapshot e o limite de linhas do PostgREST. Logs muito grandes ainda precisam respeitar o limite de resposta/tempo da Vercel; nesses casos, uma API paginada para o navegador será necessária. As listagens respeitam visibilidade e propriedade; a gestão de contas e a aba Todas as salas têm paginação.
- O contador de espectadores é indicativo, baseado em Presence; ele não autoriza comandos. O servidor verifica a identidade no Supabase Auth e consulta conta ativa, capacidades e propriedade na política privada do banco. `app_metadata` só é importado uma vez na migração, sem fallback em execução.
- O protocolo Realtime funciona sem SDK externo e sem chave de API terceirizada para os mapas. As imagens continuam sendo obtidas do espelho público `media.valorant-api.com` por UUID.
- A sessão de admin usa cookies HttpOnly, Secure em HTTPS e SameSite=Lax, com renovação no servidor. Senhas e tokens não são entregues pela API ao JavaScript da aplicação. Links antigos com `#admin=…` não concedem edição.
- Os controles de permissão valem somente nas próprias salas. Consulta de mídia não concede edição. Só o Caio pode alterar contas, transferir salas ou publicar a live independente na home. Exclusão lógica conserva eventos/importações; restaurar sempre deixa a sala oculta. Os scripts de flags antigos são LEGACY e não alteram a política atual. Os perfis e ajustes estão em [SUPER-ADMIN.md](docs/SUPER-ADMIN.md).
- **Ambiente compartilhado:** Preview e Production usam o mesmo Supabase. APIs antigas podem ignorar visibilidade, capacidades e propriedade e usam `service_role`, que não é limitado pelo RLS. Use dados fictícios no Preview e só confie no isolamento após atualizar os domínios ativos e aposentar ou bloquear Previews/deployments antigos com acesso de serviço ao banco.
- MD1 utiliza a convenção definida no projeto, não uma sequência oficial Tier 1 da VCT.
- Não desative o Row Level Security nem habilite acesso de escrita anônima.

## Desenvolvimento

- `npm run build` cria o front-end estático em `dist/` e valida os tipos.
- `npm run dev` (CLI Vercel fixada em 64.4.0) executa as Functions localmente com as variáveis de ambiente. Para trabalhar só na interface, `npx vite` fornece HMR, mas **não** monta a API serverless sozinho.
- O servidor Node antigo em `src/server` e o `Dockerfile` foram mantidos por compatibilidade como alternativa legacy. **Não** use essa rota para a hospedagem na Vercel.


## Importar o histórico do servidor anterior

1. Pare as escritas no servidor anterior e faça backup dos pares `<id>.meta.json` / `<id>.events.jsonl`. Não publique esses arquivos: o metadata contém hashes de admin. O backup pode vir de `data/` ou `dist-server/data/`, conforme a execução antiga.
2. Em um terminal seguro no Codex Cloud, com dependências instaladas, execute `npm run import:legacy -- /caminho/absoluto/do/backup`. Este dry-run valida todos os arquivos, sequências e a reconstrução com as regras antigas (inclusive rosters de 12 ou veto sem roster). Não envia dados nem altera os arquivos.
3. Configure `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` apenas no ambiente seguro do terminal. Aplique o SQL completo, que inclui a RPC privada `import_scrim`.
4. Execute `npm run import:legacy -- /caminho/absoluto/do/backup --apply`. Cada sala é importada numa transação, com ID, eventos completos e hash originais. IDs existentes causam erro, nunca sobrescrita. A operação não é uma transação global: se houver erro, as salas anteriores já importadas permanecem; confira-as antes de tentar novamente.
5. Compare os eventos retornados por `/api/scrims/:id` com os arquivos originais e teste a consulta das salas e a edição com uma conta de admin no novo domínio antes de desativar o servidor anterior. Preserve os backups. Scrims legadas continuam consultáveis, mas novos comandos usam o limite de dez jogadores e equipes de cinco.

O endpoint `/api/health` consulta o banco; variáveis presentes sem SQL/permissões válidos não bastam para retornar sucesso. Ele não verifica a conexão Realtime do navegador.

## Evidências e limites da validação local

`npm test` cobre domínio, login/sessões, política de contas e HTTP serverless com Supabase Auth/REST simulados, reconexão/sincronização de clientes React com WebSocket simulado e SQL real no Postgres embutido PGlite (grants, RLS, RPCs, CAS, rollback e importação). Os testes locais não certificam uma conta Auth real nem a publicação Realtime de um projeto Supabase hospedado. Valide login, permissões e duas abas contra o Preview antes de mesclar. Não exponha valores das variáveis em logs ou no PR.

`public/preview.html` é uma demonstração antiga e independente, sem transmissão de eventos reais. A aplicação atual usa a identidade Brasa e salas persistidas no Supabase. O código do conceito X1 permanece no repositório para trabalho futuro, sem divulgação ou acesso pelo site público.

## Importação automática de customizadas

A aba Partida permite importar resultados da HenrikDev e associar jogadores por drag and drop ou seleção. A funcionalidade usa a migração `20261017_match_imports.sql` e o segredo de servidor `HENRIK_API_KEY` na Vercel; quem importa precisa possuir a sala e ter `importMatches`, ou ser o super admin. Consulte [MATCH-IMPORT.md](docs/MATCH-IMPORT.md) antes de ativar o deploy. Placar e rounds vêm da API: marcação manual e desfazer rounds foram removidos e são recusados pelo servidor. K/D/A pode ser ajustado apenas em **Corrigir estatística**, depois de uma importação e com a capacidade de correção; a correção fica no histórico. Sem resultado, o espectador vê **Aguardando importação da partida para você**.

## Foco do admin e sorteios compartilhados

A barra da sala permite chamar os espectadores para a aba/mapa/seção atual e abrir sorteios de capitães da lista geral ou cara ou coroa com motivo. Todos recebem a mesma apresentação; o admin aceita ou descarta o resultado. Aceitar capitães inicia os dois times com eles, e o sorteio posterior dos times mantém os capitães. Tentativas e decisões ficam no histórico e no relatório.

Foco e sorteios usam o log de eventos existente. O controle atual de acesso às salas exige também `20261105_super_admin.sql`, após `20261104_room_access.sql`, sem nova variável de ambiente. Foco e sorteios respeitam propriedade e capacidades. Consulte [ROOM-TOOLS.md](docs/ROOM-TOOLS.md) para regras, testes e roteiro de avaliação no Preview.


## Identidade Brasa e destaque VCT

A home apresenta as salas públicas reais e prioriza o VCT. O modo automático
funciona com as migrações existentes. Para permitir que o Caio fixe uma sala,
aplique uma vez `supabase/migrations/20261112_home_feature.sql`, após a atualização
de super admin. Nenhuma variável nova é necessária; salas e eventos são preservados.
O controle fica em Administração → Todas as salas → VCT em destaque na home.
Consulte [BRASA-VCT.md](docs/BRASA-VCT.md) para funcionamento e validação.

## Lives, gravações e empate técnico

Em cada sala, **Acompanhe este evento** reúne **Ao vivo** e **Gravações**. Os links de Twitch, YouTube e Kick são cadastrados diretamente ali. Os espectadores escolhem a perspectiva pelas setas e podem ampliar o mini player. O replay é cadastrado com o link do vídeo específico e continua vinculado ao evento mesmo depois de ocultar a live.

**Lives e gravações**, em `/admin/lives`, permite que administradores consultem a mídia das próprias salas. Alterações exigem **Gerenciar lives e gravações** (`manageStreams`) e a publicação de um replay também exige a capacidade de publicação da sala. Apenas o super admin configura **Divulgar uma live sem evento** na página inicial. A exibição é manual: o site não detecta início/fim da live nem descobre VODs automaticamente. Veja [STREAMS.md](docs/STREAMS.md).

**Declarar empate técnico → Pausar scrim** preserva os dados, retira a sala dos destaques ativos e mantém o acesso pelo histórico. **Retomar scrim** restaura a fase anterior. Durante a pausa, o jogo e as importações ficam bloqueados; foco, anotações, lives e gravações continuam disponíveis conforme as permissões. Veja [EVENT-PAUSE-MEDIA.md](docs/EVENT-PAUSE-MEDIA.md).
