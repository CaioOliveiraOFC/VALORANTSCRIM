# Prévia X1 da Brasa

A organização atual do site e a home VCT estão em [BRASA-VCT.md](BRASA-VCT.md).

O X1 continua em uma demonstração com dados locais de exemplo:

- `/x1`: apresentação da modalidade secundária.
- `/preview/brasa?tela=x1`: chave interativa.
- `/preview/brasa?tela=sugestoes`: apelidos e títulos com aprovação simulada.

O endereço antigo `/preview/brasa` agora abre a home, cujo foco é VCT.

Na chave é possível configurar participantes e MD por fase, avançar vencedores
por botão ou arraste e revisar resultados dependentes antes de corrigi-los.
O seletor **Testar como** demonstra organizador e participante. Não autentica
nem concede acesso administrativo real. Resultados ficam na memória da aba e
reiniciam ao recarregar ou usar **Reiniciar exemplo**.

Sugestões exigem aprovação dentro do exemplo. Mudar o nome exibido preserva o ID
do participante. Nenhum perfil simulado, sugestão ou resultado é enviado à API.
Os links de navegação saem do exemplo e abrem o site normal, com seus próprios
controles de acesso.

O módulo `brasa-preview` é carregado sob demanda. Marca e ícones compartilhados
ficam em `src/client/ui`. A marca compacta vetorial é uma proposta baseada na
chama, escudo e paleta do logo fornecido; não reproduz o original com os talheres.
As fontes locais incluem suas licenças OFL.

O modelo puro tem 25 testes de chaves, byes, formatos, correções e nomes aprovados.
A versão anterior passou por 13 cenários Chromium; a revisão atual faz parte do
roteiro integrado descrito em [BRASA-VCT.md](BRASA-VCT.md).

X1 ao vivo e sugestões reais por convite continuam nas próximas entregas.
