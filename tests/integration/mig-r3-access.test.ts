// MIG-R3 — GRANTs e RLS comprovados pela API REST local (PostgREST) com sessões reais do Supabase
// Auth local. Todas as identidades e dados são fictícios, criados e removidos por esta execução.
// A service role é usada APENAS para criar/remover as contas fictícias e para demonstrar que ela
// ignora RLS — nunca como prova de RLS. Executar: npm run test:integration (Supabase local ativo).
import { localSupabaseEnvironment } from './support/env.ts';

import {
  assertShape,
  toolImageShape,
  toolMovementLogShape,
  toolOperationalShape,
} from '../../src/contracts/operational.ts';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

const API = localSupabaseEnvironment.url;
const ANON_KEY = required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const SERVICE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
// Container do Postgres local (nome derivado de project_id em supabase/config.toml).
const DB_CONTAINER = 'supabase_db_gestao-de-ferramentas-next';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente em .env.local`);
  return value;
}

function sql(query: string): string {
  const r = spawnSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAq'], {
    input: query,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`psql falhou: ${r.stderr}`);
  return r.stdout.trim();
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
const profiles = ['admin', 'standard', 'restricted', 'inactive', 'noprofile'] as const;
type Profile = (typeof profiles)[number];
const userIds = {} as Record<Profile, string>;
const tokens = {} as Record<Profile, string>;

const toolId = randomUUID();
const toolCode = `IT-${run}`;
const collaboratorId = randomUUID();
const custodyId = randomUUID();
// Valores sentinela: nenhum deles pode aparecer em resposta operacional.
const SECRETS = {
  collaboratorName: `Colaborador Integracao ${run}`,
  jobTitle: `Funcao Integracao ${run}`,
  phone: `55-${run}`,
  badgeHex: randomBytes(32).toString('hex'),
  adminNote: `Nota administrativa ${run}`,
  ip: '198.51.100.77',
  device: `dispositivo-${run}`,
  collaboratorId,
  custodyId,
  unverifiedImage: `tools/${run}/nao-verificada.webp`,
  manualPath: `manuals/${run}/manual.pdf`,
  quarantineId: `legacy-${run}`,
};
const verifiedImage = `tools/${run}/verificada.webp`;

before(async () => {
  for (const p of profiles) {
    const created = await call('/auth/v1/admin/users', SERVICE_KEY, {
      method: 'POST',
      body: JSON.stringify({ email: `mig-r3-${p}-${run}@example.test`, password, email_confirm: true }),
    });
    assert.equal(created.status, 200, `criação de usuário fictício ${p}: ${JSON.stringify(created.body)}`);
    userIds[p] = (created.body as { id: string }).id;
  }

  sql(`
    insert into private.app_user (id, name, access_level, status) values
      ('${userIds.admin}', 'Admin ${run}', 'admin', 'active'),
      ('${userIds.standard}', 'Padrao ${run}', 'standard', 'active'),
      ('${userIds.restricted}', 'Restrito ${run}', 'restricted', 'active'),
      ('${userIds.inactive}', 'Inativo ${run}', 'standard', 'inactive');
    insert into private.collaborator (id, name, job_title, phone)
      values ('${collaboratorId}', '${SECRETS.collaboratorName}', '${SECRETS.jobTitle}', '${SECRETS.phone}');
    insert into private.collaborator_badge (collaborator_id, badge_hmac, key_version)
      values ('${collaboratorId}', '\\x${SECRETS.badgeHex}', 1);
    insert into api.tool (id, code, name, is_complete) values ('${toolId}', '${toolCode}', 'Ferramenta ${run}', true);
    insert into private.tool_admin_note (tool_id, note, created_by)
      values ('${toolId}', '${SECRETS.adminNote}', '${userIds.admin}');
    insert into private.custody (id, tool_id, collaborator_id, pickup_badge_hmac, pickup_badge_key_version, opened_by)
      values ('${custodyId}', '${toolId}', '${collaboratorId}', '\\x${SECRETS.badgeHex}', 1, '${userIds.standard}');
    insert into private.movement (tool_id, custody_id, kind, actor_user_id, device, ip)
      values ('${toolId}', '${custodyId}', 'out', '${userIds.standard}', '${SECRETS.device}', '${SECRETS.ip}');
    insert into private.tool_media (tool_id, kind, storage_path, verified_at, verified_by) values
      ('${toolId}', 'image', '${verifiedImage}', now(), '${userIds.admin}'),
      ('${toolId}', 'image', '${SECRETS.unverifiedImage}', null, null),
      ('${toolId}', 'manual', '${SECRETS.manualPath}', now(), '${userIds.admin}');
    insert into private.migration_quarantine (source_collection, source_id, reason, missing_fields)
      values ('tools', '${SECRETS.quarantineId}', 'missing_required_field', array['name']);
  `);

  for (const p of profiles) {
    const session = await call('/auth/v1/token?grant_type=password', null, {
      method: 'POST',
      body: JSON.stringify({ email: `mig-r3-${p}-${run}@example.test`, password }),
    });
    assert.equal(session.status, 200, `login fictício ${p}`);
    tokens[p] = (session.body as { access_token: string }).access_token;
  }
});

after(async () => {
  sql(`
    delete from private.migration_quarantine where source_id = '${SECRETS.quarantineId}';
    delete from private.tool_media where tool_id = '${toolId}';
    delete from private.movement where tool_id = '${toolId}';
    delete from private.custody where tool_id = '${toolId}';
    delete from private.tool_admin_note where tool_id = '${toolId}';
    delete from private.collaborator_badge where collaborator_id = '${collaboratorId}';
    delete from private.collaborator where id = '${collaboratorId}';
    delete from api.tool where id = '${toolId}';
    delete from private.app_user where id in (${Object.values(userIds).map((id) => `'${id}'`).join(',')});
  `);
  for (const id of Object.values(userIds)) {
    await call(`/auth/v1/admin/users/${id}`, SERVICE_KEY, { method: 'DELETE' });
  }
});

const errorCode = (r: Reply) => (r.body as { code?: string }).code;
const rows = (r: Reply) => r.body as Record<string, unknown>[];
const rpcCustodian = (token: string | null) =>
  call('/rest/v1/rpc/get_current_custodian', token, { method: 'POST', body: JSON.stringify({ p_tool_id: toolId }) });

const VIEWS = {
  tool_operational: { path: () => `/rest/v1/tool_operational?id=eq.${toolId}`, shape: toolOperationalShape },
  tool_movement_log: { path: () => `/rest/v1/tool_movement_log?tool_id=eq.${toolId}`, shape: toolMovementLogShape },
  tool_image: { path: () => `/rest/v1/tool_image?tool_id=eq.${toolId}`, shape: toolImageShape },
} as const;
const ACTIVE = ['admin', 'standard', 'restricted'] as const;

// ---- Ausência de GRANT (anon) ----

test('anon: api.tool, projeções e RPC negados por ausência de GRANT/EXECUTE (42501)', async () => {
  for (const path of ['/rest/v1/tool', ...Object.values(VIEWS).map((v) => v.path())]) {
    const r = await call(path, null);
    assert.equal(r.status, 401, path);
    assert.equal(errorCode(r), '42501', path);
  }
  const rpc = await rpcCustodian(null);
  assert.equal(rpc.status, 401);
  assert.equal(errorCode(rpc), '42501');
});

test('esquemas private e authz não são expostos pela API para nenhum papel (PGRST106)', async () => {
  for (const token of [null, SERVICE_KEY, tokens.admin] as const) {
    for (const schema of ['private', 'authz']) {
      for (const table of ['custody', 'tool_media', 'migration_quarantine']) {
        const r = await call(`/rest/v1/${table}`, token, { headers: { 'Accept-Profile': schema } });
        assert.equal(r.status, 406, `${schema}.${table}`);
        assert.equal(errorCode(r), 'PGRST106');
      }
    }
  }
});

test('tabelas protegidas novas não existem na superfície pública da API (PGRST205)', async () => {
  for (const table of ['tool_media', 'migration_quarantine', 'custody', 'collaborator']) {
    for (const token of [null, tokens.admin, tokens.restricted]) {
      const r = await call(`/rest/v1/${table}`, token);
      assert.equal(r.status, 404, table);
      assert.equal(errorCode(r), 'PGRST205', table);
    }
  }
});

test('authenticated não escreve em api.tool (sem GRANT de INSERT/UPDATE/DELETE)', async () => {
  const insert = await call('/rest/v1/tool', tokens.admin, { method: 'POST', body: JSON.stringify({ code: `X-${run}`, name: 'X' }) });
  const update = await call(`/rest/v1/tool?id=eq.${toolId}`, tokens.admin, { method: 'PATCH', body: JSON.stringify({ name: 'X' }) });
  const remove = await call(`/rest/v1/tool?id=eq.${toolId}`, tokens.admin, { method: 'DELETE' });
  for (const r of [insert, update, remove]) {
    assert.equal(r.status, 403);
    assert.equal(errorCode(r), '42501');
  }
});

// ---- RPC nominal (D3): inacessível ao cliente ----

test('RPC nominal não é executável por nenhum perfil nem pela service_role (42501)', async () => {
  for (const p of profiles) {
    const r = await rpcCustodian(tokens[p]);
    assert.equal(r.status, 403, p);
    assert.equal(errorCode(r), '42501', p);
    assert.match((r.body as { message: string }).message, /permission denied for function get_current_custodian/, p);
    assert.ok(!JSON.stringify(r.body).includes(SECRETS.collaboratorName), p);
  }
  const service = await rpcCustodian(SERVICE_KEY);
  assert.equal(errorCode(service), '42501');
});

// ---- Política autorizadora x bloqueio por RLS ----

test('perfis ativos leem as projeções e cada linha respeita exatamente o contrato TypeScript', async () => {
  for (const p of ACTIVE) {
    const tool = await call(`/rest/v1/tool?id=eq.${toolId}`, tokens[p]);
    assert.equal(tool.status, 200, p);
    assert.deepEqual(Object.keys(rows(tool)[0]).sort(),
      ['category', 'code', 'condition', 'created_at', 'id', 'is_complete', 'name', 'next_maintenance']);

    for (const [name, view] of Object.entries(VIEWS)) {
      const r = await call(view.path(), tokens[p]);
      assert.equal(r.status, 200, `${p} ${name}`);
      assert.equal(rows(r).length, 1, `${p} ${name}`);
      for (const row of rows(r)) assertShape(view.shape, row);
    }
    const op = await call(VIEWS.tool_operational.path(), tokens[p]);
    assert.equal(rows(op)[0].status, 'borrowed');
    const img = await call(VIEWS.tool_image.path(), tokens[p]);
    assert.deepEqual(img.body, [{ tool_id: toolId, storage_path: verifiedImage }], `${p}: só a imagem verificada`);
  }
});

test('USUÁRIO INATIVO e autenticado sem perfil: RLS/filtro não retornam linhas em tabela e projeções', async () => {
  for (const p of ['inactive', 'noprofile'] as const) {
    for (const path of [`/rest/v1/tool?id=eq.${toolId}`, ...Object.values(VIEWS).map((v) => v.path())]) {
      const r = await call(path, tokens[p]);
      assert.equal(r.status, 200, `${p} ${path}`);
      assert.deepEqual(r.body, [], `${p} ${path}`);
    }
  }
});

// ---- Sanitização ----

test('nenhuma resposta (tabela, projeções, RPC) contém valores protegidos, para nenhum perfil', async () => {
  const paths = [`/rest/v1/tool?id=eq.${toolId}`, ...Object.values(VIEWS).map((v) => v.path())];
  for (const p of profiles) {
    const bodies = [...(await Promise.all(paths.map((path) => call(path, tokens[p])))), await rpcCustodian(tokens[p])];
    for (const r of bodies) {
      const text = JSON.stringify(r.body);
      for (const [label, secret] of Object.entries(SECRETS)) assert.ok(!text.includes(secret), `${p} vazou ${label}`);
      for (const id of Object.values(userIds)) assert.ok(!text.includes(id), `${p} vazou id de operador`);
    }
  }
});

// ---- service_role: ignora RLS, por isso não serve de prova ----

test('service_role ignora RLS em api.tool, não é operador nas projeções e não executa a RPC', async () => {
  const tool = await call(`/rest/v1/tool?id=eq.${toolId}`, SERVICE_KEY);
  assert.equal(rows(tool).length, 1, 'BYPASSRLS: lê a tabela sem política');
  for (const view of Object.values(VIEWS)) {
    const r = await call(view.path(), SERVICE_KEY);
    assert.equal(r.status, 403, 'sem GRANT na view para service_role');
    assert.equal(errorCode(r), '42501');
  }
});
