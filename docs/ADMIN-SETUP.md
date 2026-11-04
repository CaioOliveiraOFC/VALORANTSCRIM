# Criar e administrar os acessos de organizadores

Este documento é para o responsável pelo site. O material para os organizadores é [Guia do administrador](../public/guia-admin.html), disponível na aplicação em `/guia-admin.html` e como PDF em `/guia-admin.pdf`.

O login usa e-mail e senha do Supabase Auth. O site só concede acesso quando o usuário verificado possui **`app_metadata.scrim_admin: true`**. Uma conta comum, mesmo que exista no Supabase, continua sem permissão de administrar. `user_metadata` não concede essa permissão.

Um administrador autorizado pode criar e administrar **todas as salas**. O espectador abre um link de sala e acompanha sem conta. Você pode criar uma conta por organizador ou uma conta compartilhada para os organizadores; com contas individuais, é possível retirar o acesso de uma pessoa sem trocar o acesso das demais.

## Preparar a primeira conta

1. Abra o projeto Supabase usado pela aplicação. Confira a URL do projeto com a configuração `SUPABASE_URL` da Vercel, sem copiar a chave secreta.
2. Vá a **Authentication → Users** e use a ação de adicionar/criar um usuário.
3. Informe o e-mail e uma senha para o organizador. Se a opção **Auto Confirm User** estiver disponível, marque-a para liberar o login sem depender de um e-mail de confirmação.
4. Abra [admin-access.sql](admin-access.sql). Troque `organizador@exemplo.invalid` pelo e-mail que você acabou de cadastrar e mantenha a ação como `grant`.
5. Execute o arquivo inteiro no **SQL Editor** desse mesmo projeto. Ele verifica se existe exatamente uma conta com esse e-mail antes de alterar a permissão. Confira o resultado: e-mail correto e `administrador = true`.
6. No endereço de teste da aplicação, abra `/admin`, entre com essa conta e confira a **Área do administrador**. Dentro de uma sala deve aparecer **Admin**.
7. Envie as credenciais pelo canal privado que você usa com o organizador. O guia de uso pode ser enviado separadamente, pois não contém credenciais.

A liberação altera apenas `raw_app_meta_data.scrim_admin` da conta indicada, preservando os outros metadados de autenticação. Não altera salas, partidas, eventos ou estatísticas. O script não cria conta nem senha e não deve ser colocado na pasta de migrações para execução automática.

Não são necessárias novas tabelas ou variáveis de ambiente para esta feature. O servidor usa as configurações Supabase já existentes; a chave `SUPABASE_SERVICE_ROLE_KEY` permanece exclusivamente no servidor. Não publique senhas, tokens ou chaves nos arquivos do repositório ou no PR.

## Criar outro administrador

Repita a criação do usuário e execute o script com o e-mail dessa nova conta. Deixe `grant` como ação. A lista de administradores não é uma lista pública na aplicação; o servidor verifica a permissão da conta que está entrando.

## Retirar o acesso

No mesmo [admin-access.sql](admin-access.sql), use o e-mail exato da conta e troque a ação para:

```sql
select set_config('app.scrim_admin_action', 'revoke', true);
```

Execute o arquivo inteiro. Confira `administrador = false`. A conta perde as permissões na próxima verificação feita pela API. A interface pode ainda mostrar a sessão por alguns instantes; uma nova tentativa de edição não deve ser autorizada.

Em uma conta compartilhada, a retirada afeta todos que usam aquela mesma conta. Para retirar apenas uma pessoa, use contas individuais.

## Se precisar substituir as credenciais

Se o painel do seu projeto oferecer alteração direta de senha para a conta, faça a alteração por esse recurso e compartilhe a nova senha pelo canal privado dos organizadores.

O envio de um e-mail de recuperação, sozinho, não completa a troca nesta aplicação: esse fluxo do Supabase exige uma URL e uma tela para definir a nova senha. O login simples desta entrega não inclui essa tela. Para manter a operação sem depender desse fluxo, crie outra conta em **Authentication → Users**, libere-a com `grant`, teste o novo login e retire a permissão da conta antiga com `revoke`.

Não altere `encrypted_password` por SQL nem salve senhas em scripts. Retirar a permissão de admin bloqueia novas edições da conta, mesmo que ainda exista uma sessão no navegador.

## O que muda nos links antigos

Os IDs das salas e o histórico são preservados. O fragmento antigo `#admin=…` deixa de conceder permissão de edição: para administrar uma sala, a pessoa entra com a conta de admin. As novas salas não entregam chave de admin no navegador; o login passa a ser o caminho para organizar.

Os espectadores recebem apenas o link público da sala. Uma pessoa já autenticada como admin continuará vendo seus controles ao abrir uma sala nesse navegador; o mesmo link, em uma janela privada sem login, deve abrir como espectador.

## Conferir antes de mesclar/publicar

O Preview da Vercel pode ter uma proteção de acesso própria. Esse login da Vercel é diferente do login por e-mail e senha da aplicação. Se a proteção estiver ativa, permita acesso aos participantes do teste pelo recurso de compartilhamento do projeto.

Use uma sala descartável criada no Preview e faça estas verificações no ambiente hospedado:

- Conta autorizada entra em `/admin`, cria uma sala e recebe os controles de admin.
- Conta existente sem `scrim_admin: true` não recebe acesso administrativo.
- Janela privada, sem login, vê a sala como espectador e não pode criar nem editar.
- Um link antigo com `#admin=…` não concede acesso sem login.
- **Sair do admin** encerra o acesso do navegador; atualizar a página continua como espectador.
- Após retirar a permissão da conta, a API nega novas edições.
- Sorteios, foco do admin e importação continuam funcionando para a conta autorizada; os espectadores recebem as atualizações.
- `/guia-admin.html` abre no celular e o PDF baixa e abre fora do site.

Os testes locais simulam o Supabase Auth e não validam uma conta real do projeto. A validação positiva no Preview depende da conta criada e liberada pelos passos acima. Não é necessário usar ou alterar as scrims reais para essa conferência.
