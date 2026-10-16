# Tarefa para Codex Cloud (GitHub conectado, sem PC local)

Repositório: `CaioOliveiraOFC/VALORANTSCRIM` (branch base `main`).

**Objetivo:** migrar a aplicação existente para Vercel + Supabase mantendo a lógica de domínio, sem perder o histórico de eventos, e gerar Pull Request com deploy Preview no navegador.

## Arquivos fornecidos

Este pacote ZIP possui:
- `api/index.ts`: função serverless de criação, leitura, sessão de admin, comandos e Markdown.
- `src/client/hooks/useScrim.ts`: cliente Supabase Realtime com reconexão e busca de histórico.
- `supabase/migrations/20261016_scrims.sql`: Postgres, RLS de somente leitura pública dos eventos, funções RPC transacionais e publicação Realtime.
- `vercel.json`, `.env.example`, `README-VERCEL.md`, `public/preview.html`.
- `apply-migration.mjs`: faz alterações localizadas em outros arquivos existentes e atualiza os testes para exigir 10 jogadores e duas equipes de 5.

## Instruções

1. No Codex Cloud, selecione o repositório e crie uma tarefa em **branch nova** (não sobrescrever `main`).
2. Descompacte o ZIP **na raiz do checkout** preservando os caminhos relativos; execute `node apply-migration.mjs`. Se o ZIP ainda não estiver disponível no ambiente, solicite o upload do pacote e não invente os conteúdos.
3. Revise as alterações e execute `npm ci`, `npm run typecheck`, `npm run build` e `npm test`. Corrija eventuais incompatibilidades de TS, rotas e falhas nos testes. Não declare testes aprovados sem executá-los.
4. Faça auditoria de segurança: a `SUPABASE_SERVICE_ROLE_KEY` deve existir **somente no servidor** e nunca ser publicada; usuários comuns só podem fazer SELECT em `scrim_events`, nunca em `scrims`; comandos devem checar chave de admin no servidor. Confirme SQL, concorrência e RLS.
5. Valide as URLs `/api/health`, `/api/scrims`, `/api/scrims/:id`, `/api/scrims/:id/session`, `/api/scrims/:id/command`, `/api/scrims/:id/report.md`. Valide Realtime em duas abas, reconexão e histórico permanente.
6. Crie um Pull Request com checklist, evidências de testes e eventuais pendências de ambiente. **Não mescle sem validação.** Se a Vercel estiver conectada ao repositório, forneça o URL do Preview (a rota `/preview.html` é uma demonstração visual independente de Supabase).
7. Se faltarem projeto Supabase, SQL aplicado ou variáveis de ambiente, registre explicitamente esse bloqueio. Não exponha credenciais no PR.

**Importante:** a página `/preview.html` é uma proposta de layout demonstrativa, não é a mesma UI React atual. Ela não transmite eventos reais. A migração serverless mantém a interface React já existente no repositório; qualquer redesenho deve ser discutido e implementado separadamente.
