// MIG-R3.3-P (spike) — fixture compartilhada: identidades, dados sentinela e o papel de backend
// descartável. Tudo fictício, criado e removido por cada execução. A service role local é usada
// SOMENTE para criar/remover contas fictícias pela Admin API do Auth (não passa pelo PostgREST).
import { localSupabaseEnvironment } from '../../integration/support/env.ts';

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

export const API = localSupabaseEnvironment.url;
export const ANON_KEY = required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
export const SERVICE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
export const DB_CONTAINER = 'supabase_db_gestao-de-ferramentas-next';
export const DB_PORT = 40202;
export const BACKEND_ROLE = 'gf_spike_backend';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente em .env.local`);
  return value;
}

// psql como postgres dentro do container: preparação e limpeza, nunca como caminho de negócio.
export function sql(query: string): string {
  const r = spawnSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAq'], {
    input: query,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`psql falhou: ${r.stderr}`);
  return r.stdout.trim();
}

export async function auth(path: string, init: RequestInit & { token?: string; service?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set('apikey', init.service ? SERVICE_KEY : ANON_KEY);
  const bearer = init.service ? SERVICE_KEY : init.token;
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${API}/auth/v1${path}`, { ...init, headers });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

export const profiles = ['admin', 'standard', 'restricted', 'inactive', 'noprofile'] as const;
export type Profile = (typeof profiles)[number];

export function createFixture(prefix: string) {
  const run = randomUUID().slice(0, 8);
  const password = randomBytes(18).toString('base64url');
  const backendPassword = randomBytes(24).toString('base64url');
  const userIds = {} as Record<Profile, string>;
  const tokens = {} as Record<Profile, string>;
  const email = (p: Profile) => `${prefix}-${p}-${run}@example.test`;
  const toolId = randomUUID();
  const toolCode = `SPK-${run}`;
  const collaboratorId = randomUUID();
  const custodyId = randomUUID();
  const SECRETS = {
    collaboratorName: `Colaborador Spike ${run}`,
    jobTitle: `Funcao Spike ${run}`,
    phone: `55-${run}`,
    ip: '198.51.100.33',
    device: `dispositivo-spike-${run}`,
  };

  async function setup() {
    for (const p of profiles) {
      const created = await auth('/admin/users', {
        method: 'POST',
        service: true,
        body: JSON.stringify({ email: email(p), password, email_confirm: true }),
      });
      assert.equal(created.status, 200, `criação do usuário fictício ${p}`);
      userIds[p] = created.body!.id as string;
    }
    sql(`
      insert into private.app_user (id, name, access_level, status) values
        ('${userIds.admin}', 'Admin ${run}', 'admin', 'active'),
        ('${userIds.standard}', 'Padrao ${run}', 'standard', 'active'),
        ('${userIds.restricted}', 'Restrito ${run}', 'restricted', 'active'),
        ('${userIds.inactive}', 'Inativo ${run}', 'standard', 'inactive');
      insert into private.collaborator (id, name, job_title, phone)
        values ('${collaboratorId}', '${SECRETS.collaboratorName}', '${SECRETS.jobTitle}', '${SECRETS.phone}');
      insert into api.tool (id, code, name, is_complete) values ('${toolId}', '${toolCode}', 'Ferramenta ${run}', true);
      insert into private.custody (id, tool_id, collaborator_id, opened_by)
        values ('${custodyId}', '${toolId}', '${collaboratorId}', '${userIds.standard}');
      insert into private.movement (tool_id, custody_id, kind, actor_user_id, device, ip)
        values ('${toolId}', '${custodyId}', 'out', '${userIds.standard}', '${SECRETS.device}', '${SECRETS.ip}');
    `);
    for (const p of profiles) {
      const session = await auth('/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email: email(p), password }),
      });
      assert.equal(session.status, 200, `login fictício ${p}`);
      tokens[p] = session.body!.access_token as string;
    }
  }

  // Papel de login descartável, desenho proposto para o backend: sem privilégio próprio
  // (NOINHERIT), sem BYPASSRLS, e só pode assumir authenticated (nunca service_role/postgres).
  function createBackendRole() {
    sql(`
      create role ${BACKEND_ROLE} login noinherit nobypassrls nocreatedb nocreaterole noreplication
        connection limit 10 password '${backendPassword}';
      grant authenticated to ${BACKEND_ROLE} with inherit false, set true;
    `);
  }

  async function teardown() {
    sql(`
      delete from private.movement where tool_id = '${toolId}';
      delete from private.custody where tool_id = '${toolId}';
      delete from private.collaborator where id = '${collaboratorId}';
      delete from api.tool where id = '${toolId}';
      delete from private.app_user where id in (${Object.values(userIds).map((id) => `'${id}'`).join(',')});
      select pg_terminate_backend(pid) from pg_stat_activity where usename = '${BACKEND_ROLE}';
      drop role if exists ${BACKEND_ROLE};
    `);
    for (const id of Object.values(userIds)) {
      await auth(`/admin/users/${id}`, { method: 'DELETE', service: true });
    }
  }

  return {
    run, password, backendPassword, userIds, tokens, email, toolId, toolCode, collaboratorId, SECRETS,
    setup, createBackendRole, teardown,
  };
}
