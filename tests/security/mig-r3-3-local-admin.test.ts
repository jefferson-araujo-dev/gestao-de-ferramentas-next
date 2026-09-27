// MIG-R3.3-S — regressão de segurança do stack Supabase local.
//   ADM-*   nenhum serviço administrativo (pg-meta, Studio/MCP, PostgREST admin, Logflare) executa
//           ou responde sem autenticação, por nenhum caminho identificado no MIG-R3.3-S;
//   DATA-*  Data API desligada;
//   AUTH-*  Supabase Auth continua funcional;
//   PG-*    PostgreSQL continua operacional;
//   NET-*   portas publicadas somente em loopback.
//
// EXPECT_ADMIN_SURFACE=closed (padrão) exige a configuração final versionada em supabase/config.toml
// ([studio], [api] e [analytics] com enabled = false). EXPECT_ADMIN_SURFACE=open é o CONTROLE: com o
// Studio religado a mesma sonda precisa ver o SQL executar — prova de que o modo closed detectaria a
// regressão em vez de passar por acidente. As sondas só executam `select '<marcador>'`.
// Executar: npm run test:security (Supabase local ativo). Contas fictícias @example.test.
import { API, ANON_KEY, auth, sql } from '../spike/support/fixture.ts';

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { test } from 'node:test';

const MODE = process.env.EXPECT_ADMIN_SURFACE ?? 'closed';
if (MODE !== 'closed' && MODE !== 'open') throw new Error('EXPECT_ADMIN_SURFACE deve ser closed ou open');
const CLOSED = MODE === 'closed';

const PROJECT = 'gestao-de-ferramentas-next';
const STUDIO_PORT = 40203;
const ANALYTICS_PORT = 40207;
const MARKER = `mig_r33s_${randomUUID().slice(0, 8)}`;
const FOREIGN_ORIGIN = 'http://localhost:5555';
const SELECT_MARKER = `select '${MARKER}' as m`;

type Probe = { name: string; url: string; method?: string; headers?: Record<string, string>; body?: unknown };

const json = { 'Content-Type': 'application/json' };
const mcp = { ...json, Accept: 'application/json, text/event-stream' };
const mcpCall = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'execute_sql', arguments: { query: SELECT_MARKER } } };
const studioBase = `http://127.0.0.1:${STUDIO_PORT}`;
const analyticsBase = `http://127.0.0.1:${ANALYTICS_PORT}`;

// Todos os caminhos administrativos identificados no diagnóstico (docs/mig-r3-3-seguranca-local.md).
const PROBES: Probe[] = [
  { name: 'kong /pg/query', url: `${API}/pg/query`, method: 'POST', headers: json, body: { query: SELECT_MARKER } },
  { name: 'kong /pg/tables', url: `${API}/pg/tables` },
  { name: 'kong /rest-admin/v1/schema_cache', url: `${API}/rest-admin/v1/schema_cache` },
  { name: 'kong /rest-admin/v1/ready', url: `${API}/rest-admin/v1/ready` },
  { name: 'kong /rest-admin/v1/metrics', url: `${API}/rest-admin/v1/metrics` },
  { name: 'kong /mcp execute_sql', url: `${API}/mcp`, method: 'POST', headers: mcp, body: mcpCall },
  { name: 'kong /analytics/v1/health', url: `${API}/analytics/v1/health` },
  { name: 'studio /api/platform/pg-meta/default/query', url: `${studioBase}/api/platform/pg-meta/default/query`, method: 'POST', headers: json, body: { query: SELECT_MARKER } },
  { name: 'studio /api/mcp execute_sql', url: `${studioBase}/api/mcp`, method: 'POST', headers: mcp, body: mcpCall },
  { name: 'logflare /auth/login/single_tenant', url: `${analyticsBase}/auth/login/single_tenant` },
];

// Sem chave, com chave fictícia inválida e com origem HTTP diferente: nenhuma variação pode abrir.
const CREDENTIALS: Record<string, Record<string, string>> = {
  sem_chave: {},
  chave_ficticia: { apikey: 'chave-ficticia-invalida', Authorization: 'Bearer ficticio.invalido.token' },
  outra_origem: { Origin: FOREIGN_ORIGIN },
};

async function hit(p: Probe, extra: Record<string, string>) {
  try {
    const res = await fetch(p.url, {
      method: p.method ?? 'GET',
      headers: { ...p.headers, ...extra },
      body: p.body === undefined ? undefined : JSON.stringify(p.body),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, text: await res.text() };
  } catch {
    return { status: 0, text: '' }; // conexão recusada: porta não publicada
  }
}

function containerRunning(service: string): boolean {
  const r = spawnSync('docker', ['ps', '--filter', `name=^supabase_${service}_${PROJECT}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
  });
  return r.stdout.trim().length > 0;
}

function reaches(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1500 });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => resolve(false));
  });
}

test(`ADM-1 ${CLOSED ? 'nenhum' : 'controle: algum'} caminho administrativo responde ou executa SQL sem autenticação`, async () => {
  const exposures: string[] = [];
  for (const p of PROBES) {
    for (const [who, headers] of Object.entries(CREDENTIALS)) {
      const r = await hit(p, headers);
      const executed = r.text.includes(MARKER);
      // 3xx do Logflare = sessão administrativa emitida sem credencial.
      if (executed || (r.status >= 200 && r.status < 400)) {
        exposures.push(`${p.name} [${who}] → ${r.status}${executed ? ' EXECUTOU' : ''}`);
      }
    }
  }
  if (CLOSED) {
    assert.deepEqual(exposures, [], 'nenhum caminho administrativo acessível');
  } else {
    assert.ok(exposures.some((e) => e.startsWith('kong /pg/query') && e.includes('EXECUTOU')), 'controle: /pg/query executa');
    assert.ok(exposures.some((e) => e.startsWith('kong /mcp') && e.includes('EXECUTOU')), 'controle: /mcp executa');
  }
});

test('ADM-2 containers administrativos ausentes', { skip: !CLOSED && 'controle' }, () => {
  for (const service of ['studio', 'pg_meta', 'rest', 'analytics', 'vector']) {
    assert.equal(containerRunning(service), false, `supabase_${service} não deve estar em execução`);
  }
});

test('DATA-1 Data API desligada (PostgREST e GraphQL não respondem 2xx)', { skip: !CLOSED && 'controle' }, async () => {
  for (const path of ['/rest/v1/', '/rest/v1/tool_operational?select=*', '/graphql/v1']) {
    const r = await hit({ name: path, url: `${API}${path}` }, { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` });
    assert.ok(r.status < 200 || r.status >= 300, `${path} → ${r.status}`);
  }
});

test('AUTH-1 Supabase Auth: login, sessão, renovação, logout e rejeição', async () => {
  const health = await auth('/health');
  assert.equal(health.status, 200);

  const email = `mig-r3-3-s-${randomUUID().slice(0, 8)}@example.test`;
  const password = randomBytes(18).toString('base64url');
  const created = await auth('/admin/users', { method: 'POST', service: true, body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.equal(created.status, 200);
  const userId = created.body!.id as string;
  try {
    const login = await auth('/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200);
    const access = login.body!.access_token as string;
    assert.equal((await auth('/user', { token: access })).status, 200, 'sessão válida');

    const refreshed = await auth('/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: login.body!.refresh_token }),
    });
    assert.equal(refreshed.status, 200, 'renovação');
    const newAccess = refreshed.body!.access_token as string;

    assert.equal((await auth('/logout', { method: 'POST', token: newAccess })).status, 204, 'logout');
    assert.notEqual((await auth('/user', { token: newAccess })).status, 200, 'sessão encerrada recusada');
    assert.notEqual((await auth('/user', { token: 'ficticio.invalido.token' })).status, 200, 'token inválido recusado');
  } finally {
    await auth(`/admin/users/${userId}`, { method: 'DELETE', service: true });
  }
});

test('PG-1 PostgreSQL operacional e migrações locais aplicadas', () => {
  assert.equal(sql('select 1'), '1');
  // Toda migração do repositório registrada no banco local.
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).map((f) => f.split('_')[0]);
  const applied = sql('select version from supabase_migrations.schema_migrations').split('\n');
  assert.deepEqual(files.filter((v) => !applied.includes(v)), [], 'migrações pendentes');
});

test('NET-1 portas publicadas somente em loopback', async () => {
  const r = spawnSync('docker', ['ps', '--filter', `name=_${PROJECT}$`, '--format', '{{.Ports}}'], { encoding: 'utf8' });
  const bindings = [...r.stdout.matchAll(/([^\s,]+):(\d+)->/g)].map(([, host, port]) => ({ host, port: Number(port) }));
  assert.ok(bindings.length > 0, 'há portas publicadas');
  for (const b of bindings) assert.ok(['127.0.0.1', '[::1]'].includes(b.host), `${b.host}:${b.port}`);

  const ports = [...new Set(bindings.map((b) => b.port))];
  if (CLOSED) {
    assert.equal(ports.includes(STUDIO_PORT), false, 'Studio sem porta publicada');
    assert.equal(ports.includes(ANALYTICS_PORT), false, 'Logflare sem porta publicada');
  }
  const external = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && !a.internal && !a.address.startsWith('fe80'))
    .map((a) => a!.address);
  assert.ok(external.length > 0, 'há interfaces não loopback para testar');
  for (const port of ports) {
    assert.ok(await reaches('127.0.0.1', port), `127.0.0.1:${port}`);
    for (const host of external) assert.equal(await reaches(host, port), false, `${host}:${port}`);
  }
});
