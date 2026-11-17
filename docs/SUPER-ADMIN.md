# Administração central do site

A área **Administração**, em `/admin/management`, é exclusiva da conta confirmada do Caio. Nela o proprietário cria administradores, define o que cada um pode fazer e transfere salas. O fluxo normal de jogo continua em `/admin` e no [guia do administrador](../public/guia-admin.html).

## Instalação única

Aplique as migrações pendentes, nesta ordem:

1. `supabase/migrations/20261016_scrims.sql`
2. `supabase/migrations/20261017_match_imports.sql`
3. `supabase/migrations/20261104_room_access.sql`
4. **`supabase/migrations/20261105_super_admin.sql`**

Antes da última, confira em **Supabase → Authentication → Users** que a conta `caio.oliveira2014@hotmail.com` existe e tem e-mail confirmado. Se o projeto for novo, crie essa conta primeiro; se ela já existe, preserve o usuário. A migração encontra esse usuário e fixa seu UUID como o único super admin. Não há permissão que possa ser delegada para criar outro super admin.

A migração é aditiva: preserva salas, eventos, importações e publicação; atribui as salas anteriores ao Caio e importa as capacidades dos admins legados para a política privada. Não cria novas variáveis de ambiente. Depois dessa instalação, criar e alterar os organizadores é trabalho da interface, sem executar SQL a cada conta.

As tabelas privadas `scrim_admin_settings`, `scrim_admin_accounts` e `scrim_admin_audit` passam a ser a autoridade de acesso. Supabase Auth continua responsável pela identidade e senha. Os campos antigos de `app_metadata` são usados apenas na importação inicial; alterações posteriores neles ou em `user_metadata` não concedem acesso. Os scripts [admin-access.sql](admin-access.sql) e [room-delete-access.sql](room-delete-access.sql) são **LEGACY**, somente para a versão anterior.

A instalação completa do site também inclui as migrações de destaque, lives e gravações. Consulte a [sequência de instalação](../README-VERCEL.md#ordem-das-migrações) e execute apenas o que estiver pendente no projeto.

## Criar um administrador

1. Entre como Caio e abra **Administração → Administradores**.
2. Use **Adicionar administrador** e informe nome, e-mail de login e senha.
3. Escolha **Organizador** ou **Completo** como ponto de partida; ajuste as permissões que desejar.
4. Confirme a criação. Copie e compartilhe as credenciais uma vez, por um canal privado.

O e-mail pode ser fictício, mantendo um formato válido: a conta é criada com confirmação automática, sem depender de envio de e-mail. A senha pode ser digitada ou gerada na tela. Ela não fica disponível para consulta posterior nem é gravada no histórico de administração; o servidor não a retorna na listagem.

Se a criação for interrompida depois que a identidade já foi criada no Auth, recarregue a lista. O registro pendente oferece **Concluir cadastro**. Complete o perfil pela tela; não crie uma segunda identidade e não refaça a migração para resolver essa pendência. Se as credenciais se perderam, conclua o cadastro e redefina a senha pelo painel.

## Perfis e permissões

| Perfil inicial | O que libera nas próprias salas |
|---|---|
| Organizador | Operações normais de preparação e condução; correção de K/D/A, lixeira e edição de mídia começam desligadas. |
| Completo | As doze ações nas próprias salas, incluindo correção de K/D/A, lixeira e edição de mídia. |

Os perfis são pontos de partida. Os doze controles podem ser ajustados individualmente:

| Controle na interface | Permissão |
|---|---|
| Criar salas | `createRooms` |
| Editar a sala | `editRoom` |
| Gerenciar lives e gravações | `manageStreams` |
| Montar os times | `manageTeams` |
| Escolher os mapas | `manageVeto` |
| Controlar sorteios | `manageDraws` |
| Chamar os participantes | `manageFocus` |
| Importar partidas | `importMatches` |
| Corrigir estatísticas | `correctStats` |
| Adicionar anotações | `manageNotes` |
| Publicar ou ocultar salas | `publishRooms` |
| Gerenciar a lixeira | `deleteRooms` |

Nenhum desses controles libera a administração de contas ou o acesso global às salas. Um administrador comum atua **somente nas salas que possui** e nas ações liberadas. Uma sala pública de outra pessoa é vista como espectador; uma sala oculta de outra pessoa permanece inacessível. Mesmo o perfil Completo não transforma a conta em super admin.

### Consultar mídia e autorizar alterações

Uma conta administrativa ativa pode abrir **Lives e gravações** e consultar a mídia das próprias salas sem receber edição. O Caio continua vendo todas as salas. A leitura inclui configurações salvas e gravações autorizadas daquele evento; não amplia o acesso a salas de outros organizadores.

Para permitir alterações, libere **Gerenciar lives e gravações** (`manageStreams`) na conta. **Editar a sala** permanece uma capacidade separada e não libera essas alterações. Sem `manageStreams`, os controles de salvar links, exibir/ocultar a live e cadastrar gravações não ficam disponíveis, e a API recusa essas operações. Retirar a permissão bloqueia novas alterações sem ocultar as lives, apagar replays ou remover o acesso de consulta.

Essa separação exige a publicação coordenada da aplicação compatível e, logo
depois, `20261116_media_permissions.sql`, após as migrações anteriores de
streams. A versão antiga não aceita a política com doze chaves; aplicar esse SQL
antes do deploy compatível interrompe login e acesso de todos os admins. Até
o SQL, a aplicação nova mantém login com a política anterior, mas a mídia
administrativa retorna 503 e operações de contas que enviam doze capacidades
ficam indisponíveis. Siga a [ordem e recuperação do ambiente](../README-VERCEL.md#atualizar-permissões-de-mídia-em-um-projeto-em-uso).

A migração inicia `manageStreams` como falso
para todos os admins existentes que não são super admin, sem apagar mídia.
Isso também vale para contas que tinham o perfil Completo: nenhum acesso é
ampliado automaticamente. O Caio pode marcar a capacidade individual ou escolher
explicitamente o perfil Completo atualizado, que a inclui. Novas contas no
perfil Organizador começam sem edição de mídia.

A publicação de gravações e o destaque de um evento na home também dependem de **Publicar ou ocultar salas** e de uma sala publicada. A configuração **Divulgar uma live sem evento**, na página inicial, permanece exclusiva do Caio; conceder edição de mídia a um organizador não libera essa ação. O [guia de mídia](STREAMS.md) descreve o uso diário.

## Transferir uma sala

Na aba **Todas as salas**, confira o proprietário atual e use a ação de transferência para selecionar o novo responsável. Só o Caio pode transferir, inclusive de si para outro administrador ou de outro administrador para si. O novo proprietário recebe a gestão conforme suas permissões; o anterior perde o acesso de edição, salvo o acesso global do Caio.

As salas antigas ficam inicialmente com o Caio. Transfira aquelas que outro organizador precisa continuar. A transferência preserva o estado, os eventos, os resultados e a visibilidade. Confira sala e destino antes de confirmar; se outra pessoa alterou o registro durante a edição, recarregue e revise a versão atual.

## Suspender, reativar e redefinir senha

- **Suspender:** bloqueia o acesso administrativo da conta e invalida suas sessões. Salas, resultados e histórico permanecem; a publicação das salas não é alterada automaticamente.
- **Reativar:** mantém as permissões configuradas e libera um novo login. As sessões anteriores à suspensão continuam inválidas.
- **Redefinir senha:** digite ou gere a nova senha na tela e repasse-a uma vez. O servidor invalida as sessões antigas antes de atualizar a senha no Auth; a pessoa precisa entrar novamente. Enquanto a operação estiver pendente, novos logins ficam bloqueados. Se a resposta não for confirmada, mantenha o formulário e conclua com a mesma senha, sem gerar outra ou repetir automaticamente a operação. Não distribua uma senha que não foi confirmada.

Durante uma resposta incerta, o servidor mantém uma prova temporária de igualdade protegida por chave para permitir somente a retomada com a mesma senha. Essa prova não é a senha, não é enviada ao navegador nem registrada na auditoria, e é removida quando a operação termina. Se perder a senha de uma operação ainda pendente, o painel não consegue recuperá-la. Como alternativa pelo próprio site, crie outro acesso, transfira as salas para ele e suspenda a conta antiga. Nunca altere a prova interna ou o histórico para forçar uma liberação.

A própria conta do Caio é protegida: a console não permite suspendê-la, rebaixá-la ou redefinir sua senha como se fosse um organizador comum. Para recuperar essa conta, use as ferramentas administrativas do projeto Supabase em um canal seguro, preservando o mesmo usuário/UUID. Não apague e recrie o usuário para contornar a proteção.

## Histórico privado e limites

Criações, mudanças de permissão, suspensão, redefinição de senha e transferências têm auditoria privada. Senhas, tokens e cookies não entram nesse histórico. A lista de contas é paginada; use sua navegação para consultar os demais registros. A lista de salas mantém o limite atual de até 500 registros por consulta.

Não confunda proprietário da sala com proprietário do site: admins comuns podem possuir salas, mas a área Administração continua exclusiva do Caio. O login da Vercel que protege um Preview também é separado do login do site.

## Conferência no Preview e publicação

Para uma atualização, confira o PR, os testes e o ambiente de destino. As migrações pendentes no Supabase são um requisito de ambiente; a validação da interface não as substitui. A atualização de mídia publica primeiro a aplicação compatível e executa o SQL logo depois, com janela e responsável definidos. Até essa coordenação estar pronta, mantenha a atualização sem publicar. A proteção de login de um Preview da Vercel é separada do acesso administrativo da aplicação.

Neste projeto, Preview e Production compartilham o Supabase. APIs antigas podem ignorar as novas capacidades e a propriedade das salas, especialmente quando ainda consultam com `service_role`. Use apenas contas e salas fictícias no Preview. Só confie no isolamento depois de atualizar os domínios ativos e aposentar ou bloquear deployments/Previews antigos que mantenham esse acesso de serviço.

Após instalar a migração, confira com Caio e dois organizadores de teste:

- Apenas Caio abre `/admin/management` e administra contas; a própria conta permanece protegida.
- Organizador cria uma sala própria e não edita a sala do outro. A sala pública do outro abre como espectador; a oculta não abre.
- Organizador começa sem correção de K/D/A, lixeira e edição de mídia; escolher Completo libera essas ações apenas nas próprias salas. Alterar um controle muda somente a capacidade correspondente.
- Um organizador sem edição de mídia abre **Lives e gravações** e consulta somente suas salas, incluindo links ocultos e gravações privadas autorizadas, sem formular alterações. A API também recusa gravações/modificações diretas sem a permissão.
- Conceder edição de mídia libera os controles correspondentes nas próprias salas; revogar bloqueia novas alterações e mantém o conteúdo salvo. A live independente na home continua exclusiva do Caio.
- Transferir uma sala muda quem pode editá-la sem mudar dados ou publicação.
- Suspender nega edições e login sem apagar ou ocultar as salas; reativar exige nova sessão e preserva permissões.
- Redefinir senha exige novo login e não aceita a sessão antiga; o registro privado não contém a senha.
- Uma criação interrompida pode ser resolvida por **Concluir cadastro** e as listas mostram os próximos registros pela paginação.
- Salas restauradas continuam ocultas; espectadores só leem salas publicadas e não excluídas.

Os testes locais usam Auth/REST simulados e Postgres embutido. A validação positiva no serviço hospedado exige aplicar a migração e usar as contas reais do projeto, sem alterar as scrims reais para esse teste.


## Escolher o VCT em destaque

Em Administração → Todas as salas, abra **VCT em destaque na home → Configurar**.
Escolha uma sala publicada ou **Automático**. Apenas o Caio possui essa ação.
É necessária a instalação única de `20261112_home_feature.sql`.
Uma sala que se torne oculta ou excluída deixa de ser exposta; a home escolhe outra
automaticamente. O mesmo acontece durante um empate técnico, mesmo que a sala
continue publicada; ela permanece acessível no histórico. Veja [BRASA-VCT.md](BRASA-VCT.md).
