-- MIG-R3 (2/2) — Controle de acesso: GRANTs, RLS, funções de autorização e projeções.
--
-- Camadas (cada uma testada isoladamente em supabase/tests e tests/integration):
--   1. Esquema: private sem USAGE para anon/authenticated/service_role e fora da API REST.
--   2. GRANT:   nenhuma tabela protegida tem GRANT; public.tool só SELECT para authenticated.
--   3. RLS:     habilitada em TODAS as tabelas; nas protegidas não há política (nega tudo mesmo
--               que um GRANT seja concedido por engano no futuro).
--   4. Perfil:  authz.current_access_level() — operador ativo; inativo/sem perfil = NULL.
--   5. Projeção: views/funções expõem somente colunas operacionais ou o mínimo autorizado.
--
-- RLS filtra linhas, não colunas: a proteção de campos vem da separação de tabelas (K13) e das
-- projeções, nunca de RLS sozinha. service_role e postgres têm BYPASSRLS — por isso os testes de
-- RLS usam os papéis efetivos anon/authenticated com sessões fictícias.

-- ---------------------------------------------------------------------------------------------
-- 1. Esquemas
-- ---------------------------------------------------------------------------------------------

revoke all on schema private from public, anon, authenticated, service_role;
revoke all on schema authz from public, anon, authenticated, service_role;
grant usage on schema authz to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2 e 3. GRANTs e RLS das tabelas
-- ---------------------------------------------------------------------------------------------

revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all sequences in schema private from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;

alter table private.app_user enable row level security;
alter table private.collaborator enable row level security;
alter table private.collaborator_badge enable row level security;
alter table private.tool_admin_note enable row level security;
alter table private.custody enable row level security;
alter table private.maintenance_record enable row level security;
alter table private.movement enable row level security;
alter table private.badge_attempt enable row level security;
alter table private.operator_tool_throttle enable row level security;
alter table private.operator_global_throttle enable row level security;
alter table private.security_event enable row level security;
-- (sem políticas em private: negação total para qualquer papel sujeito a RLS)

revoke all on public.tool from public, anon, authenticated, service_role;
grant select on public.tool to authenticated;
-- Escrita somente pelo servidor. Leitura com service_role ignora RLS: o servidor deve verificar
-- autorização explicitamente antes de usá-la (MIG-R4+).
grant select, insert, update, delete on public.tool to service_role;
alter table public.tool enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 4. Autorização por perfil
-- ---------------------------------------------------------------------------------------------

-- Perfil do operador autenticado, somente se ATIVO. NULL para usuário inativo, sem perfil ou
-- não autenticado. SECURITY DEFINER para ler private.app_user sem conceder acesso à tabela.
create function authz.current_access_level() returns text
language sql stable security definer set search_path = '' as $$
  select u.access_level::text
  from private.app_user u
  where u.id = auth.uid() and u.status = 'active'
$$;

revoke all on function authz.current_access_level() from public, anon, authenticated, service_role;
grant execute on function authz.current_access_level() to authenticated;

create policy tool_select_active_operator on public.tool
  for select to authenticated
  using ((select authz.current_access_level()) is not null);

-- ---------------------------------------------------------------------------------------------
-- 5. Projeções operacionais (sem dado pessoal)
--
-- Views executam com o privilégio do dono (postgres, BYPASSRLS) para ler as tabelas protegidas
-- sem que authenticated precise de GRANT nelas; por isso cada view repete o filtro de operador
-- ativo e usa security_barrier. A lista de colunas é explícita: coluna nova em tabela protegida
-- nunca aparece aqui por acidente.
-- ---------------------------------------------------------------------------------------------

create view public.tool_operational with (security_barrier = true) as
select
  t.id,
  t.code,
  t.name,
  t.category,
  t.condition,
  t.next_maintenance,
  t.is_complete,
  case
    when exists (select 1 from private.custody c where c.tool_id = t.id and c.closed_at is null) then 'borrowed'
    when exists (select 1 from private.maintenance_record m where m.tool_id = t.id and m.ended_at is null) then 'maintenance'
    else 'available'
  end as status
from public.tool t
where (select authz.current_access_level()) is not null;

-- Histórico operacional sanitizado: sem operador, dispositivo, IP, custódia ou colaborador.
create view public.tool_movement_log with (security_barrier = true) as
select m.id, m.tool_id, m.kind::text as kind, m.occurred_at
from private.movement m
where (select authz.current_access_level()) is not null;

revoke all on public.tool_operational, public.tool_movement_log from public, anon, authenticated, service_role;
grant select on public.tool_operational, public.tool_movement_log to authenticated;

-- Nome e função do responsável ATUAL de uma ferramenta (K8/D3): somente Administrador e Padrão.
-- Restrito, inativo e sem perfil recebem 42501. Nunca devolve crachá, telefone, id do colaborador
-- nem dados brutos de custódia; uma ferramenta por chamada, sem listagem.
create function public.get_current_custodian(p_tool_id uuid)
returns table (custodian_name text, custodian_job_title text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(authz.current_access_level(), '') not in ('admin', 'standard') then
    raise exception 'não autorizado' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c.name, c.job_title
    from private.custody cu
    join private.collaborator c on c.id = cu.collaborator_id
    where cu.tool_id = p_tool_id and cu.closed_at is null;
end;
$$;

revoke all on function public.get_current_custodian(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_current_custodian(uuid) to authenticated;
