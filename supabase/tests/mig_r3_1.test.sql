-- MIG-R3.1 — RPC nominal, auditoria das views, privilégios padrão/inventário, mídia e quarentena.
-- Transação desfeita ao final; identidades e dados fictícios. Executar: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
-- MIG-R3.2: a superfície autorizada mudou de public para api; public não tem mais objeto algum.
set local search_path = extensions, api;

select plan(77);

-- =============================================================================================
-- R. RPC nominal (D3): nenhum papel de cliente executa
-- =============================================================================================

select ok(not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'api.get_current_custodian(uuid)'::regprocedure and a.grantee = 0),
  'R1 get_current_custodian sem EXECUTE para PUBLIC');
select ok(not has_function_privilege('anon', 'api.get_current_custodian(uuid)', 'execute'), 'R2 sem EXECUTE para anon');
select ok(not has_function_privilege('authenticated', 'api.get_current_custodian(uuid)', 'execute'), 'R3 sem EXECUTE para authenticated');
select ok(not has_function_privilege('service_role', 'api.get_current_custodian(uuid)', 'execute'), 'R4 sem EXECUTE para service_role');

-- =============================================================================================
-- D. Privilégios padrão e inventário de acesso (regressão contra objetos inesperados)
-- =============================================================================================

select is_empty($$
  select d.defaclobjtype from pg_default_acl d, aclexplode(d.defaclacl) a
  where d.defaclrole = 'postgres'::regrole
    and d.defaclnamespace in (0, 'public'::regnamespace, 'api'::regnamespace, 'private'::regnamespace, 'authz'::regnamespace)
    and a.grantee in (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid) $$,
  'D1 privilégios padrão de postgres (global, public, api, private, authz) sem PUBLIC/anon/authenticated');

create table public.probe_table (id int);
create view public.probe_view as select 1 as x;
create sequence public.probe_seq;
create function public.probe_fn() returns int language sql as 'select 1';
select table_privs_are('public', 'probe_table', 'anon', array[]::text[], 'D2 tabela nova de postgres: nada para anon');
select table_privs_are('public', 'probe_table', 'authenticated', array[]::text[], 'D3 tabela nova de postgres: nada para authenticated');
select table_privs_are('public', 'probe_view', 'anon', array[]::text[], 'D4 view nova de postgres: nada para anon');
select table_privs_are('public', 'probe_view', 'authenticated', array[]::text[], 'D5 view nova de postgres: nada para authenticated');
select sequence_privs_are('public', 'probe_seq', 'anon', array[]::text[], 'D6 sequência nova de postgres: nada para anon');
select sequence_privs_are('public', 'probe_seq', 'authenticated', array[]::text[], 'D7 sequência nova de postgres: nada para authenticated');
select function_privs_are('public', 'probe_fn', array[]::text[], 'anon', array[]::text[], 'D8 função nova de postgres: nada para anon');
select function_privs_are('public', 'probe_fn', array[]::text[], 'authenticated', array[]::text[], 'D9 função nova de postgres: nada para authenticated');
select ok(not exists (select 1 from aclexplode((select coalesce(proacl, acldefault('f', proowner)) from pg_proc where oid = 'public.probe_fn()'::regprocedure)) a where a.grantee = 0),
  'D10 função nova de postgres: nada para PUBLIC');
drop function public.probe_fn();
drop sequence public.probe_seq;
drop view public.probe_view;
drop table public.probe_table;

select is_empty($$
  select r, s from unnest(array['anon', 'authenticated', 'service_role', 'authenticator']) r,
                   unnest(array['public', 'api', 'private', 'authz']) s
  where has_schema_privilege(r, s, 'CREATE') $$,
  'D11 papéis de aplicação sem CREATE em public, api, private e authz');

-- Inventário exato: qualquer objeto novo acessível a PUBLIC/anon/authenticated nos esquemas do
-- projeto faz estes testes falharem — inclusive objetos criados por supabase_admin, cujos
-- privilégios padrão continuam sem correção possível a partir das migrações. Desde o MIG-R3.2 a
-- detecção deixou de ser a única linha de defesa: a barreira preventiva (public sem USAGE para os
-- papéis da Data API) está em supabase/tests/mig_r3_2.test.sql. Ver docs/mig-r3-2-barreira.md.
select set_eq($$
  select n.nspname::text, c.relname::text, case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace,
       aclexplode(coalesce(c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
  where n.nspname in ('public', 'api', 'private', 'authz')
    and a.grantee in (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid) $$,
  $$ values ('api', 'tool_operational', 'authenticated', 'SELECT'),
            ('api', 'tool_movement_log', 'authenticated', 'SELECT'),
            ('api', 'tool_image', 'authenticated', 'SELECT') $$,
  'D12 inventário de relações: somente as três projeções, somente SELECT, somente authenticated');

select set_eq($$
  select n.nspname::text, c.relname::text, att.attname::text, a.grantee::regrole::text, a.privilege_type::text
  from pg_attribute att join pg_class c on c.oid = att.attrelid join pg_namespace n on n.oid = c.relnamespace,
       aclexplode(att.attacl) a
  where n.nspname in ('public', 'api', 'private', 'authz') and att.attacl is not null
    and a.grantee in (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid) $$,
  $$ select 'api' as s, 'tool' as t, col, 'authenticated' as r, 'SELECT' as p
     from unnest(array['id', 'code', 'name', 'category', 'condition', 'next_maintenance', 'is_complete', 'created_at']) col $$,
  'D13 inventário de colunas: somente as 8 colunas operacionais de api.tool para authenticated');

select set_eq($$
  select n.nspname::text, p.proname::text, case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
       aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname in ('public', 'api', 'private', 'authz')
    and a.grantee in (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid) and a.privilege_type = 'EXECUTE' $$,
  $$ values ('authz', 'current_access_level', 'authenticated') $$,
  'D14 inventário de funções: somente authz.current_access_level para authenticated (sem RPC exposta)');

select set_eq($$
  select r, s from unnest(array['anon', 'authenticated']) r, unnest(array['public', 'api', 'private', 'authz']) s
  where has_schema_privilege(r, s, 'USAGE') $$,
  $$ values ('anon', 'api'), ('authenticated', 'api'), ('authenticated', 'authz') $$,
  'D15 inventário de USAGE: public e private inacessíveis; api para ambos; authz só para authenticated');

select set_eq($$
  select p.proname::text from pg_proc p where p.pronamespace = 'graphql_public'::regnamespace
  union all
  select c.relname::text from pg_class c where c.relnamespace = 'graphql_public'::regnamespace $$,
  $$ values ('graphql') $$,
  'D16 graphql_public (exposto pela API) contém apenas a função de plataforma graphql()');

-- =============================================================================================
-- V. Views operacionais
-- =============================================================================================

select set_eq($$ select relname::text from pg_class where relnamespace = 'api'::regnamespace and relkind in ('v', 'm') $$,
  array['tool_operational', 'tool_movement_log', 'tool_image'],
  'V1 api contém exatamente as três views operacionais auditadas');
select is_empty($$
  select relname from pg_class where relnamespace = 'api'::regnamespace and relkind = 'v'
    and not coalesce('security_barrier=true' = any (reloptions), false) $$,
  'V2 todas as views de api têm security_barrier');
select is_empty($$
  select relname from pg_class where relnamespace = 'api'::regnamespace and relkind = 'v'
    and relowner <> 'postgres'::regrole $$,
  'V3 todas as views de api pertencem a postgres');
select is_empty($$
  select relname from pg_class where relnamespace = 'api'::regnamespace and relkind = 'v'
    and pg_get_viewdef(oid) not like '%authz.current_access_level()%' $$,
  'V4 toda view de api contém o filtro de operador ativo');
select columns_are('api', 'tool_image', array['tool_id', 'storage_path'], 'V5 tool_image só expõe ferramenta e caminho');

alter table api.tool add column probe_secret text;
alter table private.movement add column probe_secret text;
alter table private.tool_media add column probe_secret text;
alter table private.custody add column probe_secret text;
select columns_are('api', 'tool_operational',
  array['id', 'code', 'name', 'category', 'condition', 'next_maintenance', 'is_complete', 'status'],
  'V6 coluna nova em api.tool/custody não aparece em tool_operational');
select columns_are('api', 'tool_movement_log', array['id', 'tool_id', 'kind', 'occurred_at'],
  'V7 coluna nova em private.movement não aparece em tool_movement_log');
select columns_are('api', 'tool_image', array['tool_id', 'storage_path'],
  'V8 coluna nova em private.tool_media não aparece em tool_image');

-- =============================================================================================
-- Fixtures fictícias
-- =============================================================================================

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'admin@example.test'),
  ('a0000000-0000-4000-8000-000000000002', 'padrao@example.test'),
  ('a0000000-0000-4000-8000-000000000003', 'restrito@example.test'),
  ('a0000000-0000-4000-8000-000000000004', 'inativo@example.test'),
  ('a0000000-0000-4000-8000-000000000005', 'semperfil@example.test');
insert into private.app_user (id, name, access_level, status) values
  ('a0000000-0000-4000-8000-000000000001', 'Operador Admin Ficticio', 'admin', 'active'),
  ('a0000000-0000-4000-8000-000000000002', 'Operador Padrao Ficticio', 'standard', 'active'),
  ('a0000000-0000-4000-8000-000000000003', 'Operador Restrito Ficticio', 'restricted', 'active'),
  ('a0000000-0000-4000-8000-000000000004', 'Operador Inativo Ficticio', 'standard', 'inactive');
insert into private.collaborator (id, name, job_title) values
  ('c0000000-0000-4000-8000-000000000001', 'Colaborador Ficticio A', 'Tecnico Ficticio');
insert into api.tool (id, code, name, is_complete, probe_secret) values
  ('b0000000-0000-4000-8000-000000000001', 'FIC-001', 'Furadeira Ficticia', true, 'segredo-probe'),
  ('b0000000-0000-4000-8000-000000000002', 'FIC-002', 'Serra Ficticia', true, 'segredo-probe'),
  ('b0000000-0000-4000-8000-000000000003', 'FIC-003', 'Esmerilhadeira Ficticia', true, 'segredo-probe');
insert into private.custody (id, tool_id, collaborator_id, opened_by) values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into private.movement (tool_id, custody_id, kind, actor_user_id, device, ip) values
  ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'out',
   'a0000000-0000-4000-8000-000000000002', 'dispositivo-ficticio', '192.0.2.10');
insert into private.tool_media (tool_id, kind, storage_path, verified_at, verified_by) values
  ('b0000000-0000-4000-8000-000000000001', 'image', 'tools/fic-001/verificada.webp', now(), 'a0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'image', 'tools/fic-002/nao-verificada.webp', null, null),
  ('b0000000-0000-4000-8000-000000000001', 'manual', 'manuals/fic-001/manual-verificado.pdf', now(), 'a0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'manual', 'manuals/fic-002/manual.pdf', null, null);

-- =============================================================================================
-- M. Integridade de mídia (D9)
-- =============================================================================================

select throws_ok($$ insert into private.tool_media (tool_id, kind, storage_path)
  values ('b0000000-0000-4000-8000-000000000003', 'image', 'data:image/png;base64,AAAA') $$,
  '23514', null, 'M1 data URI (base64 legado) recusado');
select throws_ok($$ insert into private.tool_media (tool_id, kind, storage_path)
  values ('b0000000-0000-4000-8000-000000000003', 'image', 'https://exemplo.invalid/a.png') $$,
  '23514', null, 'M2 URL externa recusada (só chave de armazenamento)');
select throws_ok($$ insert into private.tool_media (tool_id, kind, storage_path)
  values ('b0000000-0000-4000-8000-000000000003', 'image', '  ') $$,
  '23514', null, 'M3 caminho vazio recusado');
select throws_ok($$ insert into private.tool_media (tool_id, kind, storage_path, verified_at)
  values ('b0000000-0000-4000-8000-000000000003', 'image', 'tools/x.webp', now()) $$,
  '23514', null, 'M4 verificação sem verificador recusada');
select throws_ok($$ insert into private.tool_media (tool_id, kind, storage_path, verified_at, verified_by)
  values ('b0000000-0000-4000-8000-000000000001', 'image', 'tools/fic-001/outra.webp', now(), 'a0000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'M5 segunda imagem verificada vigente para a mesma ferramenta recusada');
select lives_ok($$ insert into private.tool_media (tool_id, kind, storage_path)
  values ('b0000000-0000-4000-8000-000000000001', 'image', 'tools/fic-001/candidata.webp') $$,
  'M6 nova imagem não verificada aceita (fica fora da projeção)');

-- =============================================================================================
-- Q. Quarentena (D10)
-- =============================================================================================

select columns_are('private', 'migration_quarantine',
  array['id', 'source_collection', 'source_id', 'reason', 'missing_fields', 'detected_at', 'resolved_at', 'resolved_by', 'resolution'],
  'Q1 quarentena sem coluna de conteúdo do documento de origem');
select lives_ok($$ insert into private.migration_quarantine (source_collection, source_id, reason, missing_fields)
  values ('tools', 'FIC-Q01', 'missing_required_field', array['name']) $$, 'Q2 registro incompleto entra em quarentena');
select throws_ok($$ insert into private.migration_quarantine (source_collection, source_id, reason)
  values ('tools', 'FIC-Q01', 'missing_required_field') $$, '23505', null, 'Q3 quarentena aberta não se duplica');
select throws_ok($$ insert into private.migration_quarantine (source_collection, source_id, reason)
  values ('outra', 'x', 'invalid_status') $$, '23514', null, 'Q4 coleção de origem desconhecida recusada');
select throws_ok($$ update private.migration_quarantine set resolved_at = now() where source_id = 'FIC-Q01' $$,
  '23514', null, 'Q5 resolução sem responsável e descrição recusada');
select throws_ok($$ insert into api.tool (code, name) values ('FIC-Q01', 'Ferramenta Q') $$,
  '23514', 'registro em quarentena aberta (D10): tools/FIC-Q01', 'Q6 ferramenta em quarentena aberta não entra em api.tool');

set local role service_role;
select throws_ok($$ insert into api.tool (code, name) values ('FIC-Q01', 'Ferramenta Q') $$,
  '23514', 'registro em quarentena aberta (D10): tools/FIC-Q01', 'Q7 bloqueio vale também para o servidor (service_role)');
select lives_ok($$ insert into api.tool (code, name) values ('FIC-OK1', 'Ferramenta OK') $$,
  'Q8 service_role insere ferramenta regular (guard não exige acesso a private)');
reset role;

select lives_ok($$ update private.migration_quarantine
  set resolved_at = now(), resolved_by = 'a0000000-0000-4000-8000-000000000001', resolution = 'nome regularizado (ficticio)'
  where source_id = 'FIC-Q01' $$, 'Q9 quarentena resolvida com responsável e descrição');
select lives_ok($$ insert into api.tool (code, name) values ('FIC-Q01', 'Ferramenta Q') $$,
  'Q10 após a resolução o registro pode entrar');
insert into private.migration_quarantine (source_collection, source_id, reason) values
  ('collaborators', 'legacy-colab-9', 'homonym_without_discriminator'),
  ('users', 'legacy-uid-9', 'duplicate_identity');
select throws_ok($$ insert into private.collaborator (name, legacy_doc_id) values ('Colaborador Q', 'legacy-colab-9') $$,
  '23514', null, 'Q11 colaborador em quarentena aberta não entra');
select throws_ok($$ update private.app_user set legacy_firebase_uid = 'legacy-uid-9' where id = 'a0000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'Q12 operador em quarentena aberta não recebe o vínculo legado');

-- =============================================================================================
-- P. Perfis efetivos × projeções e novas tabelas protegidas
-- (ferramentas visíveis: FIC-001..003, FIC-OK1, FIC-Q01 = 5)
-- =============================================================================================

-- Não autenticado
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_like('select * from api.tool_operational', '%permission denied for view tool_operational%', 'P1 anon: tool_operational sem GRANT');
select throws_like('select * from api.tool_movement_log', '%permission denied for view tool_movement_log%', 'P2 anon: tool_movement_log sem GRANT');
select throws_like('select * from api.tool_image', '%permission denied for view tool_image%', 'P3 anon: tool_image sem GRANT');
select throws_like('select * from private.tool_media', '%permission denied for schema private%', 'P4 anon: tool_media negada no esquema');
select throws_like('select * from private.migration_quarantine', '%permission denied for schema private%', 'P5 anon: quarentena negada no esquema');

-- Papel authenticated sem sujeito (sessão sem usuário)
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select is((select count(*)::int from api.tool_operational), 0, 'P6 authenticated sem sujeito: tool_operational vazia');
select is((select count(*)::int from api.tool_movement_log), 0, 'P7 authenticated sem sujeito: tool_movement_log vazia');
select is((select count(*)::int from api.tool_image), 0, 'P8 authenticated sem sujeito: tool_image vazia');

-- Autenticado sem perfil
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from api.tool_operational), 0, 'P9 sem perfil: tool_operational vazia');
select is((select count(*)::int from api.tool_movement_log), 0, 'P10 sem perfil: tool_movement_log vazia');
select is((select count(*)::int from api.tool_image), 0, 'P11 sem perfil: tool_image vazia');

-- USUÁRIO INATIVO
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from api.tool_operational), 0, 'P12 usuário inativo: tool_operational vazia');
select is((select count(*)::int from api.tool_movement_log), 0, 'P13 usuário inativo: tool_movement_log vazia');
select is((select count(*)::int from api.tool_image), 0, 'P14 usuário inativo: tool_image vazia');

-- Restrito
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from api.tool_operational), 5, 'P15 restrito: tool_operational com todas as ferramentas');
select is((select count(*)::int from api.tool_movement_log), 1, 'P16 restrito: histórico sanitizado');
select results_eq('select tool_id, storage_path from api.tool_image',
  $$ values ('b0000000-0000-4000-8000-000000000001'::uuid, 'tools/fic-001/verificada.webp'::text) $$,
  'P17 restrito: somente a imagem verificada (nem não verificada, nem manual)');
select throws_like('select probe_secret from api.tool', '%permission denied for table tool%',
  'P18 restrito: coluna nova de api.tool não é legível sem GRANT explícito');
select is((select count(*)::int from (select id, code, name from api.tool) t), 5, 'P19 restrito: colunas operacionais legíveis');
select throws_like('select * from private.tool_media', '%permission denied for schema private%', 'P20 restrito: tool_media negada');
select throws_like('select * from private.migration_quarantine', '%permission denied for schema private%', 'P21 restrito: quarentena negada');

-- Padrão
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from api.tool_operational), 5, 'P22 padrão: tool_operational');
select is((select count(*)::int from api.tool_movement_log), 1, 'P23 padrão: histórico sanitizado');
select is((select count(*)::int from api.tool_image), 1, 'P24 padrão: somente imagem verificada');
select throws_like('select * from private.tool_media', '%permission denied for schema private%', 'P25 padrão: tool_media negada');
select throws_like('select * from private.migration_quarantine', '%permission denied for schema private%', 'P26 padrão: quarentena negada');

-- Administrador
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from api.tool_operational), 5, 'P27 admin: tool_operational');
select is((select count(*)::int from api.tool_image where storage_path like 'manuals/%'), 0,
  'P28 admin: nenhum manual na projeção operacional');
select is((select count(*)::int from api.tool_image), 1, 'P29 admin: somente imagem verificada');
select throws_like('select * from private.tool_media', '%permission denied for schema private%', 'P30 admin: tool_media negada diretamente');
select throws_like('select * from private.migration_quarantine', '%permission denied for schema private%', 'P31 admin: quarentena negada diretamente');
reset role;

select * from finish();
rollback;
