# Twitch, YouTube, Kick e gravações na Brasa

## Instalação e atualização

Aplicar **uma vez** [20261113_streams.sql](../supabase/migrations/20261113_streams.sql)
no SQL Editor do projeto Supabase já usado pelo site. Requer a migração de super
admin de 20261105, que o painel atual já utiliza. Não altera eventos, partidas,
contas ou dados existentes. Não exige nova variável de ambiente nem chave Twitch.

Para as três plataformas e o acervo, aplicar depois
[20261114_multiplatform_streams.sql](../supabase/migrations/20261114_multiplatform_streams.sql).
Ela amplia a validação e adiciona uma tabela de gravações. Os canais Twitch já
salvos continuam no mesmo formato e não são reescritos.

Para separar consulta de edição, aplique depois
[20261116_media_permissions.sql](../supabase/migrations/20261116_media_permissions.sql).
Em um projeto com as migrações anteriores instaladas, este é o único SQL novo
necessário para a atualização de permissões. Coordene uma janela curta:
**publique primeiro a aplicação compatível e execute o SQL logo depois**. O
deploy não executa o arquivo. A aplicação antiga rejeita a política com doze
chaves; SQL primeiro interrompe login e acesso administrativo, inclusive do Caio.
A aplicação nova aceita a política anterior com edição de mídia desligada;
enquanto o SQL está pendente, a mídia administrativa retorna 503 e operações
de contas com doze capacidades ficam indisponíveis. Consultas e players públicos
existentes continuam disponíveis. Siga a [ordem de atualização e recuperação](../README-VERCEL.md#atualizar-permissões-de-mídia-em-um-projeto-em-uso)
e confirme os dois passos no ambiente de destino. Não é necessário rodar SQL
para conceder a capacidade a cada pessoa: depois da instalação, use
**Administração → Administradores**.

## Quem pode consultar e editar

Toda conta administrativa ativa abre **Lives e gravações** e consulta links,
configurações de exibição e replays das próprias salas, mesmo sem edição de
mídia. O Caio consulta todas as salas. Essa leitura inclui o conteúdo privado
autorizado do próprio evento e não concede acesso às salas ocultas de outro
organizador.

**Gerenciar lives e gravações** (`manageStreams`) libera adicionar/alterar links,
exibir ou ocultar a live e cadastrar replays. Essa capacidade é separada de
**Editar a sala**. As contas existentes que não são super admin começam com ela
desligada; o Caio pode liberá-la por conta. O perfil padrão **Organizador** também
começa sem edição de mídia. Escolher explicitamente **Completo** inclui essa
capacidade, que pode ser desmarcada nos ajustes individuais.

Publicar um replay ou destacar uma live de evento na home também exige
**Publicar ou ocultar salas**, além de uma sala publicada. A live independente
da home continua exclusiva do super admin, mesmo quando um organizador recebe
`manageStreams`. Revogar edição mantém a consulta e os links/replays salvos.

## Configuração em poucos passos

1. Entre como administrador e abra a sua sala. No bloco **Acompanhe este evento**,
   escolha **Ao vivo** e **Adicionar link ao vivo**.
2. Cole um ou mais links da Twitch, YouTube ou Kick. A plataforma é identificada
   automaticamente; no YouTube use o link da live/vídeo, não o do canal. Dê nomes
   curtos às perspectivas se quiser. Use **Adicionar outra perspectiva** para
   montar o carrossel.
3. Para um evento público, você também pode marcar
   **Destacar este evento na página inicial**: o destaque leva a galera até a sala,
   onde ficam o vídeo, o chat, os times e os mapas.
4. Clique em **Salvar e exibir neste evento**. O player compacto aparece na própria
   sala; **Ampliar player** aumenta a visualização. Inicie a live normalmente na
   plataforma escolhida.

Cada espectador usa as setas para escolher seu canal. A escolha é individual;
mudar uma perspectiva troca vídeo e chat juntos e remove o player anterior,
evitando áudio de dois canais. Reordenar a lista não troca o canal que a pessoa
já selecionou, se ele ainda estiver disponível.

O status **Exibindo live neste evento** identifica a publicação do player.
**Ocultar live** e **Exibir live** salvam imediatamente. Ocultar mantém os links
armazenados e não encerra a live na plataforma. Os espectadores recebem mudanças
em até 10 segundos, sem recarregar a página. **Editar links da live** altera as
perspectivas e a divulgação na home. A visibilidade rápida usa os dados salvos,
sem publicar campos que você ainda está editando. Um conflito entre abas exige
revisar a configuração atual antes de salvar novamente.

A área **Lives e gravações** é um diretório com atalhos para os eventos. Quem
tem apenas consulta vê o conteúdo salvo sem os formulários de alteração. Não é
necessário criar uma transmissão em outro painel para depois vinculá-la à sala.
A divulgação independente na página inicial permanece em um bloco separado,
exclusivo do super admin.

## Live na página inicial, sem scrim

Este fluxo é exclusivo do super admin:

1. Abra **Lives e gravações** e o bloco **Divulgar uma live sem evento**.
2. Use **Adicionar link na página inicial**, informe o título e cole um ou mais
   links de Twitch, YouTube ou Kick. **Adicionar outra perspectiva** monta o
   carrossel independente da home.
3. Clique em **Salvar e exibir na página inicial**. Não é necessário criar ou
   selecionar uma scrim.
4. Para retirar o player depois, use **Ocultar da página inicial**. Os links
   continuam salvos e podem ser exibidos novamente.

O estado **Exibindo na página inicial** significa que o player está publicado
no site. Ligar a live na Twitch/YouTube/Kick não publica o player automaticamente;
encerrar a transmissão também não o oculta. O site não detecta canal online ou
offline. Ocultar o player não encerra a transmissão na plataforma.

## Regras e limites

- Até seis perspectivas por transmissão, sem duplicados. Twitch aceita o nome
  do canal ou seu link; Kick aceita o link do canal; YouTube aceita `/watch?v=`,
  `/live/` e `youtu.be`. URLs arbitrárias e HTML de iframes são recusados.
- Twitch usa player e chat incorporados. YouTube usa player e chat da live
  quando disponível. Kick usa `player.kick.com` para lives e um link para abrir
  o chat na plataforma. Restrições do canal/plataforma podem bloquear embeds;
  o link original continua acessível.
- Organizador com **Gerenciar lives e gravações** configura as próprias salas. Super admin
  configura todas e a transmissão independente da home. Destacar um evento na
  home também exige **Publicar ou ocultar salas** e uma sala pública.
- Salas ocultas não aparecem na home e só disponibilizam sua transmissão para
  o dono/super admin autenticado. Exclusão retira a transmissão do acesso público
  e mantém a configuração para uma eventual restauração. Transferir uma sala
  transfere o controle da transmissão junto dela.
- O chat usa o login e a moderação da Twitch. Para só assistir não é necessário
  login na Brasa. Bloqueadores de conteúdo/cookies e restrições do navegador
  podem interferir no embed ou no login do chat; há um link para abrir na Twitch.
- A reprodução começa pelo play, sem áudio automático. Não há detecção de canal
  ao vivo/offline, número de espectadores, restream ou retransmissão pelo servidor
  da Brasa. A publicação do player não inicia a live no OBS.
- Na Twitch, `parent` é o hostname atual; o chat do YouTube usa `embed_domain`:
  produção,
  preview e futuros domínios não precisam ser fixados no código. A hospedagem
  usa HTTPS. Em telas pequenas o viewport mínimo de 400×300 da Twitch é ajustado
  visualmente ao espaço disponível; o chat fica abaixo e pode ser ocultado.
- O conceito X1 está oculto do público. Lives podem ser vinculadas às scrims
  VCT existentes ou divulgadas na home independente pelo super admin.

## Segurança e recuperação

`scrim_broadcasts` tem RLS e nenhum acesso direto para anon, authenticated ou
service_role. A API usa a service role somente no servidor e RPCs delimitadas.
As funções validam conta ativa, versão da sessão e propriedade em consultas
administrativas. Escritas também exigem `manageStreams` e, quando necessário,
`publishRooms`, mesmo para chamadas com service role. Escritas usam bloqueios de conta/sala,
versão otimista e auditoria privada; conflito de duas abas não sobrescreve dados.

Sem as migrações iniciais de streams, as páginas públicas continuam funcionando
sem transmissões.
O painel exibe o nome exato do SQL pendente. Se houver falha de acesso durante
atualização da configuração, o player é removido até a reconexão confirmar o
acesso novamente. Não há necessidade de reaplicar migrações anteriores.

APIs: `GET /api/streams`, `GET/PUT /api/admin/streams` e
`GET /api/scrims/:id/streams`. Todas usam `Cache-Control: no-store`.

## Histórico com links dos replays

O escopo escolhido pelo Caio é **guardar links, sem armazenar os arquivos de
vídeo**. O acervo público fica em `/gravacoes`, com links permanentes da Brasa
em `/gravacoes?replay=UUID` e páginas adicionais em “Ver mais gravações”.

1. Na própria sala, abra **Gravações** e use **Adicionar replay**. Essa aba abre
   por padrão em eventos encerrados ou em empate técnico, caso o espectador
   ainda não tenha escolhido outra aba.
2. Informe título, perspectiva e o link do vídeo salvo. No YouTube, o ID da
   live pode continuar sendo o do replay; confira o vídeo antes de salvar.
3. O evento já vem definido. Escolha se o replay deve aparecer publicamente.
   Salas ocultas mantêm o cadastro privado. Cadastros independentes de evento
   continuam disponíveis ao super admin no acervo geral.
4. Clique em **Salvar replay**. Trocar canais ou ocultar a live não remove esse
   registro. **Ocultar replay** retira a publicação, mantendo o histórico.

Na Twitch, habilite o salvamento de transmissões anteriores na própria
plataforma. Depois copie o VOD em `twitch.tv/videos/ID`. Na Kick, use
`kick.com/canal/videos/UUID`. Um link mutável de canal é recusado como replay.
Não há descoberta automática de VODs nem integração com as contas das plataformas.

Twitch e YouTube reproduzem os vídeos no site; o replay da Kick abre o link
original na plataforma. Os replays não exibem o chat de uma live diferente.
O acervo guarda título, fonte, data de cadastro e vínculo com o evento, mas a
disponibilidade do vídeo depende de quem o publicou. Apagar/expirar um VOD na
plataforma pode tornar seu link indisponível.

Gravações seguem o proprietário atual da sala e as permissões existentes. Uma
sala oculta/excluída sai do acervo público, mas seus registros ficam disponíveis
à administração autorizada para consulta. Adicionar ou alterar publicação depende
das capacidades de edição e publicação correspondentes. URLs de vídeos não ficam na tabela de configuração
mutável da live. Há deduplicação por vídeo/destino, controle de versão para
visibilidade, auditoria privada e paginação.

APIs do acervo: `GET /api/streams/recordings`,
`GET /api/streams/recordings/:id`, `GET/POST /api/admin/stream-recordings` e
`PUT /api/admin/stream-recordings/:id`. A tabela tem RLS e não permite acesso
direto de anon/authenticated/service_role; as RPCs revalidam sessão e propriedade.

Referências: [embed Twitch](https://dev.twitch.tv/docs/embed/video-and-clips/),
[embed YouTube](https://developers.google.com/youtube/player_parameters) e
[player Kick](https://player.kick.com/).
