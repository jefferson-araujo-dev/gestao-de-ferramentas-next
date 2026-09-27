// MIG-R3.3-P (spike) — fluxo proposto de acesso ao banco pelo backend Next.js. NÃO é a
// implementação definitiva: existe só para provar localmente que a RLS e os GRANTs atuais continuam
// valendo quando o PostgREST sai do caminho. Ver docs/mig-r3-3-planejamento.md.
//
// Ordem obrigatória, cada passo coberto por teste em tests/spike/mig-r3-3-backend.test.ts:
//   1. identidade verificada pelo Supabase Auth (nunca um user_id vindo do navegador);
//   2. transação aberta; o papel de login não tem privilégio próprio (NOINHERIT);
//   3. SET LOCAL ROLE authenticated — papel fixo no código, nunca escolhido pelo cliente;
//   4. claims com escopo de transação (set_config(..., true)) — somem no COMMIT/ROLLBACK;
//   5. perfil e situação ativa revalidados no banco a cada operação (K7);
//   6. a operação roda sob RLS; COMMIT ou ROLLBACK encerra o contexto.
import type { Pool, PoolClient } from 'pg';

export type VerifyToken = (accessToken: string) => Promise<string | null>;
export type AccessLevel = 'admin' | 'standard' | 'restricted';

export class Unauthorized extends Error {}
export class Forbidden extends Error {}

export async function withOperator<T>(
  pool: Pool,
  verify: VerifyToken,
  accessToken: string | null,
  work: (db: PoolClient, level: AccessLevel) => Promise<T>,
): Promise<T> {
  // Sem identidade verificada não se toca no pool.
  const userId = accessToken ? await verify(accessToken) : null;
  if (!userId) throw new Unauthorized();

  const db = await pool.connect();
  let broken = false;
  try {
    await db.query('begin');
    await db.query('set local role authenticated');
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    const { rows } = await db.query<{ level: AccessLevel | null }>('select authz.current_access_level() as level');
    const level = rows[0]?.level;
    if (!level) throw new Forbidden();
    const result = await work(db, level);
    await db.query('commit');
    return result;
  } catch (error) {
    // Se nem o ROLLBACK passa, a conexão é descartada em vez de voltar ao pool com estado incerto.
    await db.query('rollback').catch(() => {
      broken = true;
    });
    throw error;
  } finally {
    db.release(broken);
  }
}
