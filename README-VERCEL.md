# Deploy na Vercel + Supabase — Scrims VALORANT

A interface React, o domínio de jogo e os relatórios permanecem os do repositório original. Apenas o transporte e a persistência são migrados: Vercel Functions (API de comando), Supabase Postgres (estado atual e event log) e Supabase Realtime (Postgres Changes + Presence).

## Configurar sem instalar nada no PC

1. Crie um projeto em https://supabase.com/dashboard (região próxima dos jogadores).
2. No **SQL Editor**, execute `supabase/migrations/20261016_scrims.sql` deste pacote.
3. Na Vercel, importe `CaioOliveiraOFC/VALORANTSCRIM` e aplique esta migração à branch vinculada. Framework Preset: **Vite**. Build Command: `npm run build`. Output Directory: `dist`.
4. Configure, em **Project Settings > Environment Variables**, as quatro variáveis de `.env.example` nos ambientes Production e Preview. `SUPABASE_SERVICE_ROLE_KEY` é segredo; **nunca** prefixe com `VITE_` e **nunca** cole em um arquivo público do GitHub.
5. Faça o redeploy. A prévia visual (sem banco) estará em `https://SEU-DOMINIO/preview.html`. Teste `https://SEU-DOMINIO/api/health` (deve retornar `ok:true`).
6. Abra o site, crie a scrim e **salve o link de admin**. Divulgue no Discord apenas o **link de espectador**, sem `#admin=`.

**Atenção:** Vercel não hospeda WebSockets persistentes, mas o navegador estabelece a conexão Realtime diretamente com Supabase. O servidor só executa uma função curta por comando. Todos os eventos (com `seq` e `at`) são gravados numa transação atômica com a versão do estado.

### Testes práticos

- Crie uma MD3 e abra o link de espectador em duas janelas; verifique se o outro navegador acompanha cada ban/pick e round sem recarregar.
- Tente enviar `POST /api/scrims/ID/command` sem chave: deve responder HTTP 403.
- Faça dois cliques simultâneos de admin: uma ação deve persistir, a outra pode receber conflito HTTP 409, sem perda ou duplicação de eventos.
- Recarregue ambas as janelas; verifique histórico, estatísticas e `/api/scrims/ID/report.md`.
- Confira RLS: com a chave pública, `scrim_events` deve permitir somente `SELECT`, e `scrims` deve ser inacessível.

### Notas e limites

- O histórico antigo exige uma importação explícita antes de desativar o servidor anterior. Siga a seção abaixo; os arquivos originais e hashes de admin são preservados.
- A API lê todo o histórico por páginas internas, respeitando a versão do snapshot e o limite de linhas do PostgREST. Logs muito grandes ainda precisam respeitar o limite de resposta/tempo da Vercel; nesses casos, uma API paginada para o navegador será necessária. A listagem inicial mostra até 500 scrims.
- O contador de espectadores é indicativo, baseado em Presence. Os espectadores não recebem a chave de admin.
- O protocolo Realtime funciona sem SDK externo e sem chave de API terceirizada para os mapas. As imagens continuam sendo obtidas do espelho público `media.valorant-api.com` por UUID.
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
5. Compare os eventos retornados por `/api/scrims/:id` com os arquivos originais e teste os links antigos de admin no novo domínio antes de desativar o servidor anterior. Preserve os backups. Scrims legadas continuam consultáveis, mas novos comandos usam o limite de dez jogadores e equipes de cinco.

O endpoint `/api/health` consulta o banco; variáveis presentes sem SQL/permissões válidos não bastam para retornar sucesso. Ele não verifica a conexão Realtime do navegador.

## Evidências e limites da validação local

`npm test` cobre domínio, HTTP serverless com REST Supabase simulado, reconexão/sincronização de dois clientes React com WebSocket simulado e SQL real no Postgres embutido PGlite (grants, RLS, RPCs, CAS, rollback e importação). Os testes locais não certificam a publicação Realtime de um projeto Supabase hospedado nem substituem a validação em duas abas contra o Preview. Não exponha valores das variáveis em logs ou no PR.

`public/preview.html` é uma demonstração independente, sem transmissão de eventos reais. A aplicação React existente é mantida; nenhuma proposta de redesenho foi aplicada a ela.
