# Criar e administrar os acessos de organizadores

Este documento é para o responsável pelo site. O material para os organizadores é [Guia do administrador](../public/guia-admin.html), disponível na aplicação em `/guia-admin.html` e como PDF em `/guia-admin.pdf`.

O login usa e-mail e senha do Supabase Auth. O site só concede acesso quando o usuário verificado possui **`app_metadata.scrim_admin: true`**. Uma conta comum, mesmo que exista no Supabase, continua sem permissão de administrar. `user_metadata` não concede essa permissão.

Um administrador autorizado pode criar, editar e mostrar/ocultar as salas. Excluir e restaurar exige a permissão adicional descrita abaixo. O espectador acompanha sem conta apenas as salas publicadas. Você pode criar uma conta por organizador ou uma conta compartilhada para os organizadores; com contas individuais, é possível retirar o acesso de uma pessoa sem trocar o acesso das demais.

## Preparar a primeira conta

1. Abra o projeto Supabase usado pela aplicação. Confira a URL do projeto com a configuração `SUPABASE_URL` da Vercel, sem copiar a chave secreta.
2. Vá a **Authentication → Users** e use a ação de adicionar/criar um usuário.
3. Informe o e-mail e uma senha para o organizador. Se a opção **Auto Confirm User** estiver disponível, marque-a para liberar o login sem depender de um e-mail de confirmação.
4. Abra [admin-access.sql](admin-access.sql). Troque `organizador@exemplo.invalid` pelo e-mail que você acabou de cadastrar e mantenha a ação como `grant`.
5. Execute o arquivo inteiro no **SQL Editor** desse mesmo projeto. Ele verifica se existe exatamente uma conta com esse e-mail antes de alterar a permissão. Confira o resultado: e-mail correto e `administrador = true`.
6. No endereço de teste da aplicação, abra `/admin`, entre com essa conta e confira a **Área do administrador**. Dentro de uma sala deve aparecer **Admin**.
7. Envie as credenciais pelo canal privado que você usa com o organizador. O guia de uso pode ser enviado separadamente, pois não contém credenciais.

A liberação altera apenas `raw_app_meta_data.scrim_admin` da conta indicada, preservando os outros metadados de autenticação. Não altera salas, partidas, eventos ou estatísticas. O script não cria conta nem senha e não deve ser colocado na pasta de migrações para execução automática.

A migração **`20261104_room_access.sql` é obrigatória**, depois de `20261016_scrims.sql` e `20261017_match_imports.sql`. Ela adiciona visibilidade e exclusão lógica, ajusta o acesso público aos eventos e preserva as salas existentes como públicas. Não há nova variável de ambiente. O servidor usa as configurações Supabase já existentes; a chave `SUPABASE_SERVICE_ROLE_KEY` permanece exclusivamente no servidor. Não publique senhas, tokens ou chaves nos arquivos do repositório ou no PR.

## Criar outro administrador

Repita a criação do usuário e execute o script com o e-mail dessa nova conta. Deixe `grant` como ação. A lista de administradores não é uma lista pública na aplicação; o servidor verifica a permissão da conta que está entrando.

## Retirar o acesso

No mesmo [admin-access.sql](admin-access.sql), use o e-mail exato da conta e troque a ação para:

```sql
select set_config('app.scrim_admin_action', 'revoke', true);
```

Execute o arquivo inteiro. Confira `administrador = false`. A conta perde as permissões na próxima verificação feita pela API. A interface pode ainda mostrar a sessão por alguns instantes; uma nova tentativa de edição não deve ser autorizada.

Em uma conta compartilhada, a retirada afeta todos que usam aquela mesma conta. Para retirar apenas uma pessoa, use contas individuais.

## Quem pode excluir e restaurar

A conta de admin com e-mail **`caio.oliveira2014@hotmail.com` confirmado pelo Supabase Auth** é o proprietário e pode excluir/restaurar sem flag extra. Ela ainda precisa ser uma conta de admin válida. Outros administradores precisam de **`app_metadata.scrim_delete_rooms: true`**.

Para liberar outro administrador, abra [room-delete-access.sql](room-delete-access.sql), informe o e-mail exato da conta, mantenha a ação `grant` e execute o arquivo inteiro. O script exige que a conta já tenha `scrim_admin: true`; ele não libera admin sozinho. Confira `scrim_delete_rooms = true`. Para retirar somente essa permissão, execute com a ação `revoke`. O restante do acesso administrativo permanece.

As duas permissões ficam em `raw_app_meta_data`, expostas ao servidor como `app_metadata`. `user_metadata` não autoriza nenhuma delas.

Excluir é uma operação lógica: tira a sala das listas normais e bloqueia seu acesso, mas conserva os eventos e importações. Quem tem a permissão pode restaurá-la; **a restauração sempre volta como oculta**. Mostrar para espectadores exige uma ação separada pelo olho. Retirar a flag extra não retira os poderes do proprietário confirmado.

## Mostrar ou ocultar uma sala

Todo admin pode usar o olho para **Mostrar para espectadores** ou ocultar uma sala. A nova sala começa oculta; o checkbox **Mostrar para espectadores** na criação permite publicá-la desde o começo. Administradores continuam vendo as salas ocultas.

Com a migração e a versão atual aplicadas, uma sala oculta não aparece na lista pública. Link direto, relatório e eventos também ficam indisponíveis ao público. A exclusão lógica bloqueia a sala até ser restaurada. O histórico não é apagado.

### Limite do ambiente compartilhado

Preview e Production usam o mesmo Supabase neste projeto. A **API antiga de produção ignora a visibilidade**, e `service_role` tem acesso que não é filtrado pelo RLS. Portanto, aplicar a migração ou testar um novo Preview, isoladamente, não garante privacidade em todos os domínios.

Use apenas dados fictícios no Preview. Antes de confiar na ocultação para dados reais, publique a versão nova em todos os domínios ativos e aposente os deployments/Previews antigos que ainda possam consultar esse banco com a chave de serviço. Preserve o histórico e evite tratar uma sala oculta no Preview como privada enquanto a API antiga continuar acessível.

## Se precisar substituir as credenciais

Se o painel do seu projeto oferecer alteração direta de senha para a conta, faça a alteração por esse recurso e compartilhe a nova senha pelo canal privado dos organizadores.

O envio de um e-mail de recuperação, sozinho, não completa a troca nesta aplicação: esse fluxo do Supabase exige uma URL e uma tela para definir a nova senha. O login simples desta entrega não inclui essa tela. Para manter a operação sem depender desse fluxo, crie outra conta em **Authentication → Users**, libere-a com `grant`, teste o novo login e retire a permissão da conta antiga com `revoke`.

Não altere `encrypted_password` por SQL nem salve senhas em scripts. Retirar a permissão de admin bloqueia novas edições da conta, mesmo que ainda exista uma sessão no navegador.

## O que muda nos links antigos

Os IDs das salas e o histórico são preservados. O fragmento antigo `#admin=…` deixa de conceder permissão de edição: para administrar uma sala, a pessoa entra com a conta de admin. As novas salas não entregam chave de admin no navegador; o login passa a ser o caminho para organizar.

Os espectadores recebem apenas o link público da sala. Uma pessoa já autenticada como admin continuará vendo seus controles ao abrir uma sala nesse navegador; o mesmo link, em uma janela privada sem login, só deve abrir como espectador se a sala estiver publicada.

## Conferir antes de mesclar/publicar

O Preview da Vercel pode ter uma proteção de acesso própria. Esse login da Vercel é diferente do login por e-mail e senha da aplicação. Se a proteção estiver ativa, permita acesso aos participantes do teste pelo recurso de compartilhamento do projeto.

Aplique primeiro as três migrações, na ordem indicada. Use dados fictícios em salas descartáveis no Preview e confira:

- O proprietário e outro admin entram em `/admin`; uma conta sem `scrim_admin: true` não recebe acesso.
- Nova sala fica oculta por padrão; o checkbox da criação e o olho permitem mostrar/ocultar para qualquer admin.
- Admin vê a sala oculta. Sem login, ela some da listagem e responde 404 no link, no JSON e no relatório; `SELECT` público de seus eventos não retorna linhas.
- Publicar pelo olho libera a leitura do espectador; ocultar novamente corta as novas leituras públicas.
- Admin comum pode editar e mostrar/ocultar, mas não pode excluir/restaurar. O proprietário pode; outro admin só pode após `grant` no script de exclusão. `user_metadata` ou a flag de exclusão sem `scrim_admin` não concedem acesso.
- Exclusão lógica tira o acesso e as listas; restauração preserva eventos/importações e volta oculta. Verifique em uma sala de teste já importada.
- Sem importação, o espectador publicado vê **Aguardando importação da partida para você**. O admin busca por nick/link depois da partida e importa o resultado.
- Não existem controles manuais de round/desfazer; comandos diretos também são recusados. K/D/A só pode ser ajustado em **Corrigir estatística**, após importação da API.
- **Sair do admin**, revogar a conta e usar um link antigo com `#admin=…` não permitem novas edições sem sessão válida.
- Foco, sorteios e importação continuam funcionando; o guia abre no celular e o PDF baixa e abre fora do site.

Esta conferência do Preview não substitui a atualização dos demais domínios ativos do ambiente compartilhado.

Os testes locais simulam o Supabase Auth e não validam uma conta real do projeto. A validação positiva no Preview depende da conta criada e liberada pelos passos acima. Não é necessário usar ou alterar as scrims reais para essa conferência.
