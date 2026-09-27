// MIG-R3.3-P (spike) — prova local da arquitetura "Next.js é o único acesso aos dados":
//   AUTH-*  Supabase Auth (endpoint, cliente, verificação no servidor, renovação, logout, rejeições);
//   SSR-*   sessão em cookies com @supabase/ssr (adaptador getAll/setAll, renovação, logout);
//   DB-*    conexão direta com papel mínimo + RLS por transação + testes negativos;
//   NET-*   portas somente em loopback.
// Válido com a Data API ligada OU desligada: nada aqui passa pelo PostgREST. Tudo fictício.
// Executar: npm run test:spike:backend (Supabase local ativo).
import { assertShape, toolMovementLogShape, toolOperationalShape } from '../../src/contracts/operational.ts';
import { ANON_KEY, API, BACKEND_ROLE, DB_PORT, auth, createFixture, sql } from './support/fixture.ts';
import type { Profile } from './support/fixture.ts';
import { Forbidden, Unauthorized, withOperator } from './support/operator-tx.ts';
import type { AccessLevel, VerifyToken } from './support/operator-tx.ts';

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import { after, before, test } from 'node:test';

const fx = createFixture('mig-r3-3');
let pool: pg.Pool;
const poolConfig = () => ({
  host: '127.0.0.1',
  port: DB_PORT,
  database: 'postgres',
  user: BACKEND_ROLE,
  password: fx.backendPassword,
});

const noStorage = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;
const server = createClient(API, ANON_KEY, { auth: noStorage });

// Verificação proposta: getUser consulta o Auth a cada requisição — valida assinatura, expiração
// E existência da sessão (logout). getClaims (JWKS local) não enxerga logout; ver AUTH-4.
const verify: VerifyToken = async (token) => {
  const { data, error } = await server.auth.getUser(token);
  return error ? null : (data.user?.id ?? null);
};

before(async () => {
  await fx.setup();
  fx.createBackendRole();
  pool = new pg.Pool({ ...poolConfig(), max: 3 });
});

after(async () => {
  await pool?.end();
  await fx.teardown();
});

// ---------------------------------------------------------------------------------------------
// utilidades de JWT (nenhum token é impresso)
// ---------------------------------------------------------------------------------------------

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const payloadOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as Record<string, unknown>;

function withPayload(jwt: string, patch: Record<string, unknown>): string {
  const [h, , s] = jwt.split('.');
  return `${h}.${b64({ ...payloadOf(jwt), ...patch })}.${s}`;
}

// Segredo HS256 do stack LOCAL (supabase status). Usado só para cunhar um token corretamente
// assinado porém expirado, e o controle idêntico não expirado.
function mintHs256(claims: Record<string, unknown>): string {
  const r = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error('supabase status falhou');
  const secret = (JSON.parse(r.stdout) as { JWT_SECRET: string }).JWT_SECRET;
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

const newClient = () => createClient(API, ANON_KEY, { auth: noStorage });

// ---------------------------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------------------------

test('AUTH-1 endpoint do Auth responde e publica chave de assinatura assimétrica', async () => {
  assert.equal((await auth('/health')).status, 200);
  const jwks = (await (await fetch(`${API}/auth/v1/.well-known/jwks.json`)).json()) as { keys: { alg: string }[] };
  assert.ok(jwks.keys.some((k) => k.alg === 'ES256'), 'JWKS com chave ES256');
});

test('AUTH-2..4 cliente: login, validação no servidor, renovação e logout', async () => {
  const client = newClient();
  const login = await client.auth.signInWithPassword({ email: fx.email('restricted'), password: fx.password });
  assert.equal(login.error, null);
  const first = login.data.session!;
  assert.equal(await verify(first.access_token), fx.userIds.restricted, 'AUTH-2 servidor valida o usuário');

  const refreshed = await client.auth.refreshSession();
  assert.equal(refreshed.error, null);
  const second = refreshed.data.session!;
  assert.notEqual(second.access_token, first.access_token, 'AUTH-3 novo access token');
  assert.notEqual(second.refresh_token, first.refresh_token, 'AUTH-3 refresh token rotacionado');
  assert.equal(await verify(second.access_token), fx.userIds.restricted);

  assert.equal((await client.auth.signOut({ scope: 'local' })).error, null);
  assert.equal(await verify(second.access_token), null, 'AUTH-4 getUser recusa token de sessão encerrada');
  const reuse = await auth('/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: second.refresh_token }),
  });
  assert.notEqual(reuse.status, 200, 'AUTH-4 refresh token revogado');
  // Janela conhecida: a verificação local por JWKS ainda aceita o token até o exp (<= jwt_expiry).
  const local = await server.auth.getClaims(second.access_token);
  assert.equal(local.error, null);
  assert.equal(local.data?.claims.sub, fx.userIds.restricted, 'AUTH-4 getClaims NÃO detecta logout');
});

test('AUTH-5 token adulterado (sujeito trocado) é recusado pelo Auth e pela verificação local', async () => {
  const forged = withPayload(fx.tokens.restricted, { sub: fx.userIds.admin });
  assert.equal(await verify(forged), null);
  assert.ok((await server.auth.getClaims(forged)).error, 'getClaims recusa assinatura inválida');
});

test('AUTH-6 token inválido e alg=none são recusados', async () => {
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...payloadOf(fx.tokens.admin) })}.`;
  for (const bad of ['nao-e-um-jwt', none, `${fx.tokens.admin}x`]) {
    assert.equal(await verify(bad), null);
    assert.ok((await server.auth.getClaims(bad)).error);
  }
});

test('AUTH-7 token assinado corretamente porém expirado é recusado (controle não expirado aceito)', async () => {
  const base = payloadOf(fx.tokens.standard);
  const now = Math.floor(Date.now() / 1000);
  const control = mintHs256({ ...base, iat: now - 10, exp: now + 300 });
  assert.equal(await verify(control), fx.userIds.standard, 'controle: chave e claims aceitos');
  const expired = mintHs256({ ...base, iat: now - 7200, exp: now - 3600 });
  assert.equal(await verify(expired), null, 'expirado recusado pelo Auth');
});

// ---------------------------------------------------------------------------------------------
// SSR — adaptador de cookies no formato exigido por @supabase/ssr (getAll/setAll), equivalente ao
// que um Route Handler / Server Action do Next.js faria com `await cookies()`.
// ---------------------------------------------------------------------------------------------

type Jar = Map<string, string>;
type SetCall = { name: string; value: string; options: Record<string, unknown> };

function serverClientFor(jar: Jar, log: SetCall[] = []) {
  return createServerClient(API, ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value, options } of list) {
          // A aplicação endurece o cookie: o navegador não precisa ler a sessão nesta arquitetura.
          log.push({ name, value, options: { ...options, httpOnly: true } });
          if (!value || options?.maxAge === 0) jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });
}

const authCookies = (jar: Jar) => [...jar.keys()].filter((k) => k.startsWith('sb-') && k.includes('auth-token'));

function readSession(jar: Jar): { key: string; session: Record<string, unknown> } {
  const names = authCookies(jar).sort();
  const key = names[0].replace(/\.\d+$/, '');
  const raw = names.map((n) => jar.get(n)!).join('');
  const json = raw.startsWith('base64-') ? Buffer.from(raw.slice(7), 'base64url').toString() : raw;
  return { key, session: JSON.parse(json) };
}

test('SSR-1..4 sessão em cookies: login, leitura em nova requisição, renovação e logout', async () => {
  const jar: Jar = new Map();
  const log: SetCall[] = [];
  const login = await serverClientFor(jar, log).auth.signInWithPassword({
    email: fx.email('admin'),
    password: fx.password,
  });
  assert.equal(login.error, null);
  assert.ok(authCookies(jar).length > 0, 'SSR-1 cookie de sessão gravado via setAll');
  const opts = log.at(-1)!.options;
  assert.equal(opts.path, '/');
  assert.equal(opts.sameSite, 'lax');
  assert.ok(Number(opts.maxAge) > 0);

  const next = await serverClientFor(jar).auth.getUser();
  assert.equal(next.data.user?.id, fx.userIds.admin, 'SSR-2 nova requisição identifica o usuário pelo cookie');

  // SSR-3: sessão vencida no cookie → a biblioteca renova com o refresh token e regrava o cookie.
  const { key, session } = readSession(jar);
  const oldAccess = session.access_token as string;
  for (const n of authCookies(jar)) jar.delete(n);
  jar.set(key, `base64-${Buffer.from(JSON.stringify({ ...session, expires_at: 1 })).toString('base64url')}`);
  const renewLog: SetCall[] = [];
  const renewed = await serverClientFor(jar, renewLog).auth.getUser();
  assert.equal(renewed.data.user?.id, fx.userIds.admin);
  assert.ok(renewLog.length > 0, 'SSR-3 cookie regravado após renovação');
  const after = readSession(jar).session;
  assert.notEqual(after.access_token, oldAccess, 'SSR-3 access token novo');
  assert.ok(Number(after.expires_at) > Date.now() / 1000);

  // SSR-4: logout remove o cookie e invalida o token no Auth.
  assert.equal((await serverClientFor(jar).auth.signOut({ scope: 'local' })).error, null);
  assert.equal(authCookies(jar).length, 0, 'SSR-4 cookie removido');
  assert.equal(await verify(after.access_token as string), null, 'SSR-4 token recusado após logout');
});

// ---------------------------------------------------------------------------------------------
// DB — papel mínimo, RLS por transação e negativos
// ---------------------------------------------------------------------------------------------

async function sqlState(p: pg.Pool | pg.PoolClient, query: string): Promise<string | undefined> {
  try {
    await p.query(query);
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

test('DB-1 PostgreSQL disponível pelo papel de backend (conexão direta, SCRAM)', async () => {
  const { rows } = await pool.query<{ u: string; bypass: boolean; inherit: boolean; super: boolean }>(
    `select current_user as u, r.rolbypassrls as bypass, r.rolinherit as inherit, r.rolsuper as super
     from pg_roles r where r.rolname = current_user`,
  );
  assert.deepEqual(rows[0], { u: BACKEND_ROLE, bypass: false, inherit: false, super: false });
});

test('DB-2 sem SET LOCAL ROLE o papel de backend não lê nada (falha fechada)', async () => {
  for (const q of ['select 1 from api.tool', 'select 1 from api.tool_operational', 'select 1 from private.app_user']) {
    assert.equal(await sqlState(pool, q), '42501', q);
  }
  // SET LOCAL fora de transação não tem efeito — continua negado.
  const db = await pool.connect();
  try {
    await db.query('set local role authenticated');
    assert.equal(await sqlState(db, 'select 1 from api.tool'), '42501');
  } finally {
    db.release();
  }
});

test('DB-3 o backend não consegue assumir outro papel SQL', async () => {
  const db = await pool.connect();
  try {
    for (const role of ['service_role', 'postgres', 'supabase_admin', 'authenticator', 'anon']) {
      await db.query('begin');
      assert.equal(await sqlState(db, `set local role ${role}`), '42501', role);
      await db.query('rollback');
    }
  } finally {
    db.release();
  }
});

const TOOL_Q = 'select * from api.tool_operational where id = $1';

async function readAs(token: string | null) {
  return withOperator(pool, verify, token, async (db, level) => {
    const tool = (await db.query(TOOL_Q, [fx.toolId])).rows;
    const log = (await db.query('select * from api.tool_movement_log where tool_id = $1', [fx.toolId])).rows;
    return { level, tool, log };
  });
}

test('DB-4 perfis ativos leem as projeções sob RLS e cada linha respeita o contrato', async () => {
  const expected: Record<string, AccessLevel> = { admin: 'admin', standard: 'standard', restricted: 'restricted' };
  for (const [p, level] of Object.entries(expected)) {
    const r = await readAs(fx.tokens[p as Profile]);
    assert.equal(r.level, level);
    assert.equal(r.tool.length, 1, `${p} vê a ferramenta`);
    assert.equal(r.tool[0].status, 'borrowed');
    // pg devolve date/timestamptz como Date; a resposta HTTP do Route Handler serializa em JSON.
    // O contrato vale sobre o que sai na resposta, então valida-se após a serialização.
    const wire = JSON.parse(JSON.stringify(r)) as typeof r;
    wire.tool.forEach((row) => assertShape(toolOperationalShape, row));
    assert.equal(wire.log.length, 1);
    wire.log.forEach((row) => assertShape(toolMovementLogShape, row));
    assert.ok(r.log[0].occurred_at instanceof Date, 'pg entrega timestamptz como Date (não string)');
    const json = JSON.stringify(r);
    for (const secret of Object.values(fx.SECRETS)) assert.ok(!json.includes(secret), `${p}: sem ${secret}`);
  }
});

test('DB-5 sem sessão, token inválido/adulterado, sem perfil e inativo são recusados', async () => {
  const untouched = {
    connect: () => {
      throw new Error('pool não deveria ser tocado sem identidade verificada');
    },
  } as unknown as pg.Pool;
  const noop = async () => 'executou';
  await assert.rejects(withOperator(untouched, verify, null, noop), Unauthorized);
  await assert.rejects(withOperator(untouched, verify, 'invalido', noop), Unauthorized);
  await assert.rejects(
    withOperator(untouched, verify, withPayload(fx.tokens.restricted, { sub: fx.userIds.admin }), noop),
    Unauthorized,
  );
  await assert.rejects(readAs(fx.tokens.noprofile), Forbidden);
  await assert.rejects(readAs(fx.tokens.inactive), Forbidden);

  // Mesmo que a aplicação esquecesse a checagem, o banco não devolve linha a esses sujeitos.
  for (const p of ['noprofile', 'inactive'] as const) {
    const db = await pool.connect();
    try {
      await db.query('begin');
      await db.query('set local role authenticated');
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: fx.userIds[p] })]);
      assert.equal((await db.query(TOOL_Q, [fx.toolId])).rowCount, 0, `${p}: view vazia`);
      assert.equal((await db.query('select id from api.tool where id = $1', [fx.toolId])).rowCount, 0, `${p}: RLS`);
      await db.query('rollback');
    } finally {
      db.release();
    }
  }
});

test('DB-6 K7: operador desativado perde acesso na requisição seguinte', async () => {
  assert.equal((await readAs(fx.tokens.standard)).level, 'standard');
  sql(`update private.app_user set status = 'inactive' where id = '${fx.userIds.standard}'`);
  try {
    await assert.rejects(readAs(fx.tokens.standard), Forbidden);
  } finally {
    sql(`update private.app_user set status = 'active' where id = '${fx.userIds.standard}'`);
  }
  assert.equal((await readAs(fx.tokens.standard)).level, 'standard');
});

test('DB-7 K8/K13: nenhum perfil lê dados pessoais pela conexão do backend', async () => {
  const personal = [
    'select * from private.collaborator',
    'select * from private.custody',
    'select * from private.movement',
    'select * from private.app_user',
    `select * from api.get_current_custodian('00000000-0000-0000-0000-000000000000')`,
  ];
  for (const p of ['admin', 'standard', 'restricted'] as const) {
    for (const q of personal) {
      const code = await withOperator(pool, verify, fx.tokens[p], (db) => sqlState(db, q));
      assert.equal(code, '42501', `${p}: ${q}`);
    }
  }
});

test('DB-8 troca de sujeito: user_id do navegador é ignorado; SQL arbitrário seria impersonação', async () => {
  // Contrato do handler: só o token entra; um user_id no corpo não tem para onde ir.
  const handler = (req: { accessToken: string; userId?: string }) => readAs(req.accessToken);
  const r = await handler({ accessToken: fx.tokens.restricted, userId: fx.userIds.admin });
  assert.equal(r.level, 'restricted');

  // RISCO registrado (não é defesa): quem executa SQL arbitrário na conexão do backend troca as
  // claims com set_config. Por isso o backend só pode emitir SQL parametrizado e fixo.
  const escalated = await withOperator(pool, verify, fx.tokens.restricted, async (db) => {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: fx.userIds.admin })]);
    return (await db.query<{ l: string }>('select authz.current_access_level() as l')).rows[0].l;
  });
  assert.equal(escalated, 'admin');
});

test('DB-9 conexão reutilizada não herda papel nem identidade (COMMIT, ROLLBACK e erro)', async () => {
  const single = new pg.Pool({ ...poolConfig(), max: 1 });
  const clean = async () => {
    const { rows } = await single.query<{ u: string; claims: string | null }>(
      "select current_user as u, nullif(current_setting('request.jwt.claims', true), '') as claims",
    );
    assert.deepEqual(rows[0], { u: BACKEND_ROLE, claims: null });
    assert.equal(await sqlState(single, 'select 1 from api.tool'), '42501');
  };
  try {
    await withOperator(single, verify, fx.tokens.admin, (db) => db.query(TOOL_Q, [fx.toolId]));
    await clean();
    await assert.rejects(
      withOperator(single, verify, fx.tokens.admin, async (db) => {
        await db.query(TOOL_Q, [fx.toolId]);
        throw new Error('falha no meio da operação');
      }),
      /falha no meio/,
    );
    await clean();
    await assert.rejects(withOperator(single, verify, fx.tokens.admin, (db) => db.query('select 1/0')));
    await clean();
  } finally {
    await single.end();
  }
});

test('DB-10 controle negativo: SET e set_config de SESSÃO vazam para o próximo uso (o DB-9 detectaria)', async () => {
  const single = new pg.Pool({ ...poolConfig(), max: 1 });
  try {
    const db = await single.connect();
    await db.query('set role authenticated');
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: fx.userIds.admin })]);
    db.release();
    const reused = await single.connect();
    const { rows } = await reused.query<{ u: string; l: string }>(
      'select current_user as u, authz.current_access_level() as l',
    );
    assert.deepEqual(rows[0], { u: 'authenticated', l: 'admin' }, 'vazamento reproduzido');
    reused.release(true); // descarta a conexão contaminada
  } finally {
    await single.end();
  }
});

test('DB-11 requisições concorrentes de usuários distintos não se misturam', async () => {
  const who = ['admin', 'standard', 'restricted'] as const;
  const jobs = Array.from({ length: 45 }, (_, i) => who[i % 3]);
  const results = await Promise.all(
    jobs.map((p) =>
      withOperator(pool, verify, fx.tokens[p], async (db, level) => {
        await db.query('select pg_sleep(random() * 0.02)'); // força intercalação entre transações
        const { rows } = await db.query<{ uid: string }>('select auth.uid()::text as uid');
        return { p, level, uid: rows[0].uid };
      }),
    ),
  );
  for (const r of results) {
    assert.equal(r.uid, fx.userIds[r.p]);
    assert.equal(r.level, r.p);
  }
  assert.ok(pool.totalCount <= 3, 'pool pequeno respeitado');
});

// ---------------------------------------------------------------------------------------------
// NET — isolamento
// ---------------------------------------------------------------------------------------------

function reaches(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 1500 });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

test('NET-1 gateway e PostgreSQL só aceitam conexão por loopback', async () => {
  const external = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && !a.internal && !a.address.startsWith('fe80'))
    .map((a) => a!.address);
  assert.ok(external.length > 0, 'há interfaces não loopback para testar');
  for (const port of [40201, 40202]) {
    assert.ok(await reaches('127.0.0.1', port), `127.0.0.1:${port}`);
    assert.ok(await reaches('::1', port), `[::1]:${port}`);
    for (const host of external) assert.equal(await reaches(host, port), false, `${host}:${port}`);
  }
});
