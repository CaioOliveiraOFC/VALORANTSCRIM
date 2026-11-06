-- LEGACY: uso exclusivo da versão anterior à migração 20261105_super_admin.sql.
-- Depois dessa migração, a política privada no banco é a autoridade de acesso.
-- Alterar app_metadata por este script não cria/revoga as permissões da versão nova.
-- Use /admin/management com a conta do Caio para criar, suspender e editar admins.
-- Mantido sem alteração de comportamento para referência/bootstrap da versão antiga.

-- Acesso administrativo do VALORANT Scrims.
-- Execute no SQL Editor do MESMO projeto Supabase usado pelo site.
-- Primeiro crie o usuário em Authentication > Users.
-- Edite apenas o e-mail abaixo e escolha 'grant' (liberar) ou 'revoke' (retirar).
-- Este arquivo não cria usuários nem define senhas.

begin;

select set_config('app.scrim_admin_email', 'organizador@exemplo.invalid', true);
select set_config('app.scrim_admin_action', 'grant', true);

do $access$
declare
  v_email text := lower(trim(current_setting('app.scrim_admin_email', true)));
  v_action text := current_setting('app.scrim_admin_action', true);
  v_count integer;
begin
  if v_email is null or v_email = '' or v_email like '%@exemplo.invalid' then
    raise exception 'Troque organizador@exemplo.invalid pelo e-mail real da conta antes de executar.';
  end if;
  if v_action is null or v_action not in ('grant', 'revoke') then
    raise exception 'Use grant para liberar ou revoke para retirar o acesso de admin.';
  end if;
  select count(*) into v_count from auth.users where lower(email) = v_email;
  if v_count <> 1 then
    raise exception 'Esperada uma conta com o e-mail informado; encontradas %. Crie/confira o usuário em Authentication > Users.', v_count;
  end if;
end;
$access$;

update auth.users as u
   set raw_app_meta_data = case
         when current_setting('app.scrim_admin_action') = 'grant'
           then coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('scrim_admin', true)
         else coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'scrim_admin'
       end,
       updated_at = now()
 where lower(u.email) = lower(trim(current_setting('app.scrim_admin_email')))
returning u.id,
          u.email,
          coalesce(u.raw_app_meta_data->'scrim_admin' = 'true'::jsonb, false) as administrador,
          current_setting('app.scrim_admin_action') as acao;

commit;
