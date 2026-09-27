-- MIG-R3.2 — Barreira contra os privilégios automáticos do Supabase. Executar: npm run test:db
-- Transação desfeita ao final; nenhum objeto de teste persiste.
--
-- Estes testes separam deliberadamente duas afirmações que NÃO são a mesma coisa:
--   ACL_PADRAO_ELIMINADA      — a entrada de pg_default_acl de supabase_admin deixou de existir.
--   EXPOSICAO_EFETIVA_BLOQUEADA — a ACL continua lá, mas não produz acesso.
-- O bloco S comprova que a primeira é FALSA (e deve seguir falsa: postgres não pode revogá-la) e
-- os blocos B/M comprovam que a segunda é VERDADEIRA.
--
-- Limite de simulação: uma sessão pgTAP roda como postgres, que não é membro de supabase_admin e
-- portanto não pode criar objeto no lugar dele. O bloco B reproduz o RESULTADO da ACL padrão de
-- supabase_admin — GRANT ALL para anon/authenticated em objeto de public — concedendo esse mesmo
-- GRANT explicitamente, que é o caso mais favorável ao atacante. A criação real por
-- supabase_admin é comprovada fora do pgTAP, em tests/integration/mig-r3-2-barrier.test.ts.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, api;

select plan(31);

-- =============================================================================================
-- S. Estado real dos privilégios padrão e do esquema public
-- =============================================================================================

select ok(exists (
    select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
    where d.defaclrole = 'supabase_admin'::regrole and d.defaclnamespace = 'public'::regnamespace
      and d.defaclobjtype = 'r' and a.grantee = 'anon'::regrole::oid),
  'S1 ACL padrão de supabase_admin em public AINDA concede a anon (não é eliminável por postgres)');
select ok(exists (
    select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
    where d.defaclrole = 'supabase_admin'::regrole and d.defaclnamespace = 'public'::regnamespace
      and d.defaclobjtype = 'r' and a.grantee = 'authenticated'::regrole::oid),
  'S2 ACL padrão de supabase_admin em public AINDA concede a authenticated');

select is_empty($$
  select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
  where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid) $$,
  'S3 ACL padrão de postgres em public sem anon/authenticated (MIG-R3 + auto_expose_new_tables=false)');

select is_empty($$
  select 1 from pg_namespace, aclexplode(nspacl) a
  where nspname = 'public' and a.grantee = 0 and a.privilege_type = 'USAGE' $$,
  'S4 public não concede USAGE a PUBLIC (sem esse REVOKE a barreira seria falsa)');
select ok(not has_schema_privilege('anon', 'public', 'usage'), 'S5 anon sem USAGE em public');
select ok(not has_schema_privilege('authenticated', 'public', 'usage'), 'S6 authenticated sem USAGE em public');
select ok(not has_schema_privilege('service_role', 'public', 'usage'), 'S7 service_role sem USAGE em public');

select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace
             and c.relkind in ('r', 'v', 'm', 'S', 'p')),
  0, 'S8 public não contém nenhuma relação da aplicação');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace),
  0, 'S9 public não contém nenhuma função da aplicação');

-- Extensão de teste fora de public (MIG-R3.2 §12): pgTAP mora em extensions.
select is((select n.nspname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace
           where e.extname = 'pgtap'), 'extensions', 'S10 pgTAP instalada em extensions, nunca em public');

-- =============================================================================================
-- B. Objeto de public com GRANT máximo continua inalcançável (a barreira é o USAGE do esquema)
-- =============================================================================================

create table public.gate_r32_leak_tbl (id int, secret text);
insert into public.gate_r32_leak_tbl values (1, 'vazamento-ficticio');
create view public.gate_r32_leak_view as select * from public.gate_r32_leak_tbl;
create sequence public.gate_r32_leak_seq;
create function public.gate_r32_leak_fn() returns text language sql as $$ select 'vazamento-ficticio' $$;

-- Reprodução do efeito da ACL padrão de supabase_admin, no cenário mais permissivo possível.
grant all on public.gate_r32_leak_tbl to anon, authenticated, service_role;
grant all on public.gate_r32_leak_view to anon, authenticated, service_role;
grant all on sequence public.gate_r32_leak_seq to anon, authenticated, service_role;
grant execute on function public.gate_r32_leak_fn() to public, anon, authenticated, service_role;

select ok(has_table_privilege('anon', 'public.gate_r32_leak_tbl', 'select'),
  'B1 fixture é máxima: o GRANT de SELECT para anon existe de fato no objeto');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_like('select * from public.gate_r32_leak_tbl', '%permission denied for schema public%',
  'B2 anon: tabela sem RLS e com GRANT ALL continua negada no nível do esquema');
select throws_like('select * from public.gate_r32_leak_view', '%permission denied for schema public%',
  'B3 anon: view sem filtro e com GRANT ALL continua negada no nível do esquema');
select throws_like('select public.gate_r32_leak_fn()', '%permission denied for schema public%',
  'B4 anon: função com EXECUTE para PUBLIC continua negada no nível do esquema');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_like('select * from public.gate_r32_leak_tbl', '%permission denied for schema public%',
  'B5 authenticated: tabela com GRANT ALL continua negada no nível do esquema');
select throws_like('select * from public.gate_r32_leak_view', '%permission denied for schema public%',
  'B6 authenticated: view com GRANT ALL continua negada no nível do esquema');
select throws_like($$ select nextval('public.gate_r32_leak_seq') $$, '%permission denied for schema public%',
  'B7 authenticated: sequência com GRANT ALL continua negada no nível do esquema');
select throws_like('select public.gate_r32_leak_fn()', '%permission denied for schema public%',
  'B8 authenticated: função com GRANT ALL continua negada no nível do esquema');

set local role service_role;
select throws_like('select * from public.gate_r32_leak_tbl', '%permission denied for schema public%',
  'B9 service_role: mesmo o papel do servidor não alcança objeto novo de public');
reset role;

-- =============================================================================================
-- M. Mutação: removida a barreira, o vazamento reaparece — e volta a ser bloqueado ao restaurá-la
--
-- Se estes dois testes passarem com a migração do MIG-R3.2 ausente, é porque B2..B9 estariam
-- passando por outro motivo. M1 é a prova de que o USAGE do esquema é o que bloqueia.
-- =============================================================================================

grant usage on schema public to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.gate_r32_leak_tbl), 1,
  'M1 com USAGE em public restaurado, o objeto auto-exposto passa a ser legível (barreira é o USAGE)');
reset role;
revoke usage on schema public from authenticated;
set local role authenticated;
select throws_like('select * from public.gate_r32_leak_tbl', '%permission denied for schema public%',
  'M2 revogado o USAGE novamente, o mesmo objeto volta a ser inalcançável');
reset role;

drop function public.gate_r32_leak_fn();
drop sequence public.gate_r32_leak_seq;
drop view public.gate_r32_leak_view;
drop table public.gate_r32_leak_tbl;

-- =============================================================================================
-- A. O esquema api nasce fechado: sem ACL padrão, objeto novo sem privilégio
-- =============================================================================================

select is((select count(*)::int from pg_default_acl d where d.defaclnamespace = 'api'::regnamespace),
  0, 'A1 esquema api não tem nenhuma entrada em pg_default_acl');

create table api.gate_r32_probe_tbl (id int);
create function api.gate_r32_probe_fn() returns int language sql as 'select 1';
select table_privs_are('api', 'gate_r32_probe_tbl', 'anon', array[]::text[],
  'A2 tabela nova em api: nada para anon sem GRANT explícito');
select table_privs_are('api', 'gate_r32_probe_tbl', 'authenticated', array[]::text[],
  'A3 tabela nova em api: nada para authenticated sem GRANT explícito');
select ok(not has_function_privilege('authenticated', 'api.gate_r32_probe_fn()', 'execute'),
  'A4 função nova em api: sem EXECUTE para authenticated');
select ok(not exists (
    select 1 from aclexplode((select coalesce(proacl, acldefault('f', proowner)) from pg_proc
                              where oid = 'api.gate_r32_probe_fn()'::regprocedure)) a where a.grantee = 0),
  'A5 função nova em api: sem EXECUTE para PUBLIC');
drop function api.gate_r32_probe_fn();
drop table api.gate_r32_probe_tbl;

-- =============================================================================================
-- O. O contrato operacional autorizado continua de pé no novo esquema
-- =============================================================================================

insert into auth.users (id, email) values ('e0000000-0000-4000-8000-000000000001', 'operador@example.test');
insert into private.app_user (id, name, access_level, status)
  values ('e0000000-0000-4000-8000-000000000001', 'Operador Ficticio R32', 'standard', 'active');
insert into api.tool (id, code, name, is_complete)
  values ('f0000000-0000-4000-8000-000000000001', 'R32-001', 'Ferramenta Ficticia R32', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from api.tool), 1, 'O1 operador ativo lê api.tool (GRANT por coluna + RLS preservados)');
select is((select status from api.tool_operational where code = 'R32-001'), 'available',
  'O2 operador ativo lê api.tool_operational com o status derivado');
select throws_like('select * from api.get_current_custodian($$f0000000-0000-4000-8000-000000000001$$)',
  '%permission denied for function get_current_custodian%',
  'O3 RPC nominal continua sem EXECUTE para o cliente após a mudança de esquema (D3)');

-- anon alcança o esquema api mas nenhum objeto dele: a negação é por GRANT, não por esquema.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_like('select * from api.tool', '%permission denied for table tool%',
  'O4 anon: negação em api.tool é por ausência de GRANT (42501 de tabela, não de esquema)');

set local role service_role;
select lives_ok($$ insert into api.tool (code, name) values ('R32-002', 'Ferramenta do Servidor') $$,
  'O5 service_role continua escrevendo em api.tool (caminho do backend preservado)');
reset role;

select * from finish();
rollback;
