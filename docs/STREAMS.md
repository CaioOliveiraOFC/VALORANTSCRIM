# Twitch na Brasa

## Antes de publicar esta versão

Aplicar **uma vez** [20261113_streams.sql](../supabase/migrations/20261113_streams.sql)
no SQL Editor do projeto Supabase já usado pelo site. Requer a migração de super
admin de 20261105, que o painel atual já utiliza. Não altera eventos, partidas,
contas ou dados existentes. Não exige nova variável de ambiente nem chave Twitch.

## Configuração em poucos passos

1. Entre como administrador e abra **Transmissões** no cabeçalho ou no painel.
2. Escolha onde assistir: uma das suas salas ou **Página inicial · sem evento**
   (essa última opção é exclusiva do super admin).
3. Cole um ou mais canais, por exemplo `https://twitch.tv/masterpfi`. Dê nomes
   curtos às perspectivas se quiser. As setas para cima/baixo definem a ordem.
4. Marque **Exibir transmissão**. Para um evento público, você também pode marcar
   **Divulgar também na página inicial**: o destaque leva a galera até a sala,
   onde ficam o vídeo, o chat, os times e os mapas.
5. Use **Testar player e chat** para conferir só na sua tela; clique em
   **Salvar transmissão** para publicar. Inicie a live normalmente no OBS/Twitch.

Cada espectador usa as setas para escolher seu canal. A escolha é individual;
mudar uma perspectiva troca vídeo e chat juntos e remove o player anterior,
evitando áudio de dois canais. Reordenar a lista não troca o canal que a pessoa
já selecionou, se ele ainda estiver disponível.

Para encerrar a exibição, desmarque **Exibir transmissão** e salve. Os canais
ficam armazenados para a próxima. Os espectadores recebem mudanças de
configuração em até 10 segundos, sem recarregar a página.

## Regras e limites

- Até seis canais por transmissão, sem duplicados. Apenas nomes/links de canais
  da Twitch; clipes, VODs, iframes e URLs de outros sites são recusados.
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
- `parent` é o hostname atual, tanto para vídeo quanto para chat: produção,
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
