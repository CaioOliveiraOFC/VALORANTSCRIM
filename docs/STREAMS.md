# Twitch, YouTube, Kick e gravações na Brasa

## Antes de publicar esta versão

Aplicar **uma vez** [20261113_streams.sql](../supabase/migrations/20261113_streams.sql)
no SQL Editor do projeto Supabase já usado pelo site. Requer a migração de super
admin de 20261105, que o painel atual já utiliza. Não altera eventos, partidas,
contas ou dados existentes. Não exige nova variável de ambiente nem chave Twitch.

Para as três plataformas e o acervo, aplicar depois
[20261114_multiplatform_streams.sql](../supabase/migrations/20261114_multiplatform_streams.sql).
Ela amplia a validação e adiciona uma tabela de gravações. Os canais Twitch já
salvos continuam no mesmo formato e não são reescritos.

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

A área **Lives e gravações** é um diretório com atalhos para os eventos. Não é
necessário criar uma transmissão em outro painel para depois vinculá-la à sala.
A divulgação independente na página inicial permanece em um bloco separado,
exclusivo do super admin. A organização por evento usa as migrações já instaladas;
não é necessário aplicar outro SQL.

## Regras e limites

- Até seis perspectivas por transmissão, sem duplicados. Twitch aceita o nome
  do canal ou seu link; Kick aceita o link do canal; YouTube aceita `/watch?v=`,
  `/live/` e `youtu.be`. URLs arbitrárias e HTML de iframes são recusados.
- Twitch usa player e chat incorporados. YouTube usa player e chat da live
  quando disponível. Kick usa `player.kick.com` para lives e um link para abrir
  o chat na plataforma. Restrições do canal/plataforma podem bloquear embeds;
  o link original continua acessível.
- Organizador com **Editar a sala** configura as próprias salas. Super admin
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
- X1 segue sendo uma prévia local. Não existe vínculo persistente de live com
  um campeonato X1 nesta versão; é possível divulgá-la na home independente.

## Segurança e recuperação

`scrim_broadcasts` tem RLS e nenhum acesso direto para anon, authenticated ou
service_role. A API usa a service role somente no servidor e RPCs delimitadas.
As funções validam conta ativa, versão da sessão, propriedade e permissões,
mesmo para chamadas com service role. Escritas usam bloqueios de conta/sala,
versão otimista e auditoria privada; conflito de duas abas não sobrescreve dados.

Antes da migração, as páginas públicas continuam funcionando sem transmissões.
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
   live pode continuar sendo o do replay; o campo já vem preenchido nesse caso.
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
à administração autorizada. URLs de vídeos não ficam na tabela de configuração
mutável da live. Há deduplicação por vídeo/destino, controle de versão para
visibilidade, auditoria privada e paginação.

APIs do acervo: `GET /api/streams/recordings`,
`GET /api/streams/recordings/:id`, `GET/POST /api/admin/stream-recordings` e
`PUT /api/admin/stream-recordings/:id`. A tabela tem RLS e não permite acesso
direto de anon/authenticated/service_role; as RPCs revalidam sessão e propriedade.

Referências: [embed Twitch](https://dev.twitch.tv/docs/embed/video-and-clips/),
[embed YouTube](https://developers.google.com/youtube/player_parameters) e
[player Kick](https://player.kick.com/).
