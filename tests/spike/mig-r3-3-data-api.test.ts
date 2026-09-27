// MIG-R3.3-P (spike) — prova de que, com `[api] enabled = false`, nenhum caminho da Data API
// entrega dado ou executa RPC, para chamador sem JWT, usuário autenticado fictício e service_role
// local, em todos os perfis de esquema relevantes.
//
// EXPECT_DATA_API=off (padrão) afirma o bloqueio. EXPECT_DATA_API=on é o CONTROLE: com a Data API
// ligada a mesma sonda precisa ver a RPC executar e o dado sair — prova de que o teste "off"
// detectaria exposição real em vez de passar por acidente.
//
// A sonda (sequência em private + função em api) é criada e removida por esta execução.
// Executar: EXPECT_DATA_API=off npm run test:spike:data-api
import { API, ANON_KEY, SERVICE_KEY, createFixture, sql } from './support/fixture.ts';

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';

const MODE = process.env.EXPECT_DATA_API ?? 'off';
if (MODE !== 'off' && MODE !== 'on') throw new Error('EXPECT_DATA_API deve ser off ou on');
const OFF = MODE === 'off';

const fx = createFixture('mig-r3-3-api');
const PROBE = `spike_r33_probe_${fx.run}`;
const SEQ = `private.spike_r33_seq_${fx.run}`;

before(async () => {
  await fx.setup();
  sql(`
    create sequence ${SEQ};
    create function api.${PROBE}() returns bigint language sql security definer set search_path = ''
      as $$ select nextval('${SEQ}') $$;
    grant execute on function api.${PROBE}() to anon, authenticated, service_role;
    notify pgrst, 'reload schema';
  `);
  if (!OFF) await new Promise((r) => setTimeout(r, 1500)); // cache de esquema do PostgREST
});

after(async () => {
  sql(`drop function if exists api.${PROBE}(); drop sequence if exists ${SEQ};`);
  await fx.teardown();
});

const probeCalls = () => Number(sql(`select case when is_called then last_value else 0 end from ${SEQ}`));

type Who = 'sem_jwt' | 'usuario' | 'service_role';
const WHO: Who[] = ['sem_jwt', 'usuario', 'service_role'];

async function call(path: string, who: Who, init: { method?: string; body?: unknown; profile?: string } = {}) {
  const headers = new Headers();
  if (who !== 'sem_jwt') {
    const bearer = who === 'service_role' ? SERVICE_KEY : fx.tokens.admin;
    headers.set('apikey', who === 'service_role' ? SERVICE_KEY : ANON_KEY);
    headers.set('Authorization', `Bearer ${bearer}`);
  }
  if (init.profile) headers.set(init.method === 'POST' ? 'Content-Profile' : 'Accept-Profile', init.profile);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status, text: await res.text() };
}

const PROFILES = [undefined, 'api', 'public', 'private', 'authz', 'graphql_public', 'auth', 'storage'];
const PATHS: { path: string; method?: string; body?: unknown }[] = [
  { path: '/rest/v1/' },
  { path: '/rest/v1/tool?select=*' },
  { path: '/rest/v1/tool_operational?select=*' },
  { path: '/rest/v1/tool_movement_log?select=*' },
  { path: '/rest/v1/app_user?select=*' },
  { path: '/rest/v1/collaborator?select=*' },
  { path: `/rest/v1/rpc/${PROBE}`, method: 'POST', body: {} },
  { path: `/rest/v1/rpc/${PROBE}` },
  { path: '/rest/v1/rpc/get_current_custodian', method: 'POST', body: { p_tool_id: '00000000-0000-0000-0000-000000000000' } },
  { path: '/rest/v1/rpc/current_access_level', method: 'POST', body: {} },
  { path: '/graphql/v1', method: 'POST', body: { query: '{ __typename }' } },
  { path: '/rest-admin/v1/schema_cache' },
  { path: '/rest-admin/v1/ready' },
  { path: '/rest-admin/v1/metrics' },
];

function restContainerRunning(): boolean {
  const r = spawnSync('docker', ['ps', '--filter', 'name=^supabase_rest_gestao-de-ferramentas-next$', '--format', '{{.Names}}'], {
    encoding: 'utf8',
  });
  return r.stdout.trim().length > 0;
}

test(`API-0 container do PostgREST ${OFF ? 'ausente' : 'presente'}`, () => {
  assert.equal(restContainerRunning(), !OFF);
});

test(`API-1 ${OFF ? 'nenhum' : 'controle: algum'} caminho da Data API entrega dado ou executa RPC`, async () => {
  const before = probeCalls();
  const leaks: string[] = [];
  for (const who of WHO) {
    for (const profile of PROFILES) {
      for (const p of PATHS) {
        const r = await call(p.path, who, { ...p, profile });
        const exposed = r.text.includes(fx.toolCode) || r.text.includes(fx.SECRETS.collaboratorName);
        if (exposed || (r.status >= 200 && r.status < 300)) {
          leaks.push(`${who} ${profile ?? '-'} ${p.method ?? 'GET'} ${p.path} → ${r.status}${exposed ? ' DADO' : ''}`);
        }
      }
    }
  }
  const executed = probeCalls() - before;
  if (OFF) {
    assert.deepEqual(leaks, [], 'nenhuma resposta 2xx nem dado');
    assert.equal(executed, 0, 'RPC não executou nenhuma vez');
  } else {
    assert.ok(executed > 0, 'controle: RPC executou com a Data API ligada');
    assert.ok(leaks.some((l) => l.includes('service_role') && l.includes('/rest/v1/tool?') && l.includes('DADO')));
  }
});

test('API-2 Auth segue respondendo pelo mesmo gateway', async () => {
  const r = await fetch(`${API}/auth/v1/health`, { headers: { apikey: ANON_KEY } });
  assert.equal(r.status, 200);
});

// MIG-R3.3-P caracterizou aqui que o pg-meta local executava SQL como postgres SEM chave e com
// CORS aberto. MIG-R3.3-S fechou isso com [studio] enabled = false (a CLI não sobe pg-meta sem o
// Studio); a regressão completa está em tests/security/mig-r3-3-local-admin.test.ts. Este caso
// agora falha se o /pg/query voltar a executar, com ou sem Data API.
test('API-3 /pg/query do pg-meta local não executa SQL sem chave (MIG-R3.3-S)', async () => {
  const r = await fetch(`${API}/pg/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'select current_user as u' }),
  });
  assert.ok(r.status < 200 || r.status >= 300, `/pg/query → ${r.status}`);
  assert.equal((await r.text()).includes('postgres'), false);
});
