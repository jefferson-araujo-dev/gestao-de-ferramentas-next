-- MIG-R3 — testes pgTAP do modelo, GRANTs e RLS. Executar: npm run test:db
-- Tudo roda em uma transação desfeita ao final (rollback): identidades e dados são fictícios e
-- nada persiste. Os blocos "como <perfil>" trocam o papel efetivo para anon/authenticated com
-- claims de JWT fictícias — postgres/service_role têm BYPASSRLS e não servem de prova de RLS.
begin;
create extension if not exists pgtap with schema extensions;
-- MIG-R3.2: a superfície autorizada mudou de public para api; public não tem mais objeto algum.
set local search_path = extensions, api;

select plan(71);

-- =============================================================================================
-- A. Catálogo: esquemas, GRANTs, RLS, funções e privilégios padrão
-- =============================================================================================

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'api', 'private') and c.relkind = 'r' and not c.relrowsecurity),
  0, 'A1 RLS habilitada em todas as tabelas de public, api e private');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace,
     lateral aclexplode(c.relacl) a
   where n.nspname = 'private'
     and a.grantee in (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid, 'service_role'::regrole::oid)),
  0, 'A2 nenhuma tabela/sequência de private tem GRANT para PUBLIC, anon, authenticated ou service_role');

select ok(not has_schema_privilege('anon', 'private', 'usage'), 'A3 anon sem USAGE em private');
select ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'A4 authenticated sem USAGE em private');
select ok(not has_schema_privilege('service_role', 'private', 'usage'), 'A5 service_role sem USAGE em private');
select ok(has_schema_privilege('authenticated', 'authz', 'usage'), 'A6 authenticated com USAGE em authz (só funções)');
select ok(not has_schema_privilege('anon', 'authz', 'usage'), 'A7 anon sem USAGE em authz');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'authz'),
  0, 'A8 authz não contém tabelas, views ou sequências');

select table_privs_are('api', 'tool', 'anon', array[]::text[], 'A9 anon sem privilégio em api.tool');
-- MIG-R3.1: SELECT passou a ser por coluna (ver mig_r3_1.test.sql); em nível de tabela, nada.
select table_privs_are('api', 'tool', 'authenticated', array[]::text[], 'A10 authenticated sem privilégio de tabela em api.tool (só colunas)');
select table_privs_are('api', 'tool_operational', 'anon', array[]::text[], 'A11 anon sem privilégio em tool_operational');
select table_privs_are('api', 'tool_operational', 'authenticated', array['SELECT'], 'A12 authenticated só SELECT em tool_operational');
select table_privs_are('api', 'tool_movement_log', 'anon', array[]::text[], 'A13 anon sem privilégio em tool_movement_log');
select table_privs_are('api', 'tool_movement_log', 'authenticated', array['SELECT'], 'A14 authenticated só SELECT em tool_movement_log');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'api', 'private', 'authz')
     and (has_function_privilege('anon', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where a.grantee = 0))),
  0, 'A15 nenhuma função de public/api/private/authz executável por anon ou PUBLIC');
select ok(not has_function_privilege('authenticated', 'api.get_current_custodian(uuid)', 'execute'),
  'A16 authenticated não executa get_current_custodian (MIG-R3.1, D3)');
select ok(not has_function_privilege('service_role', 'api.get_current_custodian(uuid)', 'execute'),
  'A17 service_role não executa get_current_custodian');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute')),
  0, 'A18 authenticated não executa funções de private');

select is((select count(*)::int from pg_policies where schemaname = 'private'), 0,
  'A19 nenhuma política em private (negação total sob RLS)');

-- Privilégio padrão: tabela nova em public não herda GRANT para anon/authenticated.
create table public.mig_r3_probe (id int);
select table_privs_are('public', 'mig_r3_probe', 'anon', array[]::text[], 'A20 tabela nova em public sem GRANT para anon');
select table_privs_are('public', 'mig_r3_probe', 'authenticated', array[]::text[], 'A21 tabela nova em public sem GRANT para authenticated');
drop table public.mig_r3_probe;

-- Colunas das estruturas acessíveis aos perfis comuns: nenhum dado pessoal.
select columns_are('api', 'tool',
  array['id', 'code', 'name', 'category', 'condition', 'next_maintenance', 'is_complete', 'created_at'],
  'A22 api.tool só tem colunas operacionais');
select columns_are('api', 'tool_operational',
  array['id', 'code', 'name', 'category', 'condition', 'next_maintenance', 'is_complete', 'status'],
  'A23 tool_operational só tem colunas operacionais');
select columns_are('api', 'tool_movement_log', array['id', 'tool_id', 'kind', 'occurred_at'],
  'A24 tool_movement_log sem operador, dispositivo, IP, custódia ou colaborador');
select columns_are('private', 'badge_attempt',
  array['id', 'actor_user_id', 'tool_id', 'operation', 'succeeded', 'occurred_at'],
  'A25 badge_attempt não armazena o crachá informado (K4)');
select col_is_pk('private', 'operator_tool_throttle', array['actor_user_id', 'tool_id'],
  'A26 contador K4 por ferramenta com PK composta real');
select col_is_pk('private', 'operator_global_throttle', 'actor_user_id',
  'A27 contador K4 global com PK = operador');

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
insert into private.collaborator (id, name, job_title, phone) values
  ('c0000000-0000-4000-8000-000000000001', 'Colaborador Ficticio A', 'Tecnico Ficticio', '000'),
  ('c0000000-0000-4000-8000-000000000002', 'Colaborador Ficticio B', 'Auxiliar Ficticio', '000');
insert into api.tool (id, code, name, is_complete) values
  ('b0000000-0000-4000-8000-000000000001', 'FIC-001', 'Furadeira Ficticia', true),
  ('b0000000-0000-4000-8000-000000000002', 'FIC-002', 'Serra Ficticia', true),
  ('b0000000-0000-4000-8000-000000000003', 'FIC-003', 'Esmerilhadeira Incompleta', false),
  ('b0000000-0000-4000-8000-000000000004', 'FIC-004', 'Parafusadeira Ficticia', true);
insert into private.tool_admin_note (tool_id, note, created_by) values
  ('b0000000-0000-4000-8000-000000000001', 'Observacao administrativa ficticia', 'a0000000-0000-4000-8000-000000000001');

-- =============================================================================================
-- B. Integridade
-- =============================================================================================

select lives_ok($$
  insert into private.custody (id, tool_id, collaborator_id, pickup_badge_hmac, pickup_badge_key_version, opened_by)
  values ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
          'c0000000-0000-4000-8000-000000000001', decode(repeat('ab', 32), 'hex'), 1,
          'a0000000-0000-4000-8000-000000000002') $$,
  'B1 abre custódia de ferramenta completa para colaborador ativo');
select throws_ok($$
  insert into private.custody (tool_id, collaborator_id)
  values ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002') $$,
  '23505', null, 'B2 segunda custódia aberta para a mesma ferramenta é recusada');
select throws_ok($$
  insert into private.custody (tool_id, collaborator_id)
  values ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002') $$,
  '23514', 'ferramenta incompleta não recebe empréstimo (D10)', 'B3 ferramenta incompleta não recebe custódia (D10)');
select throws_ok($$
  insert into private.maintenance_record (tool_id, actor_user_id)
  values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001') $$,
  '23514', 'ferramenta emprestada não entra em manutenção', 'B4 ferramenta emprestada não entra em manutenção');
select lives_ok($$
  insert into private.maintenance_record (tool_id, actor_user_id)
  values ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001') $$,
  'B5 ferramenta disponível entra em manutenção');
select throws_ok($$
  insert into private.custody (tool_id, collaborator_id)
  values ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002') $$,
  '23514', 'ferramenta em manutenção não recebe empréstimo', 'B6 ferramenta em manutenção não recebe custódia');

update private.collaborator set status = 'inactive' where id = 'c0000000-0000-4000-8000-000000000002';
select throws_ok($$
  insert into private.custody (tool_id, collaborator_id)
  values ('b0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000002') $$,
  '23514', 'colaborador inativo não recebe novo empréstimo (D5)', 'B7 COLABORADOR INATIVO não recebe novo empréstimo');

select throws_ok($$
  update private.custody set collaborator_id = 'c0000000-0000-4000-8000-000000000002'
  where id = 'd0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'B8 custódia não troca de colaborador por UPDATE');
select throws_ok($$
  update private.custody set close_kind = 'common' where id = 'd0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'B9 close_kind sem closed_at é recusado');
select throws_ok($$
  insert into private.movement (tool_id, kind) values ('b0000000-0000-4000-8000-000000000001', 'out') $$,
  '23514', null, 'B10 movimento de retirada sem custódia é recusado');
select lives_ok($$
  insert into private.movement (tool_id, custody_id, kind, actor_user_id, device, ip)
  values ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'out',
          'a0000000-0000-4000-8000-000000000002', 'dispositivo-ficticio', '192.0.2.10') $$,
  'B11 movimento de retirada ligado à custódia é aceito');

-- Crachá protegido
select lives_ok($$
  insert into private.collaborator_badge (collaborator_id, badge_hmac, key_version)
  values ('c0000000-0000-4000-8000-000000000001', decode(repeat('ab', 32), 'hex'), 1) $$,
  'B12 referência protegida de crachá aceita');
select throws_ok($$
  insert into private.collaborator_badge (collaborator_id, badge_hmac, key_version)
  values ('c0000000-0000-4000-8000-000000000002', decode(repeat('ab', 32), 'hex'), 1) $$,
  '23505', null, 'B13 mesmo crachá ativo para dois colaboradores é recusado');
select throws_ok($$
  insert into private.collaborator_badge (collaborator_id, badge_hmac, key_version)
  values ('c0000000-0000-4000-8000-000000000002', '\x01'::bytea, 1) $$,
  '23514', null, 'B14 referência de crachá curta demais (não-HMAC) é recusada');

-- K4: chaves válidas
insert into private.operator_tool_throttle (actor_user_id, tool_id, window_started_at)
  values ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', now());
insert into private.operator_global_throttle (actor_user_id, window_started_at)
  values ('a0000000-0000-4000-8000-000000000002', now());
select throws_ok($$
  insert into private.operator_tool_throttle (actor_user_id, tool_id, window_started_at)
  values ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', now()) $$,
  '23505', null, 'B15 contador por operador+ferramenta é único');
select throws_ok($$
  insert into private.operator_global_throttle (actor_user_id, window_started_at)
  values ('a0000000-0000-4000-8000-000000000002', now()) $$,
  '23505', null, 'B16 contador global por operador é único');
select throws_ok($$
  insert into private.operator_tool_throttle (actor_user_id, tool_id, window_started_at)
  values ('a0000000-0000-4000-8000-000000000003', null, now()) $$,
  '23502', null, 'B17 contador por ferramenta não aceita ferramenta nula (sem COALESCE na chave)');
select throws_ok($$
  update private.operator_global_throttle set failure_count = -1 $$,
  '23514', null, 'B18 contador não aceita valor negativo');

-- Auditoria somente inserção
select lives_ok($$
  insert into private.security_event (kind, actor_user_id, tool_id)
  values ('badge_attempt_failed', 'a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001') $$,
  'B19 evento de segurança é inserido');
select throws_ok($$ update private.security_event set detail = '{"x":1}' $$, '42501', null,
  'B20 evento de segurança não pode ser alterado');
select throws_ok($$ delete from private.security_event $$, '42501', null,
  'B21 evento de segurança não pode ser excluído');

-- =============================================================================================
-- C. Papéis efetivos com sessões fictícias
-- =============================================================================================

-- Não autenticado (anon): ausência de GRANT
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_like('select * from api.tool', '%permission denied for table tool%',
  'C1 anon: api.tool negado por ausência de GRANT');
select throws_like('select * from api.tool_operational', '%permission denied for view tool_operational%',
  'C2 anon: tool_operational negada por ausência de GRANT');
select throws_like($$ select * from api.get_current_custodian('b0000000-0000-4000-8000-000000000001') $$,
  '%permission denied for function get_current_custodian%',
  'C3 anon: get_current_custodian negada por ausência de EXECUTE');
select throws_like('select * from private.custody', '%permission denied for schema private%',
  'C4 anon: private negado no nível do esquema');

-- Restrito ativo
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from api.tool), 4, 'C5 restrito ativo lê a tabela operacional (política autoriza)');
select is((select status from api.tool_operational where code = 'FIC-001'), 'borrowed',
  'C6 restrito vê status derivado sem saber quem retirou');
select is((select count(*)::int from api.tool_movement_log), 1, 'C7 restrito lê histórico sanitizado');
select throws_like($$ select * from api.get_current_custodian('b0000000-0000-4000-8000-000000000001') $$,
  '%permission denied for function get_current_custodian%', 'C8 restrito: RPC nominal sem EXECUTE (MIG-R3.1)');
select throws_like('select * from private.collaborator', '%permission denied for schema private%',
  'C9 restrito: colaboradores negados no nível do esquema');
select throws_like($$ insert into api.tool (code, name) values ('X', 'X') $$,
  '%permission denied for table tool%', 'C10 authenticated não insere em api.tool (sem GRANT)');
select throws_like($$ update api.tool set name = 'X' $$,
  '%permission denied for table tool%', 'C11 authenticated não altera api.tool (sem GRANT)');
select throws_like($$ delete from api.tool $$,
  '%permission denied for table tool%', 'C12 authenticated não exclui de api.tool (sem GRANT)');

-- Padrão e Administrador: desde o MIG-R3.1 a consulta nominal não é executável pelo cliente;
-- será uma API de backend em Gate posterior (D3).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_like($$ select * from api.get_current_custodian('b0000000-0000-4000-8000-000000000001') $$,
  '%permission denied for function get_current_custodian%', 'C13 padrão: RPC nominal sem EXECUTE (MIG-R3.1, D3)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_like($$ select * from api.get_current_custodian('b0000000-0000-4000-8000-000000000001') $$,
  '%permission denied for function get_current_custodian%', 'C14 administrador: RPC nominal sem EXECUTE (MIG-R3.1)');
select throws_like('select * from private.custody', '%permission denied for schema private%',
  'C15 nem o administrador lê custódia bruta diretamente (K8)');

-- USUÁRIO INATIVO e usuário sem perfil: bloqueio por RLS
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from api.tool), 0, 'C16 usuário inativo: RLS não retorna linhas');
select is((select count(*)::int from api.tool_operational), 0, 'C17 usuário inativo: projeção vazia');
select throws_like($$ select * from api.get_current_custodian('b0000000-0000-4000-8000-000000000001') $$,
  '%permission denied for function get_current_custodian%', 'C18 usuário inativo: RPC nominal sem EXECUTE');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from api.tool), 0, 'C19 autenticado sem perfil: RLS não retorna linhas');

-- Defesa em profundidade: mesmo que USAGE e GRANT fossem concedidos por engano, RLS sem política
-- nega tudo. As concessões abaixo existem só dentro desta transação e são desfeitas no rollback.
reset role;
grant usage on schema private to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_like('select * from private.custody', '%permission denied for table custody%',
  'C20 com USAGE indevido, custódia ainda negada por ausência de GRANT');
reset role;
grant select on private.custody to authenticated;
set local role authenticated;
select is((select count(*)::int from private.custody), 0,
  'C21 com USAGE e GRANT indevidos, RLS sem política autorizadora não retorna linhas');
reset role;

-- D5: COLABORADOR INATIVO pode ter a custódia encerrada (devolução estrutural)
update private.collaborator set status = 'inactive' where id = 'c0000000-0000-4000-8000-000000000001';
select lives_ok($$
  update private.custody set closed_at = now(), closed_by = 'a0000000-0000-4000-8000-000000000002', close_kind = 'common'
  where id = 'd0000000-0000-4000-8000-000000000001' $$,
  'C22 custódia de colaborador inativado após a retirada pode ser encerrada (D5)');
select throws_ok($$
  update private.custody set closed_at = null, closed_by = null, close_kind = null
  where id = 'd0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'C23 custódia encerrada não reabre');

select * from finish();
rollback;
