# Navegação e associação de jogadores

A interface React recebeu uma atualização visual com tema escuro, cores distintas por time, ícones locais em SVG e componentes responsivos. A página `/preview.html` demonstrativa permanece separada da aplicação.

- Início: busca por sala/time/mapa, filtros de andamento e histórico, resumo de salas e criação lateral no desktop. No celular, o histórico vem antes do formulário e há um atalho **Nova scrim**.
- Sala: navegação lateral no desktop, barra inferior no celular e navegação por setas/Home/End no teclado. O link de espectadores fica em destaque; acesso de admin e saída ficam em **Opções da sala (•••)**.
- Importação em três etapas: **Partida → Jogadores → Revisão**. O placar e o preenchimento manual ficam recolhidos durante a associação, para reduzir distrações.
- Associação: um time por vez, progresso por time e total; arrastar nos dois sentidos; seleção direta em cada apelido; remover/mover um vínculo sem duplicá-lo. No celular, as listas diretas ficam em destaque e os cartões de arrastar podem ser expandidos.
- A última etapa mostra as dez associações e exige confirmação explícita antes da chamada de importação. Campos e vínculos são mantidos ao voltar entre etapas.
- Ao rever uma série encerrada, a aba Partida abre no último mapa jogado, sem selecionar um decider que não aconteceu.
- Tabelas largas têm rolagem dentro do card, mantendo a navegação da página disponível. Ações de veto e desfazer são desabilitadas quando o domínio já as impediria.

Não há novas dependências, variáveis, migrações de banco ou alterações de regras/API. As credenciais e configurações existentes da Vercel continuam sendo usadas.

## Verificação

O build e os testes existentes foram executados, com atualização dos testes funcionais da associação para a navegação em etapas e cobertura da seleção direta/drag nos dois sentidos. O Chromium foi usado com APIs simuladas para conferir busca, filtros, criação, navegação por teclado, associação, revisão obrigatória, importação, relatório, times e veto nas larguras de 390 e 1440 pixels. Nenhum teste gravou dados em produção.

Para revisar no Preview, abra a página inicial, uma scrim existente como espectador e uma sala de teste como admin. A importação continua exigindo veto concluído e um mapa sem placar ou estatísticas. No fluxo visual, teste um apelido diferente do Riot ID, troca de time Red/Blue e o retorno da revisão para corrigir uma associação antes de importar.
