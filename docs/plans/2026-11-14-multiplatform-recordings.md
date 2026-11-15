# Três plataformas e acervo de replays

Entrega solicitada pelo Caio: aceitar links da Twitch, YouTube e Kick e preservar
um histórico de gravações. A resposta à dúvida de escopo foi **histórico com
links dos replays**, sem armazenamento de arquivos de vídeo.

## Comportamento

- Colar um link identifica a plataforma. A identidade do carrossel usa provedor
  e identificador, para não confundir nomes iguais na Twitch e na Kick.
- A configuração Twitch existente permanece no formato legado. O banco recebe
  validação adicional para os outros provedores por migração aditiva.
- O administrador registra o vídeo específico no fim da live. O replay tem ID
  e cadastro próprios; trocar a live ou ocultar o player não o apaga.
- O acervo é público em `/gravacoes`; replays ocultos e salas privadas não são
  expostos. A administração pode ocultar/publicar cada replay sem excluir dados.
- O player de gravação não mostra o chat atual do canal. Lives Kick usam o
  player oficial e link de chat; gravações Kick abrem na plataforma.
- Não são criados arquivos de vídeo, nem prometida preservação de VODs apagados
  pelos provedores. Não há descoberta automática de gravações das plataformas.

## Validação

Testes de domínio, API e Postgres cobrem normalização, URLs maliciosas,
duplicados, papéis, sessões, titularidade, paginação e privacidade. Testes de
interface cobrem o cadastro e a remoção do player após ocultação de um replay.
O fluxo completo de navegador usa API/SQL reais em fixture local, com embeds
externos substituídos apenas para testar a navegação de forma determinística.
Nenhuma escrita é feita na produção durante a validação.

Em smoke separado, os documentos dos players oficiais de Twitch, YouTube e Kick
responderam 200 e carregaram. O YouTube exibiu o vídeo de exemplo; o Kick exibiu
o canal e seus controles. O canal Twitch usado nesse teste estava offline;
reprodução de uma live Twitch ativa depende do teste de uso informado pelo Caio.
O proxy deste ambiente exige aceitar seu certificado no navegador de teste;
nenhum bypass de TLS é incluído no aplicativo.

Migração necessária: `supabase/migrations/20261114_multiplatform_streams.sql`,
depois de `20261113_streams.sql`. Sem novas credenciais para os embeds/acervo.
