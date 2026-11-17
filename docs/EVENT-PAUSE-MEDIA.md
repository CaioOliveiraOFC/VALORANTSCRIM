# Empate técnico e mídia dentro do evento

## Empate técnico que pode ser retomado

Na sala, o administrador com **Editar a sala** encontra **Declarar empate
técnico**. O motivo vem preenchido e pode ser ajustado. **Pausar scrim** mantém
o placar real, jogadores, capitães, veto, mapas e fontes dos resultados importados.
Não inventa uma vitória, não zera estatísticas e não apaga eventos.

A sala deixa a home, os destaques e a lista VCT ativa e aparece no **Histórico**
como **Empate técnico · pode retomar**. Mesmo uma sala fixada deixa de ocupar
o destaque enquanto estiver pausada. A administração continua encontrando a sala.

**Retomar scrim** restaura a fase em que ela estava: preparação, veto ou partida.
Os espectadores recebem pausa e retomada em tempo real. Durante a pausa,
alterações do jogo, sorteios e importações ficam bloqueados; anotações, foco,
lives e gravações continuam disponíveis. Uma série já encerrada por resultado
não é reaberta por esse controle.

## Lives e gravações na própria sala

O bloco **Acompanhe este evento** reúne:

- **Ao vivo:** adicionar links de Twitch, YouTube ou Kick, nomear perspectivas,
  salvar/exibir e ocultar a live. O evento já existe, portanto não há criação
  de um segundo contêiner nem escolha de destino em outro painel.
- **Gravações:** cadastrar o link do vídeo específico e assistir aos replays
  desse evento no player compacto. Em pausa ou encerramento, esta aba ganha
  prioridade quando o espectador ainda não escolheu uma aba.

O status identifica se o player está exibido naquele evento. Isso não é uma
detecção automática de canal online/offline. O mini player permite trocar de
perspectiva e ampliar; vídeo e chat do canal anterior não continuam tocando
ao mudar de aba.

As gravações mantêm as regras já publicadas: título, identificador estável,
vínculo com o evento, histórico persistente e visibilidade própria. Não há
cópia dos arquivos e a disponibilidade depende de cada plataforma. Replays
Twitch/YouTube podem rodar no site; os da Kick mantêm o link para a plataforma.

## Área geral

**Lives e gravações** vira uma visão dos eventos com atalho para abrir a mídia
na própria sala. A divulgação independente na página inicial permanece para o
super admin. O acervo geral continua disponível para consulta, sem ser a etapa
obrigatória para colocar vídeos em uma scrim.

Toda conta administrativa ativa pode consultar a mídia das próprias salas;
o super admin pode consultar todas. Os controles de adicionar links,
salvar/exibir, ocultar a live e cadastrar gravações exigem **Gerenciar lives e
gravações** (`manageStreams`). **Editar a sala** não libera essas alterações.
Publicar replays ou destacar eventos na home também exige **Publicar ou ocultar
salas**. A capacidade de mídia não concede a divulgação independente na home,
que continua exclusiva do Caio.

Publicar ou ocultar um player é manual. O site não detecta quando a transmissão
começa ou termina na plataforma. O [guia de mídia](STREAMS.md) inclui o passo a
passo da live independente e os formatos de links aceitos para replays.

## Persistência e autorização

Para a pausa não há migração própria nem variável de ambiente nova. Ela usa os eventos
`scrim.pause` e `scrim.resume` e o estado JSON já persistido. O servidor exige
proprietário/super admin e `editRoom`; o RPC existente revalida conta, sessão,
permissões e versões antes de gravar.

A separação entre consulta e edição de mídia exige
[`20261116_media_permissions.sql`](../supabase/migrations/20261116_media_permissions.sql),
após as migrações anteriores de streams. A aplicação desse SQL no projeto
hospedado precisa ser coordenada: publique primeiro a aplicação compatível com
`manageStreams` e execute o SQL logo depois, em uma janela curta. A versão antiga
rejeita a política com doze chaves; SQL primeiro interrompe login e acesso
administrativo. A versão nova aceita a política anterior; até o SQL, a mídia
administrativa responde 503 e operações de contas com doze capacidades ficam
indisponíveis. Consultas e players públicos existentes continuam disponíveis.
O código não executa o SQL automaticamente. A [ordem de atualização e recuperação](../README-VERCEL.md#atualizar-permissões-de-mídia-em-um-projeto-em-uso)
detalha validação e rollback sem perder permissões ou histórico.
Contas existentes que não são super admin e novas contas no perfil Organizador
começam com `manageStreams` desligado. O Caio concede a capacidade pela interface;
escolher explicitamente Completo também a inclui. Nenhum link, replay ou evento
existente é apagado ao alterar essa permissão.

O gestor de gravações aceita filtro de sala com autorização e repassa esse
escopo ao RPC existente. Um organizador não pode cadastrar, listar ou publicar
gravações privadas de outro organizador. Empates técnicos permanecem no log e no
relatório Markdown. Os controles de rounds/KDA continuam seguindo a importação
pela API.
