-- LEGACY: uso exclusivo da versão anterior à migração 20261105_super_admin.sql.
-- Depois dessa migração, a política privada no banco é a autoridade de acesso.
-- Alterar app_metadata por este script não cria/revoga as permissões da versão nova.
-- Use /admin/management com a conta do Caio para criar, suspender e editar admins.
-- Mantido sem alteração de comportamento para referência/bootstrap da versão antiga.

-- Permissão de excluir/restaurar salas no VALORANT Scrims.
-- Execute no SQL Editor do MESMO Supabase usado pelo site.
-- A conta já deve ter app_metadata.scrim_admin = true.
-- Edite o e-mail e escolha 'grant' (liberar) ou 'revoke' (retirar).
-- O proprietário confirmado caio.oliveira2014@hotmail.com não precisa desta flag.
-- Este script não cria conta, não concede admin e não altera partidas.

begin;

select set_config('app.scrim_delete_email', 'organizador@exemplo.invalid', true);
select set_config('app.scrim_delete_action', 'grant', true);

do $access$
declare
  v_email text := lower(trim(current_setting('app.scrim_delete_email', true)));
  v_action text := current_setting('app.scrim_delete_action', true);
  v_count integer;
  v_is_admin boolean;
begin
  if v_email is null or v_email = '' or v_email like '%@exemplo.invalid' then
    raise exception 'Troque organizador@exemplo.invalid pelo e-mail real da conta.';
  end if;
  if v_action is null or v_action not in ('grant', 'revoke') then
    raise exception 'Use grant para liberar ou revoke para retirar a permissão de excluir/restaurar.';
  end if;
  select count(*) into v_count from auth.users where lower(email) = v_email;
  if v_count <> 1 then
    raise exception 'Esperada uma conta com o e-mail informado; encontradas %. Confira Authentication > Users.', v_count;
  end if;
  select coalesce(raw_app_meta_data->'scrim_admin' = 'true'::jsonb, false)
    into v_is_admin from auth.users where lower(email) = v_email;
  if v_action = 'grant' and not v_is_admin then
    raise exception 'Libere primeiro o admin com docs/admin-access.sql. Esta permissão não concede scrim_admin.';
  end if;
end;
$access$;

update auth.users as u
   set raw_app_meta_data = case
         when current_setting('app.scrim_delete_action') = 'grant'
           then coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('scrim_delete_rooms', true)
         else coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'scrim_delete_rooms'
       end,
       updated_at = now()
 where lower(u.email) = lower(trim(current_setting('app.scrim_delete_email')))
returning u.id,
          u.email,
          coalesce(u.raw_app_meta_data->'scrim_admin' = 'true'::jsonb, false) as administrador,
          coalesce(u.raw_app_meta_data->'scrim_delete_rooms' = 'true'::jsonb, false) as scrim_delete_rooms,
          current_setting('app.scrim_delete_action') as acao;

commit;
