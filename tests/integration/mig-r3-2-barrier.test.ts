// MIG-R3.2 — Prova, com objeto REALMENTE criado por supabase_admin, que a ACL padrão do Supabase
// continua concedendo acesso a anon/authenticated e que, mesmo assim, não existe caminho de acesso.
//
// Por que este arquivo existe além do pgTAP: uma sessão pgTAP roda como postgres, que não é membro
// de supabase_admin e não pode criar objeto em nome dele. Aqui a criação é feita conectando ao
// Postgres local como supabase_admin pelo socket do container — sem alterar senha, atributos,
// associações ou privilégios de nenhum papel interno, e sem SECURITY DEFINER.
//
// Executar: npm run test:integration (Supabase local ativo). Nenhum dado real é usado; todos os
// objetos de teste são removidos no final, inclusive se uma asserção falhar.
import { localSupabaseEnvironment } from './support/env.ts';

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

const API = localSupabaseEnvironment.url;
const ANON_KEY = required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const SERVICE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
const DB_CONTAINER = 'supabase_db_gestao-de-ferramentas-next';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente em .env.local`);
  return value;
}

// `role` distingue as duas identidades usadas: postgres (dono da aplicação) e supabase_admin
// (papel interno que traz a ACL padrão problemática). Somente leitura/DDL de teste.
function psql(query: string, role: 'postgres' | 'supabase_admin') {
  // `-d postgres` é obrigatório: sem ele o psql usa o nome do papel como nome do banco.
  const r = spawnSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', role, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAq'], {
    input: query,
    encoding: 'utf8',
  });
  return { ok: r.status === 0, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

function sql(query: string, role: 'postgres' | 'supabase_admin' = 'postgres'): string {
  const r = psql(query, role);
  if (!r.ok) throw new Error(`psql (${role}) falhou: ${r.stderr}`);
  return r.stdout;
}

/** Executa como um papel da Data API e devolve o erro em vez de lançá-lo. */
function attemptAs(role: string, query: string): { ok: boolean; error: string } {
  const r = psql(`set role ${role};\n${query}`, 'postgres');
  return { ok: r.ok, error: r.stderr };
}

type Reply = { status: number; body: unknown };

async function call(path: string, token: string | null, init: RequestInit = {}): Promise<Reply> {
  const headers = new Headers(init.headers);
  headers.set('apikey', token === SERVICE_KEY ? SERVICE_KEY : ANON_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const run = randomUUID().slice(0, 8);
const password = randomBytes(18).toString('base64url');
// Nomes inequívocos: qualquer resíduo destes objetos é identificável como lixo de teste.
const LEAK_TABLE = `gate_r32_admin_leak_${run}`;
const LEAK_IN_API = `gate_r32_admin_api_${run}`;
const SECRET = `segredo-supabase-admin-${run}`;
const email = `mig-r32-${run}@example.test`;
let userId = '';
let token = '';

before(async () => {
  // Objeto criado POR supabase_admin em public, sem RLS e sem nenhum GRANT explícito: tudo o que
  // ele receber vem da ACL padrão do Supabase.
  sql(
    `create table public.${LEAK_TABLE} (id int primary key, secret text);
     insert into public.${LEAK_TABLE} values (1, '${SECRET}');
     create table api.${LEAK_IN_API} (id int primary key, secret text);
     insert into api.${LEAK_IN_API} values (1, '${SECRET}');`,
    'supabase_admin',
  );

  const created = await call('/auth/v1/admin/users', SERVICE_KEY, {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  assert.equal(created.status, 200, `criação de usuário fictício: ${JSON.stringify(created.body)}`);
  userId = (created.body as { id: string }).id;
  sql(`insert into private.app_user (id, name, access_level, status)
       values ('${userId}', 'Operador R32 ${run}', 'standard', 'active');`);

  const session = await call('/auth/v1/token?grant_type=password', null, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  assert.equal(session.status, 200, 'login fictício');
  token = (session.body as { access_token: string }).access_token;
});

after(async () => {
  sql(`drop table if exists public.${LEAK_TABLE}; drop table if exists api.${LEAK_IN_API};`, 'supabase_admin');
  sql(`delete from private.app_user where id = '${userId}';`);
  if (userId) await call(`/auth/v1/admin/users/${userId}`, SERVICE_KEY, { method: 'DELETE' });
});

const errorCode = (r: Reply) => (r.body as { code?: string }).code;

// ---- A exposição existe de fato (senão os testes seguintes provariam o trivial) ----

test('ACL padrão de supabase_admin realmente concede ALL a anon e authenticated no objeto novo', () => {
  const acl = sql(`select relacl::text from pg_class where oid = 'public.${LEAK_TABLE}'::regclass;`);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.ok(acl.includes(`${role}=arwdDxtm`), `esperado GRANT ALL automático para ${role}; ACL=${acl}`);
  }
  const privs = sql(`select
      has_table_privilege('anon','public.${LEAK_TABLE}','SELECT'),
      has_table_privilege('authenticated','public.${LEAK_TABLE}','SELECT'),
      has_table_privilege('authenticated','public.${LEAK_TABLE}','INSERT');`);
  assert.equal(privs, 't|t|t', 'o GRANT automático inclui leitura e escrita');
  const rls = sql(`select relrowsecurity from pg_class where oid = 'public.${LEAK_TABLE}'::regclass;`);
  assert.equal(rls, 'f', 'o objeto novo nasce sem RLS: nada além do esquema o protege');
});

// ---- SQL: a barreira do esquema nega antes do GRANT ser considerado ----

test('SQL: nenhum papel da Data API alcança o objeto de supabase_admin (negação de esquema)', () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const read = attemptAs(role, `select secret from public.${LEAK_TABLE};`);
    assert.equal(read.ok, false, `${role} não deveria ler o objeto auto-exposto`);
    assert.match(read.error, /permission denied for schema public/, `${role}: a negação deve ser de esquema`);
    assert.ok(!read.error.includes(SECRET), `${role}: o segredo não aparece nem na mensagem de erro`);

    // Escrita: o GRANT automático inclui INSERT; o esquema barra antes disso.
    const write = attemptAs(role, `insert into public.${LEAK_TABLE} values (99, 'x');`);
    assert.equal(write.ok, false, `${role} não deveria escrever no objeto auto-exposto`);
    assert.match(write.error, /permission denied for schema public/, `${role}: escrita barrada no esquema`);
  }
});

test('SQL: a negação é de esquema e vale para todos os papéis da Data API', () => {
  const denied = sql(`select string_agg(r || '=' || coalesce(res,'?'), ' ') from (
      select r, case when has_schema_privilege(r, 'public', 'USAGE') then 'USAGE' else 'SEM_USAGE' end as res
      from unnest(array['anon','authenticated','service_role']) r) t;`);
  assert.equal(denied, 'anon=SEM_USAGE authenticated=SEM_USAGE service_role=SEM_USAGE');
});

// ---- HTTP: nem roteado, nem alcançável ----

test('HTTP: o objeto de supabase_admin em public não é roteado pela Data API (PGRST205)', async () => {
  for (const t of [null, token, SERVICE_KEY]) {
    const r = await call(`/rest/v1/${LEAK_TABLE}`, t);
    assert.equal(r.status, 404, `${LEAK_TABLE} como ${t === null ? 'anon' : t === SERVICE_KEY ? 'service_role' : 'authenticated'}`);
    assert.equal(errorCode(r), 'PGRST205');
    assert.ok(!JSON.stringify(r.body).includes(SECRET), 'nenhuma resposta contém o segredo');
  }
});

test('HTTP: o esquema public não é mais selecionável por Accept-Profile (PGRST106)', async () => {
  for (const t of [null, token, SERVICE_KEY]) {
    const r = await call(`/rest/v1/${LEAK_TABLE}`, t, { headers: { 'Accept-Profile': 'public' } });
    assert.equal(r.status, 406);
    assert.equal(errorCode(r), 'PGRST106');
    assert.ok(!JSON.stringify(r.body).includes(SECRET));
  }
});

// ---- O esquema exposto também nasce fechado ----

test('objeto criado por supabase_admin dentro de api não recebe GRANT automático', async () => {
  const acl = sql(`select coalesce(relacl::text, '(sem ACL: apenas o dono)') from pg_class where oid = 'api.${LEAK_IN_API}'::regclass;`);
  for (const role of ['anon', 'authenticated']) {
    assert.ok(!acl.includes(`${role}=`), `api não deve ter ACL padrão para ${role}; ACL=${acl}`);
  }
  const privs = sql(`select
      has_table_privilege('anon','api.${LEAK_IN_API}','SELECT'),
      has_table_privilege('authenticated','api.${LEAK_IN_API}','SELECT');`);
  assert.equal(privs, 'f|f', 'sem pg_default_acl em api, objeto novo nasce sem privilégio');

  // Roteado (api é o esquema exposto), porém negado por ausência de GRANT — 42501, não 404.
  // 401 x 403 não é detalhe: sem JWT o PostgREST responde 401 (não autenticado); com JWT válido
  // mas sem privilégio, 403 (autenticado e não autorizado). O código SQL é 42501 nos dois casos.
  for (const [label, t, expected] of [['anon', null, 401], ['authenticated', token, 403]] as const) {
    const r = await call(`/rest/v1/${LEAK_IN_API}`, t);
    assert.equal(r.status, expected, `${label}: negado por privilégio`);
    assert.equal(errorCode(r), '42501', label);
    assert.ok(!JSON.stringify(r.body).includes(SECRET), label);
  }
});

// ---- O caminho autorizado continua funcionando ----

test('a barreira não quebrou o contrato operacional do perfil autenticado', async () => {
  const op = await call('/rest/v1/tool_operational?limit=1', token);
  assert.equal(op.status, 200, `tool_operational deve seguir legível: ${JSON.stringify(op.body)}`);
  const tool = await call('/rest/v1/tool?limit=1', token);
  assert.equal(tool.status, 200, 'api.tool deve seguir legível pelo operador ativo');
});
