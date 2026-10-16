# Validação da migração Vercel + Supabase

Branch: `feat/vercel-supabase-migration`, baseada em `002ecff` (main ao iniciar).
O pacote ZIP fornecido foi extraído na raiz e `node apply-migration.mjs` executado.
A interface React foi mantida. `public/preview.html` é apenas uma demonstração visual independente.

## Evidências locais (16/10/2026)

- [x] `npm ci --cache /workspace/.npm` com o lockfile atualizado.
- [x] `npm run typecheck`.
- [x] `npm run build` (TypeScript, Vite e servidor legado).
- [x] `npm test`: 28 testes, 4 arquivos, nenhum ignorado.
- [x] Domínio: sequências MD1/MD3/MD5, placar, dez jogadores, equipes de cinco e compatibilidade com logs antigos.
- [x] HTTP real em servidor local com adaptador serverless; REST Supabase simulado: health, create/list/detail/session/command/report, autorização, conflito 409, corpo pré-processado pela Vercel e leitura paginada sem truncamento.
- [x] Dois clientes React com WebSocket simulado: eventos, deduplicação, reconexão, recuperação de lacunas e polling.
- [x] SQL executado em Postgres embutido PGlite: anon/authenticated sem acesso a scrims e sem escrita/RPC; SELECT público dos eventos; CAS com uma única escrita para a mesma versão; rollback se append falhar; importação sem sobrescrita.
- [x] Importador executado em dry-run com fixture de 12 jogadores e veto legado; SHA-256 dos arquivos originais permaneceu igual.
- [x] Variável `SUPABASE_SERVICE_ROLE_KEY` ausente dos arquivos públicos em `dist/`; credencial só é lida na API e no importador de servidor. Nenhum valor de credencial foi adicionado.

## Auditoria

A API valida a chave de admin no servidor por SHA-256 e comparação constante antes de aplicar comandos. As RPCs são exclusivas de service_role, usam search_path vazio e transações. RLS está habilitada nas duas tabelas; grants públicos se limitam a SELECT em scrim_events. O hash nunca sai pela API pública. Presence é indicativa e não autoriza comandos.

Os conflitos não sobrescrevem estado: a RPC compara versão e hash, atualiza estado e grava o evento na mesma transação. A API lê eventos por sequência até a versão do snapshot, respeitando limites de página do PostgREST. Históricos muito grandes continuam sujeitos aos limites de resposta e tempo da Vercel.

## Pendências externas — não mesclar antes de validar

- [ ] Projeto Supabase e SQL aplicados no serviço hospedado; não disponíveis para confirmação nesta tarefa.
- [ ] Quatro variáveis de `.env.example` configuradas com valores reais; estavam ausentes do processo e da configuração do ambiente.
- [ ] Backup e importação dos logs reais do servidor anterior, caso existam. Nenhum log histórico foi encontrado no checkout. O importador não altera a origem, mas escreve por sala, sem transação global; ver README-VERCEL.md.
- [ ] Projeto Vercel conectado e Preview publicado; sem vínculo/credenciais Vercel disponíveis para confirmação.
- [ ] Rotas e rewrites na plataforma Vercel; testes do handler local não validam o roteador hospedado.
- [ ] Duas abas reais contra Supabase Realtime, reconexão após queda e histórico persistente após nova sessão/deploy.
- [ ] URL real do Preview e teste de `/preview.html` nele.
- [ ] GitHub API liberada para criar o PR e consultar checks/deployments. O proxy respondeu 403 no CONNECT a api.github.com e api.vercel.com, antes de autenticar. O Git HTTPS de leitura funciona.

Foram salvos no rascunho do ambiente os requisitos de variáveis (sem valores), instruções atualizadas e domínios das APIs GitHub/Vercel e dos serviços Supabase/Preview. Isso não aplica o SQL, não altera automaticamente a rede em execução e não publica um ambiente/deploy.
