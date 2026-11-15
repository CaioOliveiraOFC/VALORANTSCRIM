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

## Persistência e autorização

Não há nova migração ou variável de ambiente. A pausa usa os eventos
`scrim.pause` e `scrim.resume` e o estado JSON já persistido. O servidor exige
proprietário/super admin e `editRoom`; o RPC existente revalida conta, sessão,
permissões e versões antes de gravar.

O gestor de gravações aceita filtro de sala com autorização e repassa esse
escopo ao RPC existente. Um organizador não pode cadastrar, listar ou publicar
gravações privadas de outro organizador. Empates técnicos permanecem no log e no
relatório Markdown. Os controles de rounds/KDA continuam seguindo a importação
pela API.
