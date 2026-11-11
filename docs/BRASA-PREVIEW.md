# Primeira entrega Brasa

Implementa a etapa de protótipo do [plano aprovado](plans/2026-11-11-brasa-x1.md).
Abra **`/preview/brasa`** no deployment desta branch ou em desenvolvimento.

## O que testar

1. **Ao vivo:** início com a marca Brasa, campeonato em destaque e próximos duelos.
2. **Campeonato X1:** selecionar um confronto, confirmar um vencedor por botão ou
   arrastá-lo para o próximo confronto da chave. A decisão exige confirmação.
3. **Configurar exemplo:** trocar participantes, experimentar uma chave maior e
   definir MD1/MD3/MD5 por fase. Fases com resultado ficam protegidas. Refazer a
   lista exige confirmar que os resultados do exemplo serão zerados.
4. **Corrigir um vencedor:** caso haja resultado posterior dependente, revisar os
   confrontos que serão reabertos e confirmar essa consequência explicitamente.
5. **Sugestões:** alternar para Participante em **Testar como**, enviar apelido e
   título. Alternar para Organizador e aceitar, ajustar ou recusar. Os nomes só
   mudam na chave depois de aprovar.
6. **Celular:** o duelo selecionado vem antes da chave. Tocar num confronto abre
   seus detalhes; a visualização por fase evita depender de arraste ou zoom.

Atalhos compartilháveis:

- `/preview/brasa` — início.
- `/preview/brasa?tela=x1` — campeonato.
- `/preview/brasa?tela=sugestoes` — sugestões.

## Limites desta entrega

É uma **prévia interativa com dados de exemplo**, identificada no topo em todas as
telas. Resultados, ajustes e sugestões ficam apenas na memória da aba. Recarregar
ou usar **Reiniciar exemplo** restaura os dados iniciais. Abas diferentes não
recebem essas alterações; o botão de foco apenas demonstra a interação.

O seletor de perfil simula os dois lados para revisar a experiência. Não é login
nem mecanismo de autorização. Esta rota não monta o provider de autenticação,
consulta a API, envia comandos para salas, usa armazenamento persistente ou
acessa o Supabase. Sugestões da demonstração não são convites reais.

As salas atuais, suas permissões, importação e histórico seguem nas rotas
existentes. O domínio e o banco não foram alterados. O `public/preview.html`
anterior continua sendo outra demonstração, independente desta rota React.

## Estrutura e identidade

O módulo novo fica isolado em `src/client/features/brasa-preview`, carregado sob
demanda. CSS e fontes não alteram a identidade da interface existente. A marca
compacta é uma proposta vetorial baseada na chama, escudo e paleta do logo enviado;
não é a reprodução do arquivo original com os talheres. Fontes Barlow Condensed e
Source Sans 3 são locais, com as licenças OFL em `public/brand/fonts`.

O modelo puro testa chaves de 2 a 32 jogadores, byes, formatos, revisão de
resultados dependentes, conflitos de versão e nomes aprovados. Ainda não é um
contrato de produção; a integração futura revalidará regras e permissões no
servidor e no Postgres.

## Validação realizada

- `npm ci --cache /tmp/valorantscrim-npm-cache`: instalação concluída. O cache
  padrão do ambiente não tinha diretório gravável, portanto foi usado `/tmp`.
- `npm run typecheck` e `npm run build`.
- `npm test`: 346 testes em 26 arquivos, incluindo 25 testes do modelo da prévia.
- Chromium: 13 cenários no build de produção, incluindo início, chave, confirmação, arraste real, correção dependente,
  sugestões dos dois tipos, aprovação/recusa/ajuste, redefinição local, foco de
  teclado e preservação da interface atual.
- Larguras 320, 390, 768 e 1440 px, com visualizações de organizador e participante.
- Nenhuma requisição da prévia à API ou a serviço externo durante o roteiro.

Capturas para revisão:

- [Início desktop](images/brasa-home-desktop.png)
- [X1 desktop](images/brasa-x1-desktop.png)
- [Revisão de sugestões](images/brasa-suggestions-desktop.png)
- [Início mobile](images/brasa-home-mobile.png)
- [X1 mobile](images/brasa-x1-mobile.png)
- [Sugestão pelo participante](images/brasa-suggestion-mobile.png)

## Sequência aprovada

Após revisar as telas: organizar os módulos ativos e legados em uma entrega
própria, implementar o domínio X1 no servidor/Postgres, conectar sincronização e
permissões e substituir as sugestões locais por convites e moderação reais para
VCT e X1. Essas etapas seguem pendentes. A configuração do domínio foi adiada pelo
Caio e não é necessária para construir o produto.
