# Acesso dos organizadores

O uso da sala está no [guia do administrador](../public/guia-admin.html), publicado em `/guia-admin.html` e `/guia-admin.pdf`. A gestão das contas agora fica em **Administração**, em `/admin/management`, exclusiva do Caio. O passo a passo completo está em [SUPER-ADMIN.md](SUPER-ADMIN.md).

## Instalar uma vez

1. Confira no Supabase Auth a conta existente `caio.oliveira2014@hotmail.com`, com e-mail confirmado. Preserve o usuário existente.
2. Aplique as migrações pendentes na ordem: `20261016_scrims.sql`, `20261017_match_imports.sql`, `20261104_room_access.sql` e **`20261105_super_admin.sql`**.
3. Entre com a conta do Caio e abra **Administração → Administradores**.
4. Crie os organizadores pela tela, escolha o perfil e repasse as credenciais por canal privado.

A última migração fixa o UUID do Caio como o único super admin, importa os acessos anteriores e atribui a ele as salas existentes, sem mudar histórico ou publicação. Não há nova variável de ambiente nem SQL recorrente para cada organizador.

A política de acesso fica nas tabelas privadas do banco; o Auth cuida do e-mail e da senha. `app_metadata` só é lido na importação inicial dos administradores antigos. Os scripts [admin-access.sql](admin-access.sql) e [room-delete-access.sql](room-delete-access.sql) são **LEGACY**, mantidos sem mudança de comportamento para a versão anterior. Depois da migração, use a tela de administração: mudar flags nesses scripts ou em `user_metadata` não altera a política da versão nova.

## Criar, editar ou suspender

Use **Adicionar administrador** para informar nome, e-mail de login e senha. O e-mail pode ser fictício em formato válido, com confirmação automática; não depende de entrega de e-mail. A senha é digitada ou gerada na tela e compartilhada uma vez, sem entrar na listagem ou auditoria.

- **Organizador:** ações normais de condução nas próprias salas, com correção de K/D/A e lixeira desligadas inicialmente.
- **Completo:** todas as ações nas próprias salas.
- **Ajustes individuais:** os onze controles de permissão permitem adaptar o perfil. Nenhum deles concede a gestão de contas ou o acesso global do Caio.

Contas anteriores mantêm suas capacidades importadas, agora limitadas às próprias salas. Uma conta comum não administra salas de outro organizador: as públicas são vistas como espectador e as ocultas são inacessíveis.

Suspender bloqueia a conta sem apagar salas, mudar sua publicação ou perder histórico. Reativar preserva as permissões, mas exige um novo login. Redefinir a senha também invalida as sessões antigas e exige novo login. Essas ações não podem ser usadas contra a própria conta protegida do Caio nesta console.

Se o cadastro ficou pendente após a criação da identidade no Auth, recarregue a lista e use **Concluir cadastro**. Não crie uma segunda identidade nem repita a migração para resolver o cadastro.

## Salas e propriedade

Uma nova sala pertence à conta que a criou e começa oculta. A opção **Mostrar para espectadores** permite publicá-la na criação. O proprietário comum só pode editar, publicar/ocultar, importar, corrigir estatísticas ou usar a lixeira conforme as capacidades que recebeu.

Só o Caio pode transferir salas na aba **Todas as salas**, inclusive para si. As salas anteriores à migração ficam com ele até uma transferência. Transferir preserva eventos, resultados e publicação.

O público só lê salas publicadas e não excluídas. Ocultas não aparecem na lista nem abrem por link, relatório ou eventos públicos. Exclusão lógica conserva eventos e importações; restaurar sempre volta como oculta. O login substitui os links antigos com `#admin=…`, que não concedem edição.

## Ambiente compartilhado e validação

Preview e Production usam o mesmo Supabase neste projeto. Versões antigas da API podem ignorar visibilidade, capacidades e propriedade; `service_role` não é limitado pelo RLS. Use apenas dados fictícios no Preview e só confie no isolamento depois de atualizar os domínios ativos e aposentar ou bloquear deployments antigos com acesso de serviço ao banco.

A proteção do Preview da Vercel é um acesso separado do login do site. Para testar com outras pessoas, libere esse acesso e usem todos o mesmo endereço de Preview.

Antes de mesclar, aplique a migração e siga a [conferência em SUPER-ADMIN.md](SUPER-ADMIN.md#conferência-no-preview-e-publicação) com Caio e dois organizadores de teste. Confira propriedade, perfis, suspensão/reativação, invalidação de sessões após troca de senha, transferência, cadastro pendente e leitura pública/oculta. Preserve as salas reais.

Os testes locais não validam uma conta Auth real nem substituem a instalação da migração. A configuração de servidor existente continua necessária; não publique senhas, tokens ou a chave de serviço nos arquivos do repositório ou no PR.
