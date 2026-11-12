# Roadmap da Brasa

Atualizado em **12/11/2026**. Este documento registra decisões de produto e ideias
guardadas para próximas entregas. Registrar uma ideia não autoriza implementá-la
ou publicá-la. Não há prazo ou ordem de execução fechado para os itens abaixo.

## Estado atual

- **VCT 5v5 em produção:** salas, times, veto, importação pela API, correções após
  importação, histórico, foco/sorteios, acesso administrativo e permissões.
- **Identidade Brasa em produção:** home centrada no VCT e navegação compartilhada.
- **X1 demonstrativo em produção:** escolha entre eliminação simples e dupla
  eliminação, upper/lower e grande final única. Estado local da aba, sem
  persistência ou acompanhamento real por outros espectadores.

Referências: [VCT e identidade](BRASA-VCT.md), [demonstração X1](BRASA-PREVIEW.md)
e [plano anterior](plans/2026-11-11-brasa-x1.md). As decisões atuais deste roadmap
prevalecem sobre propostas antigas ainda não implementadas.

## Guardado: perfis permanentes e sala de troféus

**Status:** fluxo validado com o Caio; implementação não iniciada.

### Experiência aprovada

1. O administrador habilita **Este evento vale troféu** na criação ou edição e
   escolhe a conquista. Começar com **Campeão** é a proposta inicial.
2. O evento acontece normalmente. No VCT, o resultado e as associações dos
   participantes vêm do fluxo de importação já existente.
3. Quando a série termina, o sistema sugere a premiação dos vencedores. Vencer
   um mapa isolado não equivale a vencer o evento.
4. Em **Revisar premiação**, o administrador confere evento, conquista, nomes e
   contas Riot. Corrige vínculos antes de confirmar quando necessário.
5. No VCT, **Conceder 5 troféus** premia os cinco vencedores em uma confirmação.
   Não há concessão pública automática apenas porque um resultado foi importado.
6. Cada conquista aparece no perfil permanente do jogador e na sala de troféus,
   com data e referência ao evento. O jogador não precisa criar login ou aceitar.

Os troféus ficam na **Brasa**, com atalho para o Tracker da conta associada.
O identificador Riot recebido da API (`puuid`) sustenta o vínculo entre eventos;
o apelido e a URL do Tracker não são a identidade permanente. A conta já associada
na importação deve ser reaproveitada, sem repetir cadastro a cada scrim.

### Permanência e correções

- Mudança de nick preserva as conquistas da conta.
- Reimportar ou confirmar novamente não duplica a mesma premiação.
- Excluir uma sala não apaga os troféus concedidos.
- Revogar uma conquista exige administrador autorizado e motivo; o registro
  administrativo é preservado.
- Alteração posterior do vencedor ou do vínculo de um premiado coloca a
  premiação em revisão. Corrigir K/D/A não deve reabrir um prêmio de campeão
  quando o vencedor e os destinatários permanecerem os mesmos.
- Eventos de teste não devem habilitar premiação por padrão.
- Permissões específicas devem respeitar o alcance das salas: administradores
  comuns atuam nas próprias; o super admin mantém alcance global.

### Dependências e decisões futuras

- Criar o cadastro permanente de jogadores e a persistência de premiações no
  Supabase, com autorização no servidor, auditoria e proteção contra duplicidade.
- Validar publicação de conquistas de eventos ocultos, sem divulgar metadados
  privados por meio do perfil público.
- Definir tratamento de eventos históricos sem conta Riot associada e a revisão
  de premiações antigas. Não inventar identidades ou conceder por semelhança de nick.
- Definir categorias adicionais e seus critérios antes de sugeri-las pela API.
- Premiação do X1 depende de campeonatos com resultados persistentes. A
  demonstração atual não produz troféus reais.

## Guardado: transmissões Twitch no site

**Status:** jornadas validadas com o Caio; implementação não iniciada.

### Administração: dois caminhos

**Transmitir um evento**

- Escolher uma sala VCT ou, quando persistente, um campeonato X1.
- Cadastrar os links Twitch e os nomes das transmissões daquele evento.
- Oferecer **Divulgar na página inicial**. A chamada na home leva ao evento,
  onde o espectador acompanha a transmissão, o chat e o andamento dos jogos.
- Jornada: **home → evento → transmissão + acompanhamento**.

**Divulgar uma live**

- Cadastrar canal e título sem exigir vínculo com evento.
- Exibir vídeo e chat em uma seção de lives da própria landing page.
- Jornada: **home → assistir ali mesmo**.

Esses caminhos representam a escolha de jornada no painel **Transmissões**.
Não há demanda por um construtor livre de fluxos ou funis.

### Carrossel e conversa

- Cadastrar um ou mais canais, inclusive as lives simultâneas de Caio e colegas.
- Um vídeo por vez, setas anterior/próximo e posição, como **1 de 3**.
- As setas trocam **vídeo e chat oficial da Twitch juntos**.
- A escolha é individual: trocar de canal não muda a transmissão dos demais.
- Carregar apenas a transmissão selecionada, evitando múltiplos áudios e tráfego
  de players escondidos.
- Permitir ordenar canais, editar títulos e publicar/ocultar a divulgação.
- Desktop: vídeo e chat lado a lado. Celular: vídeo acima, chat abaixo, com
  validação dos requisitos mínimos do player oficial.
- Discord continua como conversa do grupo, além do chat da Twitch incorporado.
- A home continua centrada no VCT; a divulgação de lives ganha espaço próprio.

### Dependências e limites

- Incorporar o player/chat oficiais e configurar os domínios `parent` corretos
  para produção e Preview, respeitando HTTPS, dimensões e reprodução no celular.
- Links dos canais bastam para incorporar. Detecção automática de quem está ao
  vivo é uma decisão separada e pode exigir integração adicional com a API Twitch.
- Autenticação, anúncios e comportamento do chat/player continuam sujeitos à Twitch.
- Respeitar permissões e visibilidade dos eventos; um evento oculto não deve
  aparecer automaticamente na home por ter uma transmissão associada.
- Não cadastrar chaves de transmissão: cada pessoa transmite para seu próprio
  canal; a Brasa reúne os players.

Referência: [documentação oficial de embeds Twitch](https://dev.twitch.tv/docs/embed/).

## Em avaliação: vídeos de apresentação e tutoriais por seção

**Status:** ideia solicitada pelo Caio; avaliar Hyperframes antes de produzir ou
inserir vídeos no site. [Viabilidade técnica e proposta](VIDEO-TUTORIALS.md).

- Landing page: vídeos curtos com aparência de GIF demonstrando criação e
  acompanhamento, sem exigir que o visitante leia um tutorial longo.
- Alternar e identificar **Visão do administrador** e **Visão do telespectador**
  no canto superior durante o vídeo, mostrando a mesma ação nas duas perspectivas.
- Portal administrativo: ajuda em vídeo específica da seção/aba atual.
- Preservar identidade Brasa, leitura confortável e navegação simples.
- Avaliar MP4/WebM em loop em vez de GIF como formato principal, com controle de
  pausa, carregamento sob demanda e alternativa textual.
- Produzir a partir de dados de demonstração e capturas reproduzíveis; não
  registrar credenciais reais ou alterar partidas hospedadas para gravar tutoriais.
- O trabalho desta etapa é documentação e viabilidade, sem mudança da interface.

## Outros itens já planejados

- **X1 persistente:** partidas, correções, formatos, histórico e atualização de
  espectadores. Preservar as opções de eliminação simples/dupla e final única.
- **Convites e sugestões reais:** apelidos e títulos com aprovação administrativa,
  preservando a identidade do jogador. A demonstração atual continua local.
- **Organização do código:** reorganizar o servidor legado e os módulos aos poucos,
  sem misturar uma reestruturação geral com mudanças de autenticação ou domínio.
- **Domínio personalizado:** adiado pelo Caio.
- **Enquetes/participação democrática:** explicitamente adiadas pelo Caio.

O carrossel antes dos troféus foi uma sugestão de sequência, não uma prioridade
fechada. A próxima implementação deve ser escolhida em uma conversa própria.
